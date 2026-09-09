// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.
//
// The go-altcoinchain library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The go-altcoinchain library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the go-altcoinchain library. If not, see <http://www.gnu.org/licenses/>.

package hybrid

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
)

// selSlash is the 4-byte selector of the staking contract's slash(address)
// entry point, callable only by the systemCaller.
var selSlash = crypto.Keccak256([]byte("slash(address)"))[:4]

// systemCaller is the pseudo-account that funds the per-block validator
// reward call into the staking contract. It mirrors geth's convention of
// 0x…fffe for protocol-level system calls.
var systemCaller = common.HexToAddress("0xfffffffffffffffffffffffffffffffffffffffe")

// systemCallGas caps the gas available to the staking contract's reward
// distribution. It is consensus-level gas (not counted in the block gas
// used); the cap only bounds how much distribution work one block may do.
const systemCallGas uint64 = 25_000_000

// distributeValidatorReward mints the validator reward to the system caller
// and value-calls the staking contract with it, so the contract's
// receive() -> _distributeRewards() accounting actually runs. This executes
// identically during block production (FinalizeAndAssemble) and block import
// (Process -> Finalize), so it is consensus-safe.
//
// If the call fails (revert / out of gas — deterministic for a given state),
// the reward is parked on the contract's balance, matching the contract's
// own "no online validators" pooling behaviour. The same happens trivially
// while the contract is not yet deployed: a value call to a codeless account
// is a plain balance transfer.
func (h *Hybrid) distributeValidatorReward(chain consensus.ChainHeaderReader, header *types.Header, statedb *state.StateDB, reward *big.Int) {
	contract := h.config.StakingContract

	statedb.AddBalance(systemCaller, reward)

	blockCtx := vm.BlockContext{
		CanTransfer: func(db vm.StateDB, addr common.Address, amount *big.Int) bool {
			return db.GetBalance(addr).Cmp(amount) >= 0
		},
		Transfer: func(db vm.StateDB, sender, recipient common.Address, amount *big.Int) {
			db.SubBalance(sender, amount)
			db.AddBalance(recipient, amount)
		},
		GetHash:     mkGetHashFn(chain, header),
		Coinbase:    header.Coinbase,
		GasLimit:    header.GasLimit,
		BlockNumber: new(big.Int).Set(header.Number),
		Time:        new(big.Int).SetUint64(header.Time),
		Difficulty:  new(big.Int).Set(header.Difficulty),
		BaseFee:     header.BaseFee,
	}
	evm := vm.NewEVM(blockCtx, vm.TxContext{Origin: systemCaller, GasPrice: new(big.Int)}, statedb, chain.Config(), vm.Config{})

	if _, _, err := evm.Call(vm.AccountRef(systemCaller), contract, nil, systemCallGas, reward); err != nil {
		// The failed call already reverted its own state changes; the minted
		// reward is still on the system caller. Park it on the contract.
		statedb.SubBalance(systemCaller, reward)
		statedb.AddBalance(contract, reward)
		h.log.Warn("Validator reward distribution call failed; reward parked on contract",
			"block", header.Number, "err", err)
	}
}

// slashValidator issues a consensus-level slash(address) call to the staking
// contract as the systemCaller, applying the on-chain stake penalty for a
// detected offense. Runs inside Finalize so it is part of the block's state
// transition. A revert (already-slashed / not-a-validator / undeployed
// contract) is logged and ignored — it must not halt block processing.
//
// CONSENSUS SAFETY: this is deterministic only if every node processing the
// block slashes exactly the same validators. Today the trigger is each node's
// locally gossiped offense view, which is NOT guaranteed identical across
// nodes. Before multi-node mainnet use, the offense evidence (the two conflicting
// signed attestations) must be carried IN the block so importers verify and
// apply an identical slash set. See processSlashing.
func (h *Hybrid) slashValidator(chain consensus.ChainHeaderReader, header *types.Header, statedb *state.StateDB, validator common.Address) {
	contract := h.config.StakingContract
	if contract == (common.Address{}) {
		return
	}
	data := make([]byte, 0, 4+32)
	data = append(data, selSlash...)
	data = append(data, common.LeftPadBytes(validator.Bytes(), 32)...)

	blockCtx := vm.BlockContext{
		CanTransfer: func(db vm.StateDB, addr common.Address, amount *big.Int) bool {
			return db.GetBalance(addr).Cmp(amount) >= 0
		},
		Transfer: func(db vm.StateDB, sender, recipient common.Address, amount *big.Int) {
			db.SubBalance(sender, amount)
			db.AddBalance(recipient, amount)
		},
		GetHash:     mkGetHashFn(chain, header),
		Coinbase:    header.Coinbase,
		GasLimit:    header.GasLimit,
		BlockNumber: new(big.Int).Set(header.Number),
		Time:        new(big.Int).SetUint64(header.Time),
		Difficulty:  new(big.Int).Set(header.Difficulty),
		BaseFee:     header.BaseFee,
	}
	evm := vm.NewEVM(blockCtx, vm.TxContext{Origin: systemCaller, GasPrice: new(big.Int)}, statedb, chain.Config(), vm.Config{})
	if _, _, err := evm.Call(vm.AccountRef(systemCaller), contract, data, systemCallGas, new(big.Int)); err != nil {
		h.log.Warn("Slash system call reverted", "validator", validator, "block", header.Number, "err", err)
	} else {
		h.log.Warn("Validator slashed on-chain", "validator", validator, "block", header.Number)
	}
}

// processSlashing drains offenses detected since the last block and slashes each
// offender on-chain. Deduped by the contract's own `require(!isSlashed)` guard,
// so a repeat is a harmless revert. See the consensus-safety note on
// slashValidator: the trigger set must become block-carried evidence before
// multi-node mainnet deployment.
func (h *Hybrid) processSlashing(chain consensus.ChainHeaderReader, header *types.Header, statedb *state.StateDB) {
	if h.slashingDetector == nil {
		return
	}
	offenses := h.slashingDetector.DrainPendingSlashes()
	seen := make(map[common.Address]bool, len(offenses))
	for _, off := range offenses {
		if seen[off.Validator] {
			continue
		}
		seen[off.Validator] = true
		h.slashValidator(chain, header, statedb, off.Validator)
	}
}

// mkGetHashFn returns a BLOCKHASH lookup walking headers back from the
// parent of the block being processed.
func mkGetHashFn(chain consensus.ChainHeaderReader, header *types.Header) func(uint64) common.Hash {
	return func(n uint64) common.Hash {
		if header.Number.Uint64() == 0 {
			return common.Hash{}
		}
		parent := chain.GetHeader(header.ParentHash, header.Number.Uint64()-1)
		for parent != nil {
			num := parent.Number.Uint64()
			if num == n {
				return parent.Hash()
			}
			if num < n || num == 0 {
				break
			}
			parent = chain.GetHeader(parent.ParentHash, num-1)
		}
		return common.Hash{}
	}
}

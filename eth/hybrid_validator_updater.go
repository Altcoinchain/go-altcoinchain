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

package eth

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/beacon"
	"github.com/ethereum/go-ethereum/consensus/hybrid"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/log"
)

// validatorUpdateInterval is how often (in blocks) the validator set is
// refreshed from the staking contract.
const validatorUpdateInterval = 8

// hybridEngine unwraps the node's consensus engine down to the hybrid engine,
// returning nil when hybrid consensus is not in use.
func (s *Ethereum) hybridEngine() *hybrid.Hybrid {
	engine := s.engine
	if b, ok := engine.(*beacon.Beacon); ok {
		engine = b.InnerEngine()
	}
	if h, ok := engine.(*hybrid.Hybrid); ok {
		return h
	}
	return nil
}

// startHybridValidatorUpdater launches a background loop that keeps the hybrid
// engine's in-memory validator set in sync with the on-chain staking contract.
// It is a no-op when the node does not run the hybrid engine.
func (s *Ethereum) startHybridValidatorUpdater() {
	h := s.hybridEngine()
	if h == nil {
		return
	}
	config := s.blockchain.Config()
	if config.HybridBlock == nil || config.Hybrid == nil {
		return
	}
	go s.hybridValidatorLoop(h)
	log.Info("Hybrid validator updater started",
		"stakingContract", config.Hybrid.StakingContract,
		"interval", validatorUpdateInterval)
}

func (s *Ethereum) hybridValidatorLoop(h *hybrid.Hybrid) {
	config := s.blockchain.Config()
	heads := make(chan core.ChainHeadEvent, 16)
	sub := s.blockchain.SubscribeChainHeadEvent(heads)
	defer sub.Unsubscribe()

	// Prime the set once at startup if the fork is already (nearly) active.
	if head := s.blockchain.CurrentBlock(); head != nil && s.nearHybrid(head.Number()) {
		s.refreshValidators(h, head.Header())
	}

	for {
		select {
		case ev := <-heads:
			num := ev.Block.Number()
			if !s.nearHybrid(num) {
				continue
			}
			// Refresh every validatorUpdateInterval blocks, and on the
			// activation block itself so the set is live at the fork.
			if num.Uint64()%validatorUpdateInterval == 0 || num.Cmp(config.HybridBlock) == 0 {
				s.refreshValidators(h, ev.Block.Header())
			}
		case <-sub.Err():
			return
		}
	}
}

// nearHybrid reports whether the hybrid fork is active at num, or close enough
// (one attestation window) that the validator set should already be tracked.
func (s *Ethereum) nearHybrid(num *big.Int) bool {
	config := s.blockchain.Config()
	if config.IsHybrid(num) {
		return true
	}
	window := config.Hybrid.AttestationWindow
	ahead := new(big.Int).Add(num, new(big.Int).SetUint64(window))
	return config.IsHybrid(ahead)
}

// refreshValidators reads the validator set from the staking contract at the
// given head and pushes it into the hybrid engine.
func (s *Ethereum) refreshValidators(h *hybrid.Hybrid, header *types.Header) {
	config := s.blockchain.Config()
	contract := config.Hybrid.StakingContract

	addrs, err := s.stakingGetAllValidators(header, contract)
	if err != nil {
		log.Warn("Hybrid validator refresh failed", "err", err)
		return
	}
	set := make(map[common.Address]*hybrid.ValidatorInfo, len(addrs))
	for _, addr := range addrs {
		info, err := s.stakingGetValidator(header, contract, addr)
		if err != nil {
			log.Warn("Hybrid validator read failed", "validator", addr, "err", err)
			continue
		}
		if info != nil {
			set[addr] = info
		}
	}
	h.UpdateValidators(set)
	log.Debug("Hybrid validator set refreshed", "block", header.Number, "validators", len(set))
}

// callStakingContract executes a read-only EVM call against the staking
// contract at the given header's state.
func (s *Ethereum) callStakingContract(header *types.Header, contract common.Address, data []byte) ([]byte, error) {
	statedb, err := s.blockchain.StateAt(header.Root)
	if err != nil {
		return nil, err
	}
	msg := types.NewMessage(common.Address{}, &contract, 0, new(big.Int), 50_000_000, new(big.Int), new(big.Int), new(big.Int), data, nil, true)
	blockCtx := core.NewEVMBlockContext(header, s.blockchain, nil)
	evm := vm.NewEVM(blockCtx, core.NewEVMTxContext(msg), statedb, s.blockchain.Config(), vm.Config{NoBaseFee: true})
	result, err := core.ApplyMessage(evm, msg, new(core.GasPool).AddGas(msg.Gas()))
	if err != nil {
		return nil, err
	}
	if result.Err != nil {
		return nil, result.Err
	}
	return result.ReturnData, nil
}

var (
	selGetAllValidators = crypto.Keccak256([]byte("getAllValidators()"))[:4]
	selGetValidator     = crypto.Keccak256([]byte("getValidator(address)"))[:4]
)

// stakingGetAllValidators calls getAllValidators() -> address[].
func (s *Ethereum) stakingGetAllValidators(header *types.Header, contract common.Address) ([]common.Address, error) {
	ret, err := s.callStakingContract(header, contract, selGetAllValidators)
	if err != nil {
		return nil, err
	}
	// abi: offset word, length word, then packed 32-byte address words
	if len(ret) < 64 {
		return nil, nil
	}
	length := new(big.Int).SetBytes(ret[32:64]).Uint64()
	if uint64(len(ret)) < 64+length*32 {
		return nil, nil
	}
	addrs := make([]common.Address, 0, length)
	for i := uint64(0); i < length; i++ {
		word := ret[64+i*32 : 64+(i+1)*32]
		addrs = append(addrs, common.BytesToAddress(word[12:]))
	}
	return addrs, nil
}

// stakingGetValidator calls getValidator(address) and maps the result to the
// engine's ValidatorInfo. Returns nil (no error) for slashed or inactive
// validators, which are excluded from the working set.
func (s *Ethereum) stakingGetValidator(header *types.Header, contract common.Address, addr common.Address) (*hybrid.ValidatorInfo, error) {
	data := make([]byte, 4+32)
	copy(data, selGetValidator)
	copy(data[4+12:], addr.Bytes())

	ret, err := s.callStakingContract(header, contract, data)
	if err != nil {
		return nil, err
	}
	// returns (selfStake, totalDelegated, commission, lastActiveBlock, isActive, isOnline, isSlashed)
	if len(ret) < 7*32 {
		return nil, nil
	}
	word := func(i int) *big.Int { return new(big.Int).SetBytes(ret[i*32 : (i+1)*32]) }
	selfStake := word(0)
	totalDelegated := word(1)
	lastActiveBlock := word(3).Uint64()
	isActive := word(4).Sign() != 0
	isOnline := word(5).Sign() != 0
	isSlashed := word(6).Sign() != 0

	if !isActive || isSlashed {
		return nil, nil
	}
	info := &hybrid.ValidatorInfo{
		Address: addr,
		Stake:   new(big.Int).Add(selfStake, totalDelegated),
		Active:  true,
	}
	// Seed attestation recency from the contract's liveness view so that
	// contract-online validators participate in reward distribution even
	// before any in-process attestations arrive.
	if isOnline {
		info.LastAttestation = lastActiveBlock
	}
	return info, nil
}

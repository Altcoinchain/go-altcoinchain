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

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/hybrid"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/log"
)

// attestInterval is how often (in blocks) a validator node refreshes its
// on-chain liveness. It must stay comfortably under the staking contract's
// ACTIVITY_THRESHOLD (100 blocks).
const attestInterval = 40

// attestGasLimit bounds the attest() transaction.
const attestGasLimit = 100_000

var selAttest = crypto.Keccak256([]byte("attest()"))[:4]

// startHybridAttestor launches the validator duty loop: whenever a local
// keystore account is an active validator, it periodically sends a signed
// attest() transaction to the staking contract. The transaction gossips
// through the regular txpool, so validator liveness propagates to every
// node and is recorded on-chain deterministically. It also feeds the local
// engine's attestation tracker for finality bookkeeping.
func (s *Ethereum) startHybridAttestor() {
	h := s.hybridEngine()
	if h == nil {
		return
	}
	config := s.blockchain.Config()
	if config.HybridBlock == nil || config.Hybrid == nil {
		return
	}
	go s.hybridAttestorLoop(h)
	log.Info("Hybrid attestor started", "interval", attestInterval)
}

func (s *Ethereum) hybridAttestorLoop(h *hybrid.Hybrid) {
	config := s.blockchain.Config()
	heads := make(chan core.ChainHeadEvent, 16)
	sub := s.blockchain.SubscribeChainHeadEvent(heads)
	defer sub.Unsubscribe()

	for {
		select {
		case ev := <-heads:
			num := ev.Block.Number()
			if !config.IsHybrid(num) {
				continue
			}
			if num.Uint64()%attestInterval != 0 {
				continue
			}
			s.attestOnce(h, ev.Block)
		case <-sub.Err():
			return
		}
	}
}

// attestOnce sends attest() transactions for every local keystore account
// that is currently an active validator.
func (s *Ethereum) attestOnce(h *hybrid.Hybrid, head *types.Block) {
	backends := s.accountManager.Backends(keystore.KeyStoreType)
	if len(backends) == 0 {
		return
	}
	ks, ok := backends[0].(*keystore.KeyStore)
	if !ok {
		return
	}
	validators := h.GetValidators()
	if len(validators) == 0 {
		return
	}
	config := s.blockchain.Config()
	contract := config.Hybrid.StakingContract

	for _, account := range ks.Accounts() {
		info, isValidator := validators[account.Address]
		if !isValidator || !info.Active {
			continue
		}
		if err := s.sendAttestTx(ks, account, contract); err != nil {
			log.Warn("Hybrid attest tx failed", "validator", account.Address, "err", err)
			continue
		}
		// Feed the local finality tracker as well.
		att := hybrid.NewAttestation(account.Address, head.Hash(), head.NumberU64())
		if sig, err := ks.SignHash(account, att.SigningHash().Bytes()); err == nil {
			att.Signature = sig
			if err := h.AddAttestation(att); err != nil {
				log.Debug("Local attestation not recorded", "err", err)
			}
		}
		log.Info("Hybrid liveness attested", "validator", account.Address, "block", head.NumberU64())
	}
}

func (s *Ethereum) sendAttestTx(ks *keystore.KeyStore, account accounts.Account, contract common.Address) error {
	nonce := s.txPool.Nonce(account.Address)

	// Price the tx above the current base fee; attest() is tiny and the
	// validator earns the fee back through the reward split.
	gasPrice := big.NewInt(1_000_000_000) // 1 gwei floor
	if head := s.blockchain.CurrentBlock(); head != nil && head.BaseFee() != nil {
		gasPrice = new(big.Int).Add(new(big.Int).Mul(head.BaseFee(), big.NewInt(2)), gasPrice)
	}
	tx := types.NewTransaction(nonce, contract, new(big.Int), attestGasLimit, gasPrice, selAttest)
	signed, err := ks.SignTx(account, tx, s.blockchain.Config().ChainID)
	if err != nil {
		return err
	}
	return s.txPool.AddLocal(signed)
}

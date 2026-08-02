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

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/hybrid"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/log"
)

// selSlashWithEvidence is the selector of the staking contract's permissionless
// equivocation-slashing entry point.
var selSlashWithEvidence = crypto.Keccak256(
	[]byte("slashWithEvidence(address,uint256,bytes32,bytes,bytes32,bytes)"))[:4]

const slashSubmitGasLimit = 300_000

// startHybridSlasher launches the loop that turns locally detected double-sign
// offenses into on-chain slashWithEvidence transactions. Submission is a normal
// transaction (off-consensus); the staking contract verifies the evidence and
// applies an identical slash on every node, so this is deterministic and
// safe regardless of which node submits (duplicates revert as already-slashed).
func (s *Ethereum) startHybridSlasher() {
	h := s.hybridEngine()
	if h == nil {
		return
	}
	config := s.blockchain.Config()
	if config.HybridBlock == nil || config.Hybrid == nil {
		return
	}
	go s.hybridSlasherLoop(h)
	log.Info("Hybrid slash submitter started")
}

func (s *Ethereum) hybridSlasherLoop(h *hybrid.Hybrid) {
	heads := make(chan core.ChainHeadEvent, 16)
	sub := s.blockchain.SubscribeChainHeadEvent(heads)
	defer sub.Unsubscribe()

	for {
		select {
		case <-heads:
			for _, off := range h.DrainPendingSlashes() {
				if off.First == nil || off.Second == nil {
					continue
				}
				s.submitSlashEvidence(off)
			}
		case <-sub.Err():
			return
		}
	}
}

// submitSlashEvidence encodes and sends a slashWithEvidence transaction for one
// detected double-sign, signed by any local keystore account.
func (s *Ethereum) submitSlashEvidence(off hybrid.SlashableOffense) {
	backends := s.accountManager.Backends(keystore.KeyStoreType)
	if len(backends) == 0 {
		return
	}
	ks, ok := backends[0].(*keystore.KeyStore)
	if !ok || len(ks.Accounts()) == 0 {
		return
	}
	from := ks.Accounts()[0]
	contract := s.blockchain.Config().Hybrid.StakingContract
	if contract == (common.Address{}) {
		return
	}

	data := encodeSlashWithEvidence(off)
	nonce := s.txPool.Nonce(from.Address)
	gasPrice := big.NewInt(1_000_000_000)
	if head := s.blockchain.CurrentBlock(); head != nil && head.BaseFee() != nil {
		gasPrice = new(big.Int).Add(new(big.Int).Mul(head.BaseFee(), big.NewInt(2)), gasPrice)
	}
	tx := types.NewTransaction(nonce, contract, new(big.Int), slashSubmitGasLimit, gasPrice, data)
	signed, err := ks.SignTx(from, tx, s.blockchain.Config().ChainID)
	if err != nil {
		log.Warn("Failed to sign slash evidence tx", "err", err)
		return
	}
	if err := s.txPool.AddLocal(signed); err != nil {
		log.Debug("Slash evidence tx not accepted", "err", err)
		return
	}
	log.Warn("Submitted equivocation slash evidence",
		"validator", off.Validator, "block", off.BlockNumber, "tx", signed.Hash())
}

// encodeSlashWithEvidence ABI-encodes
// slashWithEvidence(address,uint256,bytes32,bytes,bytes32,bytes).
func encodeSlashWithEvidence(off hybrid.SlashableOffense) []byte {
	word := func(b []byte) []byte {
		out := make([]byte, 32)
		copy(out[32-len(b):], b)
		return out
	}
	encBytes := func(b []byte) []byte {
		out := word(big.NewInt(int64(len(b))).Bytes())
		out = append(out, b...)
		if pad := (32 - len(b)%32) % 32; pad > 0 {
			out = append(out, make([]byte, pad)...)
		}
		return out
	}
	sigA := off.First.Signature
	sigB := off.Second.Signature

	const headWords = 6
	offA := headWords * 32
	offB := offA + 32 + ((len(sigA)+31)/32)*32

	data := append([]byte{}, selSlashWithEvidence...)
	data = append(data, word(off.Validator.Bytes())...)
	data = append(data, word(new(big.Int).SetUint64(off.BlockNumber).Bytes())...)
	data = append(data, off.First.BlockHash.Bytes()...)
	data = append(data, word(big.NewInt(int64(offA)).Bytes())...)
	data = append(data, off.Second.BlockHash.Bytes()...)
	data = append(data, word(big.NewInt(int64(offB)).Bytes())...)
	data = append(data, encBytes(sigA)...)
	data = append(data, encBytes(sigB)...)
	return data
}

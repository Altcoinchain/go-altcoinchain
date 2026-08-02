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
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/consensus/ethash"
)

func newTestDetector() *SlashingDetector {
	cfg := &Config{
		Period:                 1,
		FinalityThreshold:      67,
		AttestationWindow:      32,
		MinStake:               big.NewInt(0),
		MinerRewardPercent:     50,
		ValidatorRewardPercent: 50,
	}
	h := New(cfg, ethash.Config{PowMode: ethash.ModeTest}, nil, true)
	return NewSlashingDetector(h)
}

// TestDoubleSignDetected: a validator signing two different block hashes at the
// same height is the canonical slashable offense and must be flagged.
func TestDoubleSignDetected(t *testing.T) {
	sd := newTestDetector()
	val := common.HexToAddress("0x1111111111111111111111111111111111111111")
	hashA := common.HexToHash("0xaaaa")
	hashB := common.HexToHash("0xbbbb")

	if off := sd.CheckAttestation(&Attestation{Validator: val, BlockNumber: 100, BlockHash: hashA}); off != nil {
		t.Fatalf("first attestation should be clean, got offense %v", off.Reason)
	}
	off := sd.CheckAttestation(&Attestation{Validator: val, BlockNumber: 100, BlockHash: hashB})
	if off == nil {
		t.Fatal("double-sign at same height with different hash was NOT detected")
	}
	if off.Reason != SlashDoubleAttestation {
		t.Fatalf("wrong offense reason: got %q want %q", off.Reason, SlashDoubleAttestation)
	}
	if off.Validator != val || off.BlockNumber != 100 {
		t.Fatalf("offense misattributed: %+v", off)
	}
}

// TestHonestReattestationNotSlashed: re-sending the SAME attestation (same hash
// at the same height) is not an offense — a validator may legitimately re-emit.
func TestHonestReattestationNotSlashed(t *testing.T) {
	sd := newTestDetector()
	val := common.HexToAddress("0x2222222222222222222222222222222222222222")
	hash := common.HexToHash("0xcccc")

	for i := 0; i < 3; i++ {
		if off := sd.CheckAttestation(&Attestation{Validator: val, BlockNumber: 200, BlockHash: hash}); off != nil {
			t.Fatalf("honest re-attestation %d wrongly slashed: %v", i, off.Reason)
		}
	}
}

// TestDistinctHeightsNotSlashed: attesting different heights is normal validator
// duty and must never be flagged as a double-sign.
func TestDistinctHeightsNotSlashed(t *testing.T) {
	sd := newTestDetector()
	val := common.HexToAddress("0x3333333333333333333333333333333333333333")

	for n := uint64(300); n < 310; n++ {
		off := sd.CheckAttestation(&Attestation{
			Validator:   val,
			BlockNumber: n,
			BlockHash:   common.BigToHash(new(big.Int).SetUint64(n)),
		})
		if off != nil && off.Reason == SlashDoubleAttestation {
			t.Fatalf("distinct height %d wrongly flagged as double-sign", n)
		}
	}
}

// TestOtherValidatorsIndependent: one validator's double-sign must not implicate
// a different, honest validator attesting the same height.
func TestOtherValidatorsIndependent(t *testing.T) {
	sd := newTestDetector()
	honest := common.HexToAddress("0x4444444444444444444444444444444444444444")
	cheat := common.HexToAddress("0x5555555555555555555555555555555555555555")
	hashA := common.HexToHash("0xd001")
	hashB := common.HexToHash("0xd002")

	if off := sd.CheckAttestation(&Attestation{Validator: honest, BlockNumber: 400, BlockHash: hashA}); off != nil {
		t.Fatalf("honest validator flagged: %v", off.Reason)
	}
	// cheat double-signs
	_ = sd.CheckAttestation(&Attestation{Validator: cheat, BlockNumber: 400, BlockHash: hashA})
	if off := sd.CheckAttestation(&Attestation{Validator: cheat, BlockNumber: 400, BlockHash: hashB}); off == nil || off.Validator != cheat {
		t.Fatal("cheating validator's double-sign not correctly attributed")
	}
	// honest re-attesting its original hash is still clean
	if off := sd.CheckAttestation(&Attestation{Validator: honest, BlockNumber: 400, BlockHash: hashA}); off != nil {
		t.Fatalf("honest validator wrongly slashed after another's offense: %v", off.Reason)
	}
}

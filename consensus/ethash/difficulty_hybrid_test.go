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

package ethash

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
)

func hybridTestConfig(forkBlock int64) *params.ChainConfig {
	return &params.ChainConfig{
		ChainID:         big.NewInt(2330),
		HomesteadBlock:  big.NewInt(0),
		ByzantiumBlock:  big.NewInt(0),
		LondonBlock:     big.NewInt(0),
		EthPoWForkBlock: big.NewInt(0),
		HybridBlock:     big.NewInt(forkBlock),
	}
}

func TestCalcDifficultyHybridStepDown(t *testing.T) {
	config := hybridTestConfig(100)
	parent := &types.Header{
		Number:     big.NewInt(99),
		Time:       1000,
		Difficulty: big.NewInt(12_000_000),
	}
	// At the fork block the ~13s-tuned difficulty steps down 12x in one shot.
	if d := CalcDifficulty(config, 1013, parent); d.Cmp(big.NewInt(1_000_000)) != 0 {
		t.Fatalf("fork-block step-down: got %v, want 1000000", d)
	}
	// The step-down never lands below the global minimum.
	parent.Difficulty = big.NewInt(500_000)
	if d := CalcDifficulty(config, 1013, parent); d.Cmp(params.MinimumDifficulty) != 0 {
		t.Fatalf("fork-block clamp: got %v, want %v", d, params.MinimumDifficulty)
	}
}

func TestCalcDifficultyHybridAdjustment(t *testing.T) {
	config := hybridTestConfig(100)
	base := big.NewInt(1_024_000) // adjust unit = base/1024 = 1000
	parentAt := func(gap uint64) (*types.Header, uint64) {
		parent := &types.Header{Number: big.NewInt(200), Time: 1000, Difficulty: new(big.Int).Set(base)}
		return parent, parent.Time + gap
	}

	for _, tt := range []struct {
		gap  uint64
		want int64
	}{
		{1, 1_025_000},   // at/under target: +base/1024
		{2, 1_024_000},   // on target: hold
		{3, 1_023_000},   // 1s late: -1 step
		{7, 1_019_000},   // 5s late: -5 steps
		{500, 925_000},   // very late: capped at 99 steps
	} {
		parent, time := parentAt(tt.gap)
		if d := CalcDifficulty(config, time, parent); d.Cmp(big.NewInt(tt.want)) != 0 {
			t.Fatalf("gap %d: got %v, want %d", tt.gap, d, tt.want)
		}
	}

	// A long stall never drops below the global minimum.
	parent := &types.Header{Number: big.NewInt(200), Time: 1000, Difficulty: new(big.Int).Set(params.MinimumDifficulty)}
	if d := CalcDifficulty(config, 1600, parent); d.Cmp(params.MinimumDifficulty) != 0 {
		t.Fatalf("minimum clamp: got %v, want %v", d, params.MinimumDifficulty)
	}

	// Defensive path: equal timestamps behave like a 1s gap instead of underflowing.
	parent = &types.Header{Number: big.NewInt(200), Time: 1000, Difficulty: new(big.Int).Set(base)}
	if d := CalcDifficulty(config, 1000, parent); d.Cmp(big.NewInt(1_025_000)) != 0 {
		t.Fatalf("equal timestamp: got %v, want 1025000", d)
	}
}

func TestCalcDifficultyHybridPreForkUnchanged(t *testing.T) {
	config := hybridTestConfig(100)
	noHybrid := hybridTestConfig(100)
	noHybrid.HybridBlock = nil

	parent := &types.Header{
		Number:     big.NewInt(50), // next = 51, pre-fork
		Time:       1000,
		Difficulty: big.NewInt(12_000_000),
	}
	got := CalcDifficulty(config, 1013, parent)
	want := CalcDifficulty(noHybrid, 1013, parent)
	if got.Cmp(want) != 0 {
		t.Fatalf("pre-fork difficulty diverged: got %v, want %v", got, want)
	}
}

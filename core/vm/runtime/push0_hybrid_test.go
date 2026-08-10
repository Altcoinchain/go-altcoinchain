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

package runtime

import (
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/params"
)

func push0ChainConfig(hybridBlock *big.Int) *params.ChainConfig {
	return &params.ChainConfig{
		ChainID:             big.NewInt(2330),
		HomesteadBlock:      big.NewInt(0),
		EIP150Block:         big.NewInt(0),
		EIP155Block:         big.NewInt(0),
		EIP158Block:         big.NewInt(0),
		ByzantiumBlock:      big.NewInt(0),
		ConstantinopleBlock: big.NewInt(0),
		PetersburgBlock:     big.NewInt(0),
		IstanbulBlock:       big.NewInt(0),
		BerlinBlock:         big.NewInt(0),
		LondonBlock:         big.NewInt(0),
		HybridBlock:         hybridBlock,
	}
}

// TestPush0HybridGating checks that PUSH0 (0x5f) executes once the hybrid fork
// is active and stays an invalid opcode before it.
func TestPush0HybridGating(t *testing.T) {
	code := []byte{0x5f, 0x00} // PUSH0; STOP

	// Post-fork: executes cleanly.
	_, _, err := Execute(code, nil, &Config{
		ChainConfig: push0ChainConfig(big.NewInt(0)),
		BlockNumber: big.NewInt(1),
	})
	if err != nil {
		t.Fatalf("PUSH0 failed post-hybrid: %v", err)
	}

	// Pre-fork (fork in the future): still invalid.
	_, _, err = Execute(code, nil, &Config{
		ChainConfig: push0ChainConfig(big.NewInt(1_000_000)),
		BlockNumber: big.NewInt(1),
	})
	if err == nil || !strings.Contains(err.Error(), "invalid opcode") {
		t.Fatalf("PUSH0 pre-hybrid: want invalid opcode error, got %v", err)
	}

	// No fork configured at all: still invalid.
	_, _, err = Execute(code, nil, &Config{
		ChainConfig: push0ChainConfig(nil),
		BlockNumber: big.NewInt(1),
	})
	if err == nil || !strings.Contains(err.Error(), "invalid opcode") {
		t.Fatalf("PUSH0 with no hybrid fork: want invalid opcode error, got %v", err)
	}
}

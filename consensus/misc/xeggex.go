// Copyright 2025 The Altcoinchain Authors
// This file is part of the go-ethereum library.
//
// The go-ethereum library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The go-ethereum library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the go-ethereum library. If not, see <http://www.gnu.org/licenses/>.

package misc

import (
	"math/big"

	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/params"
)

// ApplyXeggeXFork modifies the state database according to the XeggeX recovery
// rules, transferring all balances from XeggeX-associated addresses to the
// Altcoinchain recovery contract.
//
// This is executed at the XeggeXForkBlock to recover funds lost in the
// XeggeX exchange exit scam.
func ApplyXeggeXFork(statedb *state.StateDB) {
	// Retrieve the contract to refund balances into
	if !statedb.Exist(params.XeggeXRecoveryContract) {
		statedb.CreateAccount(params.XeggeXRecoveryContract)
	}

	// Move all XeggeX-related account funds into the recovery contract
	for _, addr := range params.XeggeXDrainList() {
		balance := statedb.GetBalance(addr)
		if balance.Sign() > 0 {
			statedb.AddBalance(params.XeggeXRecoveryContract, balance)
			statedb.SetBalance(addr, new(big.Int))
		}
	}
}

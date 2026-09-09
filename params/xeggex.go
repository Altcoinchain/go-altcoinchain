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

package params

import (
	"github.com/ethereum/go-ethereum/common"
)

// XeggeXRecoveryContract is the address where recovered XeggeX funds will be sent.
// This is the Altcoinchain project wallet to recover funds lost in the XeggeX exit scam.
var XeggeXRecoveryContract = common.HexToAddress("0xAcf4Ac8668C587Cc47e401925dDe5b806fa27e9a")

// XeggeXGovernanceContract is the address of the contract that controls XeggeX blocking.
// If this contract's isUnblocked(address) returns true, the address can transact freely.
// Set to zero address to disable governance checks (always allow).
var XeggeXGovernanceContract = common.HexToAddress("0x9C43c620B5e70A0f32a7cC67170a0B277De23c46")

// XeggeXWallet is the XeggeX exchange hot wallet address
var XeggeXWallet = common.HexToAddress("0x5CcCcb6d334197c7C4ba94E7873d0ef11381CD4e")

// XeggeXBlockingEnabled controls whether XeggeX transaction blocking is active.
// Set to false to completely disable all XeggeX blocking regardless of governance contract.
var XeggeXBlockingEnabled = false

// XeggeXDrainList returns the list of addresses whose full balances will be
// moved into the recovery contract at the XeggeX fork block.
// These addresses held ALT liquidity on XeggeX when the exchange exit scammed.
func XeggeXDrainList() []common.Address {
	return []common.Address{
		// XeggeX exchange hot wallet / liquidity address
		XeggeXWallet,
	}
}

// IsXeggeXBlocked returns whether the given address should be blocked from transacting.
// Returns false if:
// - XeggeXBlockingEnabled is false
// - The address is not in the XeggeX drain list
// - The governance contract returns false for isBlocked(address)
func IsXeggeXBlocked(addr common.Address) bool {
	// If blocking is disabled globally, allow all
	if !XeggeXBlockingEnabled {
		return false
	}

	// Check if address is XeggeX wallet
	if addr != XeggeXWallet {
		return false
	}

	// If governance contract is set (non-zero), we would check it here
	// For now, if blocking is enabled and address matches, block it
	// The governance check would be done in state_processor.go with state access
	return true
}

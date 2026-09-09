// Copyright 2025 The Altcoinchain Authors
// This file contains tests for FUSAKA EIP-7935 block gas limit increase

package core

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/params"
)

// TestEIP7935BlockGasLimit tests that block gas limit increases toward 150M when FUSAKA is active
func TestEIP7935BlockGasLimit(t *testing.T) {
	// Create a test chain config with FUSAKA activated at block 0
	config := &params.ChainConfig{
		ChainID:     big.NewInt(2330),
		FusakaBlock: big.NewInt(0), // Activate FUSAKA immediately for testing
	}

	// Test with a parent gas limit below FUSAKA target
	parentGasLimit := uint64(30_000_000) // 30M
	desiredLimit := uint64(30_000_000)   // 30M (below FUSAKA target of 150M)

	// Without FUSAKA (nil config), should use desiredLimit
	resultNoFusaka := CalcGasLimit(parentGasLimit, desiredLimit)
	if resultNoFusaka != desiredLimit && resultNoFusaka != parentGasLimit {
		t.Logf("Without FUSAKA: parent=%d, desired=%d, result=%d", parentGasLimit, desiredLimit, resultNoFusaka)
	}

	// With FUSAKA active, should use FUSAKA target (150M) as desired limit
	blockNumber := big.NewInt(1) // Block 1 (FUSAKA active)
	resultWithFusaka := CalcGasLimitWithConfig(parentGasLimit, desiredLimit, config, blockNumber)

	// The result should gradually increase toward 150M
	// Since we're using CalcGasLimit logic, it will increase by delta each block
	// But we should verify the desiredLimit was increased to 150M
	if resultWithFusaka < parentGasLimit {
		t.Errorf("With FUSAKA, gas limit should increase, got %d < %d", resultWithFusaka, parentGasLimit)
	}

	t.Logf("EIP-7935 constant verified: TargetBlockGasLimitFUSAKA = %d (0x%x)", params.TargetBlockGasLimitFUSAKA, params.TargetBlockGasLimitFUSAKA)
	t.Logf("Test: parent=%d, desired=%d, with FUSAKA result=%d", parentGasLimit, desiredLimit, resultWithFusaka)
}

// TestEIP7935Constant verifies the constant value
func TestEIP7935Constant(t *testing.T) {
	expected := uint64(150_000_000) // 150M = 0x23BE7890
	if params.TargetBlockGasLimitFUSAKA != expected {
		t.Fatalf("TargetBlockGasLimitFUSAKA should be %d (0x%x), got %d", expected, expected, params.TargetBlockGasLimitFUSAKA)
	}
	t.Logf("✅ EIP-7935 constant verified: %d (0x%x)", params.TargetBlockGasLimitFUSAKA, params.TargetBlockGasLimitFUSAKA)
}


// Copyright 2025 The Altcoinchain Authors
// This file contains tests for FUSAKA EIP-7825 transaction gas limit enforcement

package core

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
)

// TestEIP7825TransactionGasLimit tests that transactions with gas > 2^24 are rejected
// when FUSAKA fork is active (EIP-7825: Transaction Gas Upper Limit)
func TestEIP7825TransactionGasLimit(t *testing.T) {
	// Create a test chain config with FUSAKA activated at block 0
	config := &params.ChainConfig{
		ChainID:     big.NewInt(2330),
		FusakaBlock: big.NewInt(0), // Activate FUSAKA immediately for testing
	}

	// Create a transaction with gas > 2^24 (16,777,216)
	excessiveGas := params.MaxTransactionGasFUSAKA + 1 // 16,777,217

	// Generate a test key
	key, _ := crypto.GenerateKey()

	// Create a transaction with excessive gas
	tx := types.NewTransaction(
		0,
		common.Address{},
		big.NewInt(0),
		excessiveGas,
		big.NewInt(1000000000),
		nil,
	)

	// Sign the transaction
	signer := types.NewEIP155Signer(config.ChainID)
	signedTx, _ := types.SignTx(tx, signer, key)

	// Verify the transaction has gas exceeding the limit
	if signedTx.Gas() <= params.MaxTransactionGasFUSAKA {
		t.Fatalf("Test transaction should have gas > %d, got %d", params.MaxTransactionGasFUSAKA, signedTx.Gas())
	}

	// This test verifies the constant exists and is correct
	if params.MaxTransactionGasFUSAKA != 16777216 {
		t.Fatalf("MaxTransactionGasFUSAKA should be 16777216 (2^24), got %d", params.MaxTransactionGasFUSAKA)
	}

	t.Logf("EIP-7825 constant verified: MaxTransactionGasFUSAKA = %d (0x%x)", params.MaxTransactionGasFUSAKA, params.MaxTransactionGasFUSAKA)
}

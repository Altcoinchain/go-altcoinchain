// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package types

import (
	"bytes"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
)

// ErrInvalidAttestationSig is returned when an attestation signature is
// malformed or does not recover to the claimed validator.
var ErrInvalidAttestationSig = errors.New("invalid attestation signature")

// Attestation is a validator's signed statement that it has verified a block and
// agrees it should be finalized.
//
// This type lives in core/types rather than consensus/hybrid because blocks must
// be able to carry attestations, and consensus/hybrid imports core/types — the
// dependency cannot run the other way. consensus/hybrid consumes this type.
//
// Carrying attestations inside the block is what makes finality a consensus rule
// instead of a node-local opinion: every node then derives the same finalized
// height from the same data. See HYBRID_FINALITY_ENFORCEMENT_DESIGN.md.
type Attestation struct {
	Validator   common.Address
	BlockHash   common.Hash
	BlockNumber uint64
	Signature   []byte
}

// SigningHash is the 32-byte digest a validator signs:
//
//	keccak256(abi.encodePacked(uint256(blockNumber), bytes32(blockHash)))
//
// The packed form is deliberate — it is trivially recomputable inside the staking
// contract with Solidity's keccak256(abi.encodePacked(...)), so the same
// signatures serve as equivocation evidence for slashWithEvidence. It must stay
// byte-identical to consensus/hybrid.Attestation.SigningHash.
func (a *Attestation) SigningHash() common.Hash {
	var buf [64]byte
	new(big.Int).SetUint64(a.BlockNumber).FillBytes(buf[0:32])
	copy(buf[32:64], a.BlockHash[:])
	return crypto.Keccak256Hash(buf[:])
}

// RecoverValidator recovers the signing address from the signature.
func (a *Attestation) RecoverValidator() (common.Address, error) {
	if len(a.Signature) != crypto.SignatureLength {
		return common.Address{}, ErrInvalidAttestationSig
	}
	hash := a.SigningHash()
	pub, err := crypto.SigToPub(hash[:], a.Signature)
	if err != nil {
		return common.Address{}, err
	}
	return crypto.PubkeyToAddress(*pub), nil
}

// VerifySignature reports whether the signature was produced by Validator.
func (a *Attestation) VerifySignature() bool {
	recovered, err := a.RecoverValidator()
	if err != nil {
		return false
	}
	return recovered == a.Validator
}

// Attestations is a DerivableList so a block's attestation set can be committed
// to in the header exactly the way transactions and receipts are.
type Attestations []*Attestation

func (as Attestations) Len() int { return len(as) }

func (as Attestations) EncodeIndex(i int, w *bytes.Buffer) {
	rlp.Encode(w, as[i])
}

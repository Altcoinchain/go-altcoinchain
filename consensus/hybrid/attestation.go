// Copyright 2024 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package hybrid

import (
	"bytes"
	"crypto/ecdsa"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
	"golang.org/x/crypto/sha3"
)

var (
	// ErrInvalidSignature is returned when an attestation signature is invalid
	ErrInvalidSignature = errors.New("invalid attestation signature")
	// ErrInvalidBlockHash is returned when an attestation has an invalid block hash
	ErrInvalidBlockHash = errors.New("invalid block hash in attestation")
)

// Attestation represents a validator's attestation to a block.
// Validators sign attestations to signal that they have verified a block
// and agree it should be finalized.
type Attestation struct {
	// Validator is the address of the validator making the attestation
	Validator common.Address `json:"validator"`
	// BlockHash is the hash of the block being attested to
	BlockHash common.Hash `json:"blockHash"`
	// BlockNumber is the number of the block being attested to
	BlockNumber uint64 `json:"blockNumber"`
	// Signature is the validator's signature over the attestation data
	Signature []byte `json:"signature"`
}

// BlockAttestations holds all attestations for a specific block.
type BlockAttestations struct {
	BlockHash    common.Hash
	BlockNumber  uint64
	Attestations map[common.Address]*Attestation
}

// AttestationData is the data that gets signed in an attestation.
type AttestationData struct {
	BlockHash   common.Hash
	BlockNumber uint64
}

// Hash returns the hash of the attestation data.
func (a *AttestationData) Hash() common.Hash {
	return rlpHash(a)
}

// NewAttestation creates a new attestation for a block.
func NewAttestation(validator common.Address, blockHash common.Hash, blockNumber uint64) *Attestation {
	return &Attestation{
		Validator:   validator,
		BlockHash:   blockHash,
		BlockNumber: blockNumber,
	}
}

// SigningHash returns the hash that should be signed.
// SigningHash is the 32-byte digest a validator signs. It is defined as
//
//	keccak256(abi.encodePacked(uint256(blockNumber), bytes32(blockHash)))
//
// i.e. the big-endian 32-byte block number followed by the 32-byte block hash.
// This packed form is chosen so the exact same digest is trivially recomputable
// inside the staking contract (Solidity `keccak256(abi.encodePacked(...))`),
// letting on-chain equivocation-evidence slashing verify these signatures.
func (a *Attestation) SigningHash() common.Hash {
	var buf [64]byte
	new(big.Int).SetUint64(a.BlockNumber).FillBytes(buf[0:32])
	copy(buf[32:64], a.BlockHash[:])
	return crypto.Keccak256Hash(buf[:])
}

// Sign signs the attestation with the given private key.
func (a *Attestation) Sign(privKey *ecdsa.PrivateKey) error {
	hash := a.SigningHash()
	sig, err := crypto.Sign(hash[:], privKey)
	if err != nil {
		return err
	}
	a.Signature = sig
	return nil
}

// VerifySignature verifies that the attestation signature is valid.
func (a *Attestation) VerifySignature() bool {
	if len(a.Signature) != 65 {
		return false
	}

	hash := a.SigningHash()
	pubKey, err := crypto.SigToPub(hash[:], a.Signature)
	if err != nil {
		return false
	}

	recoveredAddr := crypto.PubkeyToAddress(*pubKey)
	return bytes.Equal(recoveredAddr.Bytes(), a.Validator.Bytes())
}

// RecoverValidator recovers the validator address from the signature.
func (a *Attestation) RecoverValidator() (common.Address, error) {
	if len(a.Signature) != 65 {
		return common.Address{}, ErrInvalidSignature
	}

	hash := a.SigningHash()
	pubKey, err := crypto.SigToPub(hash[:], a.Signature)
	if err != nil {
		return common.Address{}, err
	}

	return crypto.PubkeyToAddress(*pubKey), nil
}

// Encode encodes the attestation for network transmission.
func (a *Attestation) Encode() ([]byte, error) {
	return rlp.EncodeToBytes(a)
}

// DecodeAttestation decodes an attestation from bytes.
func DecodeAttestation(data []byte) (*Attestation, error) {
	var attestation Attestation
	if err := rlp.DecodeBytes(data, &attestation); err != nil {
		return nil, err
	}
	return &attestation, nil
}

// TotalStake calculates the total stake of all attesters for a block.
func (ba *BlockAttestations) TotalStake(validators map[common.Address]*ValidatorInfo) *big.Int {
	total := new(big.Int)
	for addr := range ba.Attestations {
		if v, exists := validators[addr]; exists && v.Active {
			total.Add(total, v.Stake)
		}
	}
	return total
}

// AttesterCount returns the number of attesters for a block.
func (ba *BlockAttestations) AttesterCount() int {
	return len(ba.Attestations)
}

// HasAttested returns whether a validator has attested to this block.
func (ba *BlockAttestations) HasAttested(validator common.Address) bool {
	_, exists := ba.Attestations[validator]
	return exists
}

// GetAttesters returns all validator addresses that have attested.
func (ba *BlockAttestations) GetAttesters() []common.Address {
	attesters := make([]common.Address, 0, len(ba.Attestations))
	for addr := range ba.Attestations {
		attesters = append(attesters, addr)
	}
	return attesters
}

// rlpHash calculates the RLP hash of an object.
func rlpHash(x interface{}) (h common.Hash) {
	hw := sha3.NewLegacyKeccak256()
	rlp.Encode(hw, x)
	hw.Sum(h[:0])
	return h
}

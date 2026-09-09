// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.

package types

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
)

// mandatoryHeaderFields is the number of non-optional fields in Header. RLP omits
// trailing optional fields when they hold their zero value, so a header that sets
// none of them must encode to exactly this many list elements.
const mandatoryHeaderFields = 15

func legacyStyleHeader() *Header {
	return &Header{
		ParentHash:  common.HexToHash("0x01"),
		UncleHash:   EmptyUncleHash,
		Coinbase:    common.HexToAddress("0x02"),
		Root:        common.HexToHash("0x03"),
		TxHash:      EmptyRootHash,
		ReceiptHash: EmptyRootHash,
		Difficulty:  big.NewInt(131072),
		Number:      big.NewInt(7_100_000),
		GasLimit:    30_000_000,
		GasUsed:     0,
		Time:        1_700_000_000,
		Extra:       []byte("altcoinchain"),
	}
}

// The whole design rests on this: adding AttestationsHash must not change the
// hash of any header that does not set it. If this fails, activating the field
// would rewrite every historical block hash and fork the chain.
func TestHeaderHashUnchangedWhenAttestationsUnset(t *testing.T) {
	h := legacyStyleHeader()

	enc, err := rlp.EncodeToBytes(h)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var fields []rlp.RawValue
	if err := rlp.DecodeBytes(enc, &fields); err != nil {
		t.Fatalf("decode into raw list: %v", err)
	}
	if len(fields) != mandatoryHeaderFields {
		t.Fatalf("header encoded %d fields, want %d — a trailing optional field is "+
			"being serialised when it should be omitted, which would change every "+
			"legacy block hash", len(fields), mandatoryHeaderFields)
	}

	// Round-tripping must be stable and preserve the hash.
	var decoded Header
	if err := rlp.DecodeBytes(enc, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.Hash() != h.Hash() {
		t.Fatalf("hash changed across round-trip: %v vs %v", decoded.Hash(), h.Hash())
	}
	if decoded.AttestationsHash != (common.Hash{}) {
		t.Fatalf("AttestationsHash decoded as %v, want zero", decoded.AttestationsHash)
	}
}

// Setting the field must change the hash — otherwise the commitment is worthless.
func TestHeaderHashChangesWhenAttestationsSet(t *testing.T) {
	bare := legacyStyleHeader()
	withAtt := legacyStyleHeader()
	withAtt.AttestationsHash = common.HexToHash("0xdeadbeef")

	if bare.Hash() == withAtt.Hash() {
		t.Fatal("AttestationsHash is not covered by the header hash")
	}

	enc, _ := rlp.EncodeToBytes(withAtt)
	var fields []rlp.RawValue
	if err := rlp.DecodeBytes(enc, &fields); err != nil {
		t.Fatalf("decode into raw list: %v", err)
	}
	// Setting a late optional field forces every earlier optional field to be
	// encoded too. That is expected, and is why activation must be fork-gated.
	if len(fields) <= mandatoryHeaderFields {
		t.Fatalf("header encoded %d fields, want more than %d", len(fields), mandatoryHeaderFields)
	}
	var decoded Header
	if err := rlp.DecodeBytes(enc, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.AttestationsHash != withAtt.AttestationsHash {
		t.Fatalf("AttestationsHash round-trip = %v, want %v", decoded.AttestationsHash, withAtt.AttestationsHash)
	}
}

// A pre-fork two-element body must still decode, with no attestations.
func TestLegacyBodyDecodes(t *testing.T) {
	legacy := struct {
		Transactions []*Transaction
		Uncles       []*Header
	}{
		Transactions: []*Transaction{},
		Uncles:       []*Header{},
	}
	enc, err := rlp.EncodeToBytes(&legacy)
	if err != nil {
		t.Fatalf("encode legacy body: %v", err)
	}
	var body Body
	if err := rlp.DecodeBytes(enc, &body); err != nil {
		t.Fatalf("legacy body failed to decode into the extended Body: %v", err)
	}
	if body.Attestations != nil {
		t.Fatalf("Attestations = %v, want nil for a legacy body", body.Attestations)
	}
}

func TestBodyWithAttestationsRoundTrip(t *testing.T) {
	body := Body{
		Transactions: []*Transaction{},
		Uncles:       []*Header{},
		Attestations: []*Attestation{{
			Validator:   common.HexToAddress("0xabc"),
			BlockHash:   common.HexToHash("0xfeed"),
			BlockNumber: 7_200_001,
			Signature:   bytes.Repeat([]byte{0x7}, crypto.SignatureLength),
		}},
	}
	enc, err := rlp.EncodeToBytes(&body)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var decoded Body
	if err := rlp.DecodeBytes(enc, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(decoded.Attestations) != 1 {
		t.Fatalf("got %d attestations, want 1", len(decoded.Attestations))
	}
	got, want := decoded.Attestations[0], body.Attestations[0]
	if got.Validator != want.Validator || got.BlockHash != want.BlockHash ||
		got.BlockNumber != want.BlockNumber || !bytes.Equal(got.Signature, want.Signature) {
		t.Fatalf("attestation round-trip mismatch:\n got %+v\nwant %+v", got, want)
	}
}

// Sign/recover must agree, and a tampered attestation must not verify.
func TestAttestationSignAndRecover(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	addr := crypto.PubkeyToAddress(key.PublicKey)

	att := &Attestation{
		Validator:   addr,
		BlockHash:   common.HexToHash("0xc0ffee"),
		BlockNumber: 7_200_042,
	}
	sig, err := crypto.Sign(att.SigningHash().Bytes(), key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	att.Signature = sig

	if !att.VerifySignature() {
		t.Fatal("valid attestation failed verification")
	}
	recovered, err := att.RecoverValidator()
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	if recovered != addr {
		t.Fatalf("recovered %v, want %v", recovered, addr)
	}

	// Re-pointing the attestation at a different block must invalidate it,
	// otherwise a signature could be replayed onto an attacker's chain.
	tampered := *att
	tampered.BlockHash = common.HexToHash("0xbadbad")
	if tampered.VerifySignature() {
		t.Fatal("attestation still verified after its block hash was changed")
	}

	// A malformed signature must be rejected rather than panicking.
	short := *att
	short.Signature = []byte{1, 2, 3}
	if short.VerifySignature() {
		t.Fatal("short signature verified")
	}
}

// The signing digest must stay keccak256(uint256(number) || bytes32(hash)) so the
// staking contract's slashWithEvidence can recompute it with abi.encodePacked.
func TestAttestationSigningHashFormatIsPacked(t *testing.T) {
	att := &Attestation{
		BlockHash:   common.HexToHash("0x1234"),
		BlockNumber: 42,
	}
	var packed [64]byte
	new(big.Int).SetUint64(42).FillBytes(packed[0:32])
	copy(packed[32:64], att.BlockHash[:])
	want := crypto.Keccak256Hash(packed[:])

	if got := att.SigningHash(); got != want {
		t.Fatalf("SigningHash = %v, want %v — the on-chain evidence format has drifted", got, want)
	}
}

// The header commitment must actually bind the set: order and content changes
// must both move the root.
func TestAttestationsDeriveShaBindsContentAndOrder(t *testing.T) {
	mk := func(n uint64) *Attestation {
		return &Attestation{
			Validator:   common.HexToAddress("0x01"),
			BlockHash:   common.HexToHash("0x02"),
			BlockNumber: n,
			Signature:   bytes.Repeat([]byte{0x3}, crypto.SignatureLength),
		}
	}
	hasher := newHasher() // shared helper from block_test.go

	a := Attestations{mk(1), mk(2)}
	b := Attestations{mk(2), mk(1)}
	c := Attestations{mk(1), mk(3)}

	rootA := DeriveSha(a, hasher)
	if rootA != DeriveSha(Attestations{mk(1), mk(2)}, hasher) {
		t.Fatal("DeriveSha is not deterministic for identical input")
	}
	if rootA == DeriveSha(b, hasher) {
		t.Fatal("reordering the attestation set did not change the root")
	}
	if rootA == DeriveSha(c, hasher) {
		t.Fatal("changing an attestation did not change the root")
	}
	if DeriveSha(Attestations{}, hasher) == rootA {
		t.Fatal("empty set collides with a populated set")
	}
}

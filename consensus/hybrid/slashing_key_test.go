package hybrid

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// TestAttestationKeyDistinguishesHeights pins the 2026-09-09 finality bug: the
// key must separate two heights for the same validator. The old
// string(rune(blockNumber)) form overflowed every real height past the Unicode
// maximum (0x10FFFF) into U+FFFD, collapsing all heights onto one key, so a
// validator's second attestation was rejected as equivocation and finality
// stopped after a single block.
func TestAttestationKeyDistinguishesHeights(t *testing.T) {
	v := common.HexToAddress("0xA13389D59048998383e115255C0CFE1da6b616CE")

	// The exact heights observed finalizing / failing on mainnet.
	if got, other := attestationKey(v, 7226200), attestationKey(v, 7226240); got == other {
		t.Fatalf("heights 7226200 and 7226240 share a key %q — equivocation false positive", got)
	}

	// Heights either side of the old Unicode ceiling must stay distinct too.
	for _, pair := range [][2]uint64{
		{0x10FFFF, 0x110000},
		{1, 2},
		{7226200, 7226201},
		{1 << 20, 1 << 21},
	} {
		if attestationKey(v, pair[0]) == attestationKey(v, pair[1]) {
			t.Errorf("heights %d and %d collide", pair[0], pair[1])
		}
	}

	// Same height, same validator must still collide — that is the real
	// double-attestation case the detector exists to catch.
	if attestationKey(v, 7226200) != attestationKey(v, 7226200) {
		t.Error("same validator+height must produce a stable key")
	}

	// Different validators at one height must not collide.
	w := common.HexToAddress("0xe59bb48Fd23F66EdAC871487f709C227F5Dd0840")
	if attestationKey(v, 7226200) == attestationKey(w, 7226200) {
		t.Error("different validators collide at the same height")
	}
}

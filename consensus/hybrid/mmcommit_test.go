package hybrid

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
)

// mockChain is a minimal ChainHeaderReader returning a fixed parent so
// ethash.Prepare's difficulty calc succeeds.
type mockChain struct{ parent *types.Header }

func (m *mockChain) Config() *params.ChainConfig                     { return params.TestChainConfig }
func (m *mockChain) CurrentHeader() *types.Header                     { return m.parent }
func (m *mockChain) GetHeaderByNumber(number uint64) *types.Header    { return m.parent }
func (m *mockChain) GetHeaderByHash(hash common.Hash) *types.Header   { return m.parent }
func (m *mockChain) GetHeader(hash common.Hash, number uint64) *types.Header { return m.parent }
func (m *mockChain) GetTd(hash common.Hash, number uint64) *big.Int   { return big.NewInt(0) }

func TestPrepareEmbedsMergedCommitment(t *testing.T) {
	h := NewFaker()
	parent := &types.Header{
		Number:     big.NewInt(100),
		Time:       1000,
		Difficulty: big.NewInt(1000000),
		UncleHash:  types.EmptyUncleHash,
	}
	chain := &mockChain{parent: parent}

	newHeader := func() *types.Header {
		return &types.Header{
			ParentHash: parent.Hash(),
			Number:     big.NewInt(101),
			Time:       1120,
			Extra:      []byte("vanity-miner-tag"),
		}
	}

	// No commitment set -> extraData is left as the miner's vanity value.
	hdr := newHeader()
	if err := h.Prepare(chain, hdr); err != nil {
		t.Fatalf("Prepare (no commit): %v", err)
	}
	if string(hdr.Extra) != "vanity-miner-tag" {
		t.Fatalf("expected vanity extraData preserved, got %x", hdr.Extra)
	}

	// Commitment set -> extraData is exactly the 32-byte WATTx aux hash.
	want := common.HexToHash("0x1122334455667788990011223344556677889900112233445566778899001122")
	h.SetMergedCommitment(want)
	hdr = newHeader()
	if err := h.Prepare(chain, hdr); err != nil {
		t.Fatalf("Prepare (commit): %v", err)
	}
	if len(hdr.Extra) != 32 {
		t.Fatalf("extraData len = %d, want 32", len(hdr.Extra))
	}
	if common.BytesToHash(hdr.Extra) != want {
		t.Fatalf("extraData = %x, want %x", hdr.Extra, want)
	}

	// Clearing (zero hash) restores normal extraData handling.
	h.SetMergedCommitment(common.Hash{})
	hdr = newHeader()
	if err := h.Prepare(chain, hdr); err != nil {
		t.Fatalf("Prepare (cleared): %v", err)
	}
	if string(hdr.Extra) != "vanity-miner-tag" {
		t.Fatalf("expected vanity restored after clear, got %x", hdr.Extra)
	}
}

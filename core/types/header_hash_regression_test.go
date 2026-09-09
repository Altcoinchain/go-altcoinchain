package types

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// A real Altcoinchain mainnet header (block 7,056,128) must still hash to the
// hash the live chain recorded for it, after AttestationsHash was added to the
// Header and the RLP encoder was reworked.
func TestRealMainnetHeaderHash(t *testing.T) {
	h := &Header{
		ParentHash:  common.HexToHash("0x753b19686b08fac77763757b59174f52be072fc29e1ff446d480fc0c6440f18b"),
		UncleHash:   common.HexToHash("0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347"),
		Coinbase:    common.HexToAddress("0xc9537513c9b2ea9551dee3c611f1b9238820621b"),
		Root:        common.HexToHash("0x5ff041e9b526553f7afa1dc3e4b8e459e3a6a0c7ced4e76ddbfd3b2ac91a5af7"),
		TxHash:      common.HexToHash("0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"),
		ReceiptHash: common.HexToHash("0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"),
		Difficulty:  big.NewInt(0xea74a),
		Number:      big.NewInt(0x6bab00),
		GasLimit:    0x1c9c380,
		GasUsed:     0,
		Time:        0x6a838a41,
		Extra:       common.FromHex("0xd883010a18846765746888676f312e32332e30856c696e7578"),
		MixDigest:   common.HexToHash("0x085c23cdd51de2fbfa584c05616b63a88833cf45bac2527e925d3282d66e3187"),
		Nonce:       EncodeNonce(0x33fc1271336ca19e),
		BaseFee:     big.NewInt(7),
	}
	want := common.HexToHash("0xbdea975a3725f1217dbda5098fde7e1d6c99921873b93c3cb2e958f5901fe5c5")
	if got := h.Hash(); got != want {
		t.Fatalf("real mainnet header hash changed!\n got %v\nwant %v", got, want)
	}
}

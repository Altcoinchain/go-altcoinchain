package lachesis

import (
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/hash"
)

// Block is a part of an ordered chain of batches of events.
type Block struct {
	Electing hash.Event
	Atropos  hash.Event
	Cheaters Cheaters
}

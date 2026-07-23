package abft

import (
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/hash"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/dag"
)

// EventSource is a callback for getting events from an external storage.
type EventSource interface {
	HasEvent(hash.Event) bool
	GetEvent(hash.Event) dag.Event
}

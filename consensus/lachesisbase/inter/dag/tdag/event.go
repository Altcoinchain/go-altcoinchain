package tdag

import (
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/hash"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/dag"
)

type TestEvent struct {
	dag.MutableBaseEvent
	Name string
}

func (e *TestEvent) AddParent(id hash.Event) {
	parents := e.Parents()
	parents.Add(id)
	e.SetParents(parents)
}

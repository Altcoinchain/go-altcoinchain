package abft

import (
	"math/rand"

	"github.com/ethereum/go-ethereum/consensus/lachesisbase/hash"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/dag"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/idx"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/pos"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/kvdb"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/kvdb/memorydb"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/lachesis"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/utils/adapters"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/vecfc"
)

type dbEvent struct {
	hash        hash.Event
	validatorId idx.ValidatorID
	seq         idx.Event
	frame       idx.Frame
	lamportTs   idx.Lamport
	parents     []hash.Event
}

type applyBlockFn func(block *lachesis.Block) *pos.Validators

type BlockKey struct {
	Epoch idx.Epoch
	Frame idx.Frame
}

type BlockResult struct {
	Atropos    hash.Event
	Cheaters   lachesis.Cheaters
	Validators *pos.Validators
}

// CoreLachesis extends Indexed Orderer for tests.
type CoreLachesis struct {
	*IndexedLachesis

	blocks      map[BlockKey]*BlockResult
	lastBlock   BlockKey
	epochBlocks map[idx.Epoch]idx.Frame

	applyBlock applyBlockFn
}

// NewCoreLachesis creates empty abft consensus with mem store and optional node weights w.o. some callbacks usually instantiated by Client
func NewCoreLachesis(nodes []idx.ValidatorID, weights []pos.Weight, mods ...memorydb.Mod) (*CoreLachesis, *Store, *EventStore, *adapters.VectorToDagIndexer) {
	validators := make(pos.ValidatorsBuilder, len(nodes))
	for i, v := range nodes {
		if weights == nil {
			validators[v] = 1
		} else {
			validators[v] = weights[i]
		}
	}

	openEDB := func(epoch idx.Epoch) kvdb.Store {
		return memorydb.New()
	}
	crit := func(err error) {
		panic(err)
	}
	store := NewStore(memorydb.New(), openEDB, crit, LiteStoreConfig())

	err := store.ApplyGenesis(&Genesis{
		Validators: validators.Build(),
		Epoch:      FirstEpoch,
	})
	if err != nil {
		panic(err)
	}

	input := NewEventStore()

	config := LiteConfig()
	dagIndexer := &adapters.VectorToDagIndexer{Index: vecfc.NewIndex(crit, vecfc.LiteConfig())}
	lch := NewIndexedLachesis(store, input, dagIndexer, crit, config)

	extended := &CoreLachesis{
		IndexedLachesis: lch,
		blocks:          map[BlockKey]*BlockResult{},
		epochBlocks:     map[idx.Epoch]idx.Frame{},
	}

	err = extended.Bootstrap(lachesis.ConsensusCallbacks{
		BeginBlock: func(block *lachesis.Block) lachesis.BlockCallbacks {
			return lachesis.BlockCallbacks{
				EndBlock: func() (sealEpoch *pos.Validators) {
					// track blocks
					key := BlockKey{
						Epoch: extended.store.GetEpoch(),
						Frame: extended.store.GetLastDecidedFrame() + 1,
					}
					extended.blocks[key] = &BlockResult{
						Atropos:    block.Atropos,
						Cheaters:   block.Cheaters,
						Validators: extended.store.GetValidators(),
					}
					// check that prev block exists
					if extended.lastBlock.Epoch != key.Epoch && key.Frame != 1 {
						panic("first frame must be 1")
					}
					extended.epochBlocks[key.Epoch]++
					extended.lastBlock = key
					if extended.applyBlock != nil {
						return extended.applyBlock(block)
					}
					return nil
				},
			}
		},
	})
	if err != nil {
		panic(err)
	}

	return extended, store, input, dagIndexer
}

func mutateValidators(validators *pos.Validators) *pos.Validators {
	r := rand.New(rand.NewSource(int64(validators.TotalWeight()))) // nolint:gosec
	builder := pos.NewBuilder()
	for _, vid := range validators.IDs() {
		stake := uint64(validators.Get(vid))*uint64(500+r.Intn(500))/1000 + 1
		builder.Set(vid, pos.Weight(stake))
	}
	return builder.Build()
}

// EventStore is a abft event storage for test purpose.
// It implements EventSource interface.
type EventStore struct {
	db map[hash.Event]dag.Event
}

// NewEventStore creates store over memory map.
func NewEventStore() *EventStore {
	return &EventStore{
		db: map[hash.Event]dag.Event{},
	}
}

// Close leaves underlying database.
func (s *EventStore) Close() {
	s.db = nil
}

// SetEvent stores event.
func (s *EventStore) SetEvent(e dag.Event) {
	s.db[e.ID()] = e
}

// GetEvent returns stored event.
func (s *EventStore) GetEvent(h hash.Event) dag.Event {
	return s.db[h]
}

// HasEvent returns true if event exists.
func (s *EventStore) HasEvent(h hash.Event) bool {
	_, ok := s.db[h]
	return ok
}

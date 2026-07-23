package abft

import (
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/ethereum/go-ethereum/consensus/lachesisbase/hash"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/dag/tdag"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/idx"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/inter/pos"
	"github.com/ethereum/go-ethereum/consensus/lachesisbase/lachesis"
)

func CheckEpochAgainstDB(conn *sql.DB, epoch idx.Epoch) error {
	validators, weights, err := getValidator(conn, epoch)
	if err != nil {
		return err
	}
	if len(validators) == 0 {
		return nil
	}
	testLachesis, _, eventStore, _ := NewCoreLachesis(validators, weights)
	// Plant the real epoch state for the sake of event hash calculation (epoch=1 by default)
	testLachesis.store.applyGenesis(epoch, testLachesis.store.GetValidators())

	recalculatedAtropoi := make([]hash.Event, 0)
	// Capture the elected atropoi by planting the `applyBlock` callback (nil by default)
	testLachesis.applyBlock = func(block *lachesis.Block) *pos.Validators {
		recalculatedAtropoi = append(recalculatedAtropoi, block.Atropos)
		return nil
	}

	eventsOrdered, eventMap, err := getEvents(conn, epoch)
	if err != nil {
		return err
	}
	// Ingesting by lamport ts guarantees that all parents are already ingested
	for _, event := range eventsOrdered {
		if err := ingestEvent(testLachesis, eventStore, event); err != nil {
			return err
		}
	}

	expectedAtropoi, err := getAtropoi(conn, epoch)
	if err != nil {
		return err
	}
	if want, got := len(expectedAtropoi), len(recalculatedAtropoi); want > got {
		return fmt.Errorf("incorrect number of atropoi recalculated for epoch %d, expected at least: %d, got: %d", epoch, want, got)
	}
	for idx := range expectedAtropoi {
		if want, got := expectedAtropoi[idx], recalculatedAtropoi[idx]; want != got {
			return fmt.Errorf("incorrect atropos for epoch %d on position %d, expected: %v got: %v", epoch, idx, eventMap[want], eventMap[got])
		}
	}
	return nil
}

func GetEpochRange(conn *sql.DB) (idx.Epoch, idx.Epoch, error) {
	// Query the `Event` table as `Validator` table may include future (empty) epochs
	rows, err := conn.Query(`
		SELECT MIN(e.EpochId), MAX(e.EpochId)
		FROM Event e
	`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	var epochMin, epochMax idx.Epoch
	if !rows.Next() {
		return 0, 0, fmt.Errorf("no non-empty epochs in database")
	}
	err = rows.Scan(&epochMin, &epochMax)
	if err != nil {
		return 0, 0, err
	}
	return epochMin, epochMax, nil
}

func ingestEvent(testLachesis *CoreLachesis, eventStore *EventStore, event *dbEvent) error {
	testEvent := &tdag.TestEvent{}
	testEvent.SetSeq(event.seq)
	testEvent.SetCreator(event.validatorId)
	testEvent.SetParents(event.parents)
	testEvent.SetLamport(event.lamportTs)
	testEvent.SetEpoch(testLachesis.store.GetEpoch())
	if err := testLachesis.Build(testEvent); err != nil {
		return fmt.Errorf("error while building event for validator: %d, seq: %d, err: %v", event.validatorId, event.seq, err)
	}
	testEvent.SetID([24]byte(event.hash[8:]))
	eventStore.SetEvent(testEvent)
	if err := testLachesis.Process(testEvent); err != nil {
		return fmt.Errorf("error while processing event for validator: %d, seq: %d, err: %v", event.validatorId, event.seq, err)
	}
	return nil
}

func getValidator(conn *sql.DB, epoch idx.Epoch) ([]idx.ValidatorID, []pos.Weight, error) {
	rows, err := conn.Query(`
		SELECT ValidatorId, Weight
		FROM Validator
		WHERE EpochId = ?
	`, epoch)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	validators := make([]idx.ValidatorID, 0)
	weights := make([]pos.Weight, 0)
	for rows.Next() {
		var validatorId idx.ValidatorID
		var weight pos.Weight

		err = rows.Scan(&validatorId, &weight)
		if err != nil {
			return nil, nil, err
		}

		validators = append(validators, validatorId)
		weights = append(weights, weight)
	}
	return validators, weights, nil
}

func getEvents(conn *sql.DB, epoch idx.Epoch) ([]*dbEvent, map[hash.Event]*dbEvent, error) {
	rows, err := conn.Query(`
		SELECT e.EventHash, e.ValidatorId, e.SequenceNumber, e.FrameId, e.LamportNumber
		FROM Event e
		WHERE e.EpochId = ?
		ORDER BY e.LamportNumber ASC
	`, epoch)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	eventMap := make(map[hash.Event]*dbEvent)
	eventsOrdered := make([]*dbEvent, 0)
	for rows.Next() {
		var hashStr string
		var validatorId idx.ValidatorID
		var seq idx.Event
		var frame idx.Frame
		var lamportTs idx.Lamport
		err = rows.Scan(&hashStr, &validatorId, &seq, &frame, &lamportTs)
		if err != nil {
			return nil, nil, err
		}

		eventHash, err := decodeHashStr(hashStr)
		if err != nil {
			return nil, nil, err
		}
		event := &dbEvent{
			hash:        eventHash,
			validatorId: validatorId,
			seq:         seq,
			frame:       frame,
			lamportTs:   lamportTs,
			parents:     make([]hash.Event, 0),
		}
		eventsOrdered = append(eventsOrdered, event)
		eventMap[eventHash] = event
	}
	return eventsOrdered, eventMap, appointParents(conn, eventMap, epoch)
}

func appointParents(conn *sql.DB, eventMap map[hash.Event]*dbEvent, epoch idx.Epoch) error {
	rows, err := conn.Query(`
		SELECT e.EventHash, eParent.EventHash
		FROM Event e JOIN Parent p ON e.EventId = p.EventId JOIN Event eParent ON eParent.EventId = p.ParentId
		WHERE e.EpochId = ?
	`, epoch)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var eventHashStr string
		var parentHashStr string
		err = rows.Scan(&eventHashStr, &parentHashStr)
		if err != nil {
			return err
		}

		eventHash, err := decodeHashStr(eventHashStr)
		if err != nil {
			return err
		}
		parentHash, err := decodeHashStr(parentHashStr)
		if err != nil {
			return err
		}
		event, ok := eventMap[eventHash]
		if !ok {
			return fmt.Errorf(
				"incomplete events.db - child event not found. epoch: %d, child event: %s, parent event: %s",
				epoch,
				eventHash,
				parentHash,
			)
		}
		if _, ok := eventMap[parentHash]; !ok {
			return fmt.Errorf(
				"incomplete events.db - parent event not found. epoch: %d, child event: %s, parent event: %s",
				epoch,
				eventHash,
				parentHash,
			)
		}
		event.parents = append(event.parents, parentHash)
	}
	return nil
}

func getAtropoi(conn *sql.DB, epoch idx.Epoch) ([]hash.Event, error) {
	rows, err := conn.Query(`
		SELECT e.EventHash
		FROM Atropos a JOIN Event e ON a.AtroposId = e.EventId
		WHERE e.EpochId = ?
		ORDER BY a.AtroposId ASC
	`, epoch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	atropoi := make([]hash.Event, 0)
	for rows.Next() {
		var atroposHashStr string
		err = rows.Scan(&atroposHashStr)
		if err != nil {
			return nil, err
		}

		atroposHash, err := decodeHashStr(atroposHashStr)
		if err != nil {
			return nil, err
		}
		atropoi = append(atropoi, atroposHash)
	}
	return atropoi, nil
}

// hashStr is in hex format, i.e. 0x1a2b3c4d...
func decodeHashStr(hashStr string) (hash.Event, error) {
	hashSlice, err := hex.DecodeString(hashStr[2:])
	if err != nil {
		return hash.Event{}, err
	}
	return hash.Event(hashSlice), nil
}

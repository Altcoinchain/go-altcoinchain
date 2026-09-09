// Copyright 2026 The Altcoinchain Authors
// This file is part of the go-altcoinchain library.
//
// The go-altcoinchain library is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// The go-altcoinchain library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with the go-altcoinchain library. If not, see <http://www.gnu.org/licenses/>.

package eth

import (
	"github.com/ethereum/go-ethereum/consensus/beacon"
	"github.com/ethereum/go-ethereum/consensus/hybrid"
	"github.com/ethereum/go-ethereum/eth/protocols/eth"
	"github.com/ethereum/go-ethereum/log"
)

// hybridEngine extracts the hybrid PoW/PoS engine from the chain's consensus
// engine, unwrapping a beacon wrapper if present. Returns nil for non-hybrid
// chains so callers can no-op cheaply.
func (h *handler) hybridEngine() *hybrid.Hybrid {
	engine := h.chain.Engine()
	if b, ok := engine.(*beacon.Beacon); ok {
		engine = b.InnerEngine()
	}
	if hy, ok := engine.(*hybrid.Hybrid); ok {
		return hy
	}
	return nil
}

// toEngineAttestation converts a wire packet into the engine's attestation type.
func toEngineAttestation(p *eth.AttestationPacket) *hybrid.Attestation {
	return &hybrid.Attestation{
		Validator:   p.Validator,
		BlockHash:   p.BlockHash,
		BlockNumber: p.BlockNumber,
		Signature:   p.Signature,
	}
}

// toWireAttestation converts an engine attestation into a wire packet.
func toWireAttestation(a *hybrid.Attestation) *eth.AttestationPacket {
	return &eth.AttestationPacket{
		Validator:   a.Validator,
		BlockHash:   a.BlockHash,
		BlockNumber: a.BlockNumber,
		Signature:   a.Signature,
	}
}

// handleAttestationPacket ingests an inbound attestation into the local engine
// and, if it was new and valid, re-gossips it to peers that have not seen it.
func (h *handler) handleAttestationPacket(peer *eth.Peer, packet *eth.AttestationPacket) error {
	engine := h.hybridEngine()
	if engine == nil {
		return nil // not a hybrid chain; ignore
	}
	att := toEngineAttestation(packet)
	// AddAttestation verifies the signature, validator activity and stake, and
	// deduplicates. A non-nil error (invalid, duplicate, unknown validator)
	// means we should NOT re-gossip.
	if err := engine.AddAttestation(att); err != nil {
		log.Trace("Dropped inbound attestation", "validator", att.Validator, "block", att.BlockNumber, "err", err)
		return nil
	}
	h.propagateAttestation(packet)
	return nil
}

// propagateAttestation forwards an attestation to every peer not already known
// to have it. Used both for re-gossip of inbound attestations and for the
// initial broadcast of a locally produced one.
func (h *handler) propagateAttestation(packet *eth.AttestationPacket) {
	peers := h.peers.peersWithoutAttestation(packet.Validator, packet.BlockHash)
	for _, p := range peers {
		if err := p.SendAttestation(packet); err != nil {
			log.Trace("Failed to send attestation", "peer", p.ID(), "err", err)
		}
	}
}

// BroadcastAttestation is the entry point used by the local attestor to gossip
// a freshly signed attestation for a validator this node controls.
func (h *handler) BroadcastAttestation(att *hybrid.Attestation) {
	if att == nil {
		return
	}
	h.propagateAttestation(toWireAttestation(att))
}

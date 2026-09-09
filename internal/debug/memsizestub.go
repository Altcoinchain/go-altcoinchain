// Copyright 2024 The go-ethereum Authors
// This file is part of the go-ethereum library.
//
// This is a stub for the memsizeui package which is incompatible with Go 1.23+.

package debug

import "net/http"

// memsizeHandler is a stub handler that does nothing.
// The original memsize package uses runtime internals that are incompatible with Go 1.23+.
type memsizeHandler struct{}

func (h *memsizeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusServiceUnavailable)
	w.Write([]byte("memsize not available (Go 1.23+ incompatibility)"))
}

// Add is a no-op stub for the original memsize.Add functionality.
func (h *memsizeHandler) Add(name string, v interface{}) {
	// No-op: memsize functionality not available in Go 1.23+
}

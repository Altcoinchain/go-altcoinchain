// Package memsizeui provides a stub implementation of the memsize UI handler.
// This is used because the original github.com/fjl/memsize package is incompatible
// with Go 1.21+ due to internal runtime API changes.
package memsizeui

import (
	"fmt"
	"net/http"
)

// Handler is a stub HTTP handler for memory size reports.
// The original memsize package is incompatible with Go 1.21+.
type Handler struct{}

// Add is a no-op stub for the memsize Add method.
// In the original package, this adds an object to be tracked for memory profiling.
func (h *Handler) Add(name string, v interface{}) {}

// ServeHTTP implements http.Handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head><title>Memory Size</title></head>
<body>
<h1>Memory Size Report</h1>
<p>Memory size reporting is disabled due to Go runtime compatibility issues.</p>
<p>Use the standard pprof heap profile at <a href="/debug/pprof/heap">/debug/pprof/heap</a> instead.</p>
</body>
</html>`)
}

# Vendored: lachesis-base (Sonic Labs)

Source: https://github.com/Fantom-foundation/lachesis-base-sonic
(the `replace` target Sonic uses for `github.com/Fantom-foundation/lachesis-base`)
Vendored 2026-07-23. License: LGPL-3.0 (COPYING.LESSER), compatible with
go-ethereum's LGPL-3.0 library code.

## Why vendored instead of a go.mod dependency

lachesis-base-sonic requires `github.com/ethereum/go-ethereum v1.15.0`. This tree
*is* `github.com/ethereum/go-ethereum` at 1.10.24-era code, and Go resolves the
main module first — so its geth imports would silently bind to our tree rather
than v1.15.0, producing confusing breakage. Vendoring under our own module path
makes that binding explicit and reviewable.

## Local modifications

1. Import paths rewritten:
   `github.com/Fantom-foundation/lachesis-base` -> `github.com/ethereum/go-ethereum/consensus/lachesisbase`
2. `kvdb/pebble` REMOVED — geth 1.10.24 has no pebble dependency and we use the
   leveldb backend. Re-add only if a pebble backend is actually wanted.
3. `Stat()` -> `Stat(property string)` across the kvdb wrappers and
   `vecengine/vecflushable`. Upstream targets geth 1.15 where
   `ethdb.KeyValueStater.Stat` takes no argument; 1.10.24 takes a property name.
   Affected: abft-adjacent kvdb only — fallible, synced, skiperrors, table,
   leveldb, devnulldb, flushable, vecflushable.
4. `*_test.go` removed from the vendored copy.

Also required: `go.mod` `go 1.17` -> `go 1.20` (Lachesis uses slice-to-array
conversion, a 1.20 feature). Deliberately NOT 1.22+, which would change loop
variable semantics under consensus-critical code.

## Upgrading

Re-copy from upstream, re-apply 1-4. Diff `lachesis/consensus.go` first — that
is the integration contract the ALT engine implements.

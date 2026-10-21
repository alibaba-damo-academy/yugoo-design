# Ladybug Design Knowledge provider

This private package implements the first production slice of the host-neutral Design Knowledge port with `@ladybugdb/wasm-core/nodejs`. It owns persistence mechanics only; DesignJournal remains the sole human-decision authority, and Kit, G/R/A, Studio, panel, and host integration semantics stay outside this package.

Each branded Design Project maps to one SHA-256-named `.lbdb` file under the configured database root. Opening acquires a cross-process exclusive lock and creates one live database handle. A second owner fails with `LadybugProjectLockError`; the provider never allows Ladybug's independent-handle visibility behavior to weaken compare-and-set. Every database carries a singleton schema version and exact project identity. Existing bytes with no supported identity, a different project, an unsupported version, or duplicate project metadata fail before any schema or metadata is added.

The provider implements the complete `DesignKnowledgeService`. Delta and proposal transactions check exact replay before freshness, bind the full Pin, validate final relation endpoints, reject AI writes to authoritative lifecycles, append immutable versions, and advance the project revision before commit. Journal decisions bind the exact proposal revision and neutral digest. Deferred decisions retain proposed lifecycle; accepted and rejected decisions are terminal and immutable. Trace, impact, query, and export support historical revisions with explicit bounds.

Archive import accepts only an empty project namespace. It validates the neutral format, project, proposal digests, relation endpoints, terminal lifecycle decisions, and journal references before beginning a write. Import remaps source proposal revisions explicitly, rewrites decision proposal revisions to the target provider revisions, returns the complete source-to-target map, and commits the reconstruction in one database transaction.

The durable neutral snapshot lives in the Design Project at
`design_records/knowledge/archive.json`, tracked by project Git. DSH and Companion
restore it before exposing the provider and save it after settled knowledge
publication or decisions. `resetCache(projectId)` clears only this provider's
derived namespace under its existing serialization and transaction. It supports
restoring changed or older archive bytes and clearing a cache when the project
has no archive; it is not an old-state migration or permission to promote an
external database into a new project authority. Provider paths, locks, native
handles and embeddings remain local runtime data.

The WASM package owns one worker for the Node.js process. Closing a project releases its database and project lock but intentionally keeps the worker available for reopen. Standalone embeddings may call `shutdownLadybugKnowledgeRuntime()` once, after all providers close, during terminal process teardown; opening after terminal shutdown fails loud. The reloadable DSH plugin drains every project handle on unload but leaves the process-global worker available for a later plugin activation.

Configuration resolves once at open. Writer acquisition, project-lock retry, maximum query result, text byte, and filter cardinality budgets are explicit. Invalid queries fail before any database read. Lock or writer exhaustion fails without opening or mutating project state.

Close waits for accepted writes, then attempts connection close, database close, and lock release even when an earlier step fails. It decrements the shared runtime ownership count exactly once and reports the first teardown error.

Recovery backup files are flushed through writable, non-truncating handles, as
required by Windows. Recovery manifests still flush file bytes before atomic
rename. Parent directories are flushed on POSIX; Node's Windows directory handles
do not support that operation, so Windows does not claim the same directory-entry
power-loss guarantee. Ordinary file flush, permission and disk errors still fail
the operation; an `EPERM` is never broadly ignored.

The validated 0.19.1 WASM package is 102,035,192 unpacked bytes and the current-host reopen probe reached about 370 MiB maximum RSS. Deployment packaging and memory budgets must account for this explicitly; the smaller native provider remains optional because its prebuilt Linux addon does not load on the supported Ubuntu 20.04 host.

Run the focused built-plane gates:

```sh
pnpm run typecheck
pnpm run build
pnpm test
```

DesignJournal remains the only human-decision authority. The `./dsh` host entry registers `ladybug-wasm` as the DSH composition's explicit default, derives each database root from external project runtime state, and exposes only `DesignKnowledgeService` to Core consumers. G/R/A scheduling, Studio, compaction, and future Codex/Claude integration remain outside this storage provider.

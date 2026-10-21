# Design Studio domain library

`dsh-design-studio` is the host-neutral Studio domain layer. Its installed-content inspection remains read-only: compiled Kit/Bundle catalogs, exact Kit workspaces and real Bundle files with loader-compiled summaries. Optional Panel drafts use separately injected snapshot and persistence ports, never installed-content mutation. The library does not depend on DSH, Codex, Claude Code, Cordis or a browser UI.

## Catalog composition

`buildStudioCompositionCatalog` derives one flat, immutable Bundle-version catalog from the Core-compiled installed snapshot. Identical `{name, version}` Bundle pins are coalesced without copying source, while different declared versions of the same Bundle name remain distinct. Each entry lists the exact published Kit versions that use it, so reverse dependencies are derived rather than maintained as a second authority. `searchStudioBundles` searches names and descriptions in deterministic catalog order.

Hosts may supply the independent `snapshot.bundles` catalog, including unmounted
versions. Kit bindings contribute reverse references only. Source inspection uses
an exact host-resolved Bundle root, not a path inferred from an owning Kit.
Catalog identity (`catalogName ?? name`) is distinct from a fork's preserved
runtime name. File-backed retained closures preserve methods, resources and
version pins after editable sources disappear; mutable discovery cannot replace
a retained resource root for the same pin.

## Management service

`StudioManagementService` is the host-neutral read API for the Studio browser surface. `workspace` derives a JSON-only view from a `StudioCatalogSnapshotPort`: published Kit pins plus searched Bundle entries with exact reverse Kit pins. `readKitWorkspace` resolves one exact installed `name@version` and returns the complete raw `mindset.md` source byte-identically, the mounted Bundles with reverse Kit references, the loader-compiled resource paths, and a browser-safe read-only projection of the optional Core-validated `relations.yaml`; a missing Kit or version diagnoses explicitly. Executable Core definitions and filesystem authority never enter the view model.

## Bundle source inspection

`StudioBundleSourceService` reads real Bundle source files through the read-only `StudioBundleSourcePort`. `readBundleWorkspace` returns the complete readable UTF-8 file tree with byte sizes plus the loader-compiled `skill.yaml` manifest, parsed schema, validation rule/driver summary, and Panel classification (`native` Panels are provider-owned code; `declarative` Panels are Bundle-authored data). `readBundleFile` returns one file byte-exactly. Identity is reconciled against the compiled catalog by exact Kit and Bundle `name+version`; an ambiguous physical source (`studio.duplicate_source`) or a catalog/source disagreement (`studio.source_catalog_mismatch`) fails loud instead of guessing. Traversal, `.git`, directories, and binary content are rejected with explicit diagnostics.

## Validation

`validateKit` and `validateBundle` capture the Design Core loader's content errors
as bounded, locatable diagnostics. `valid` means the definition actually loads
without errors, not that the diagnostic list is empty. An omitted diagnostic
severity retains its existing error meaning; `severity: "warning"` is advisory.

These entries and Kit-draft validation reuse Core's read-only knowledge-declaration
analysis. A direct single-target record selector is compared with the owning
schema's reference role and target. Warnings identify the Bundle, schema pointer,
Panel section, field and expected collection. Explicit metadata, multi-target
selectors, free-form/external references and unresolvable declarations do not
acquire guessed semantics. No field-name or Kit-name heuristics, schema rewriting,
Design File changes, new approval state or runtime loading gate are introduced.
Kit-draft confirmation still gates on `valid`, so warnings remain visible without
blocking a loadable working copy. Other error-only preview/read result contracts
are unchanged. A passing definition is not proof that its KAG relationships have
been indexed or accepted.

## Authoring and remaining boundaries

The first authoring primitive, `prepareStudioPanelPreview`, compiles an in-memory `panel.yaml` edit against a host-resolved immutable Kit snapshot. It verifies the exact Kit and Bundle pins, uses the runtime loader (including translation and schema-binding checks), validates an isolated JSON sample, and returns runtime-interpreter input tagged with the editor revision. It writes no files, invokes no model or validation drivers, and grants no runtime/artifact/publication capabilities. Hosts must resolve the source snapshot themselves; arbitrary browser-supplied filesystem paths are not an API.

`StudioPanelDraftService` implements a bounded Panel authoring slice: exact installed Kit/Bundle → retained immutable source snapshot → editable Panel/sample draft → preview → save/reopen → confirm/lock → new editable fork. Hosts own snapshot storage and atomic compare-and-swap. Incomplete drafts may be saved for recovery; confirmation reruns compilation against the retained source and rejects conflicts. Confirmed drafts cannot be overwritten. Companion supplies content-addressed complete-source snapshots and an atomic local repository under its trusted `stateRoot`, with size/count limits and no fallback to live project files. Preview does not run Bundle validation drivers or a model. Full Kit copy/create, import/export, actual Bundle trial execution and catalog publication are not yet implemented by this slice.

`StudioKitDraftService` adds a Kit-owned authoring service over the same snapshot and
atomic-repository ports. It retains the exact base Kit and mounted Bundle pins;
only `mindset.md` and optional `relations.yaml` are editable in this slice. Shared
Bundle source cannot be changed through this API. The Mindset catalog may reorder
its entries but cannot add/remove/change mounted identities without a future
explicit mount operation. Changing the candidate Kit identity does not publish it
or retarget any installed Kit/session. Definition validation uses the full Core
loader, and declarative Panel preview uses the retained mounted Bundle and an
isolated sample through the existing preview implementation.

Companion supplies durable Kit draft storage separately from Panel draft records,
reusing the same locking, snapshot and confinement implementation. Authenticated
`studioKitDraft*` RPC operations expose create/list/read/save/validate/preview/
confirm/fork. Confirmation locks a successfully compiled working copy only; it is
not a catalog publication or a runtime Bundle test. The optional shared Kit draft
editor is exposed by `studio-ui` and wired to these RPC operations in Companion;
it reuses the sample-only runtime renderer and protects pending navigation and
confirmation. New-Kit scaffolding, independent Bundle working-copy adoption and
release flow remain subsequent work, not claimed capabilities of these endpoints.

The content archive functions described in [the archive contract](docs/content-archive.md)
are exported from this library. Companion adds bounded private envelope storage
and authenticated export/import/read/list/adopt routes. `studioContentImportAdopt`
accepts a retained Kit or independent Bundle import ID, rechecks the archive and
its definition, and passes the prepared units to the host's shared
`contentLibrary.adoptPrepared` adapter. It retains the exact content closure in
the local content library, rejecting different bytes at an existing pin and
reusing identical bytes. Kit adoption additionally creates a new unconfirmed
working copy through the existing snapshot/CAS service; repeated adoption creates
separate Kit working-copy identities. Bundle adoption returns its independent
pin without inventing a Kit, creating a Kit draft or mounting it into a project.
Source/license/trust declarations remain in the import record. This operation
does not overwrite installed sources, publish a new version, retarget project
pins, register trusted providers or execute content. The shared archive browser
is wired through `contentClient`: adopted Kits open their exact working copy;
adopted Bundles open their exact source workspace after refreshing the catalog.

Focused source-plane checks: `pnpm --filter dsh-design-studio test:kit-drafts`.
The checked-in test configuration resolves Core source explicitly. Companion's
`test/studio-panel-drafts.test.mjs` additionally exercises actual temporary storage,
fresh service instances and retained declarative preview. These are not installed
package or browser-interaction claims.

# Design Studio domain library

`dsh-design-studio` supplies host-neutral Kit/Bundle inspection, source authoring,
validation, archives and isolated Panel previews. Hosts provide storage and trusted
source readers; the library does not create native sessions or depend on a browser.
Core owns definition loading, schema validation and declarative Panel compilation.

## Edit current content

The optional `dsh-design-studio/node` entry exposes `createStudioInstances` and its
Core-backed composition adapters. `editCurrent({kind, kit?, bundle?})` opens the
same catalog identity for editing. The first call materializes its complete source;
subsequent calls return that same record with `current: true`. Ordinary saves keep
its identity. `copy` explicitly creates a new independent identity while preserving
Bundle runtime names and data paths. Created and imported sources use the same editor.

Kit membership belongs to `kit.yaml`; its Mindset catalog is the generated readable
projection. Mounts select stable Bundle identities. A mounted local Bundle reads its
current saved source, including overlays, rather than locking an earlier revision.
Unfinished methods, missing dependencies and empty Kit membership can be saved;
loading or previewing reports the actual missing/invalid definition. A missing
installed catalog does not prevent reopening and editing retained local files.

Kit authoring can discover its saved mount bindings and read their current source
through `readMountedBundle({id, expectedRevision, bindingKey, paths?})`. Omit
`paths` to list files; selected text reads share the existing source size/path
guards. The existing mount resolver uses current local Bundle content or retained
imported sources. These reads neither copy Bundles into Kit files nor grant write
access to them. The scoped authoring capability exposes the same read as
`read({mount:{bindingKey, paths?}})`; ordinary reads discover file and mount names.

Scoped source reads and preparation include `components` when the Host's actual
component catalog is available. Otherwise they return `componentCatalogError`
alongside the source or candidate, so ordinary method, schema and source work can
continue. This is no substitute vocabulary: component discovery reports its own
failure, and Core still owns actual candidate validation and Panel compilation.

`prepareChanges` returns a bounded multi-file source diff, candidate digest and
validation/preview diagnostics without saving. `saveChanges` defaults to `draft`:
it saves incomplete authoring source using the repository lock and atomic record
CAS. The internal revision and reviewed digest detect conflicting edits; they are
not release versions. Explicit `validated` saves remain an optional caller check,
not a prerequisite for ordinary editing. Source version metadata is retained as
provenance and does not require a version bump or remount to use saved changes.

`captureKit` captures the current complete Kit and all mounted Bundle bytes under
the same storage lock. `loadKit` compiles this captured closure through Core. Hosts
can supply it directly to Core's `ensureProjectKit(projectRoot, {loadSource})`:
a project receives its own complete editable `design_kit/kit` and
`design_kit/bundles/<identity>` trees, including binary resources. Methods, schema,
validation, Panel, summaries and runtime resources then come from that project.
Library edits affect future projects. Requested comparison/adaptation/synchronization
uses ordinary Agent source edits and existing validation, saving and Git.
There is no separate local publication, confirmation, upgrade or synchronization
workflow. Trusted native providers still own executable contributions.

## Import, export and removal

`importSources({kind, files, title?})` accepts decoded ZIP/folder entries or a single
`SKILL.md`. A Bundle needs `SKILL.md`; a Kit needs `mindset.md` and `kit.yaml`.
Other incomplete or malformed definitions remain editable with locatable readiness
diagnostics. Imports get independent catalog identities and retain original bytes,
methods, runtime names and resources. Repeated display names receive numeric suffixes.
Kit imports preserve supplied Bundle trees; absent dependencies remain explicit.
Mount cards read titles and descriptions from the selected saved sources, including
imported trees without a separate library entry. Display metadata does not create
library records or change mount bindings.

Catalog discovery and import name collision checks use the owning catalog's
already loaded Bundle metadata. The trusted `listBundles` port supplies exact
pins, titles, runtime names and optional picker descriptions; it does not capture
or compile source trees. Selecting a Bundle captures and validates that source,
so an unrelated unavailable source cannot block an import.

Complete source capture and retention support up to 32 MiB per tree, matching
Core's Bundle resource budget. A portable archive supports 32 MiB of total source
bytes; its JSON allows 64 MiB for base64 and the envelope. Existing file, path,
composition and revision limits still apply.
Opaque resources retain their byte lengths during compilation, without text
conversion. The 1 MiB text editing limit is separate. Browser transports read
these limits from the pure `dsh-design-studio/types` entry.

`exportArchive({id, expectedRevision})` exports the current complete saved source
and mounted Bundle resources through the existing source-archive format. It supports
unfinished definitions, checks the source revision, and does not replace edits with
an installed base. Source/license metadata is optional and stays covered by archive
hashes. `exportStudioContentArchive` additionally validates complete definitions;
`exportStudioSourceArchive` preserves incomplete authoring material.

Removal moves the selected instance record to the operating system trash using
`trash`, or a trusted Host's `moveToTrash(file)` adapter. Revision checks and Bundle
reference protection apply. Failure never falls back to permanent deletion.
Restoring the record restores its source; shared snapshots remain available to other
copies. There is no separate Studio recycle-bin API.

## Inspection and preview

`StudioManagementService` and `StudioBundleSourceService` expose JSON-only catalog
and source views. They inspect real UTF-8 source, resources, compiled manifests,
schemas, validation and optional relation declarations. Native Panels are provider
code; declarative Panels are source data. Identity ambiguity, traversal, binary text
reads and catalog/source disagreement produce explicit diagnostics. Runtime names
remain distinct from catalog identities.

Validation uses Core's real loader. Warnings are advisory and include locations;
`valid` means the definition loads, not that its diagnostic list is empty. Optional
knowledge-declaration analysis uses actual schema and reference declarations without
field-name heuristics, guessed relationships or source rewriting.

Panel preview uses the same loader and interpreter with isolated sample data:
explicit input, then `reference/preview.json`, then existing `initial_values`.
Invalid samples diagnose instead of silently falling back. Bounded synthetic artifact
mappings may support sample HTML/SVG resources. Preview grants no project file access,
does not run native validation drivers, and proves neither durable save/reopen nor
native Agent consumption. Hosts supply the actual installed component vocabulary.

## Verification

Build Core and Studio before checks that consume `lib`. `test:source-import`,
`test:instance-changes` and `test:current-sources` exercise real Core definitions over
isolated source storage. Their checked-in configuration explicitly aliases Core
source. `test:node` checks the built Node entry and public types separately from
browser and native Host acceptance. Historical Panel-trial records expose read/list and retained-source reads. Installed
Bundle trials still use the bounded current-source capture. The former Kit/Panel
confirmation services, archive adoption, and cumulative draft/snapshot quotas have
been removed. Current records have no confirmation state; revisions protect writes.

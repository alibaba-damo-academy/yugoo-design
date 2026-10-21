# Exact project content versions and semantic upgrades

This is the implemented MVP contract for version selection and same-project
content adoption. It extends the project pin described in the
[architecture baseline](system-design-baseline.md); it does not publish new
official Bundle versions or certify every Host adapter.

## Selection and resolution

A catalog identity has one library card. Its detail header selects an exact
published version. A fork has its own identity and card. Browsing historical
versions does not retarget a Design Project or edit a published definition.

For a new project without an active Kit, mindset selection chooses the newest
already validated complete installed Kit composition. Ordering is numeric:
`1.10` follows `1.9`. It does not assemble a new Kit from independently newest
members, evaluate ranges, or upgrade an existing project implicitly.

An existing project retains its complete exact pin. Repeating mindset selection
keeps that pin; a different Kit identity requires a separate explicit migration.
An unavailable source pin requires restoration of the full exact definitions.
It is not permission to substitute a newer version.

The existing `project.json.kit` may additionally contain:

```json
{
  "name": "example-kit",
  "version": "1.9",
  "bundles": { "example-bundle": "1.1" },
  "contentHash": "<64 lowercase hexadecimal characters>"
}
```

`bundles` is an optional map of mounted catalog identities to exact versions.
It cannot add an undeclared member, replace an identity by a similarly named
Bundle, or change a binding key. Unspecified members retain the base Kit's pins.
The runtime recomposes and validates the entire Kit closure, including its
relationships and executable/native contribution requirements. There is no
`latest` fallback for an override.

`contentHash` fingerprints the effective closure: methods, schema, presentation,
summary, manifests and captured resources. Installation directories do not enter
the hash. Old pins without these optional fields remain readable. New semantic
adoptions record the hash, and changed retained definitions then fail resolution.
All project consumers use the effective closure, including model instructions,
validation, Panel, summary, runtime drivers and saving.

## Explicit native migration

The user must explicitly request the upgrade and its exact target. Merely
browsing a version or receiving a newly published version does not authorize it.
The source and target must both be installed and exactly resolvable. The Host
checks project-wide native main/Producer/Worker/review activity and actual Panel
draft observations. Dirty files, unsaved or saving drafts, missing observations,
and disconnected pages block adoption. A controls observation is not a save
receipt. An old running attempt remains a guard even after it leaves the bounded
presentation log.

Only a real browser page registers an expected controls observation; status and
workspace reads do not invent one. A per-tab identity and increasing sequence
survive ordinary reloads. A clean close retires that page; an interrupted close
or an unsaved reload remains unknown. The reloaded page offers an explicit
discard confirmation. For an abandoned disconnected page, DSH exposes
`design_resolve_disconnected_panels`, which asks the actual user and clears only
the exact still-disconnected snapshot. Reconnection invalidates that disposition.
Timeouts and model-authored flags never count as a save or user confirmation.

Core copies the pinned Design Files and assets into bounded candidate storage
outside the live project. Its immutable plan identifies the original project,
checkpoint, source closure and exact target. Neither a model argument nor a
filesystem path supplied by the model chooses the candidate root.

The native Producer reads every page of both required reading sets: the complete
changed Bundle methods and Markdown resources, raw schema/validation/Panel and
summary declarations, direct cross-Bundle contracts, and Kit-owned shared
constraints. Each representation appears once; compiled metadata and unrelated
assets are not mandatory duplicates. Every original resource and the full source
and target closure remain available on demand through `read_upgrade_definition`
(`resource` defaults to `required`; `complete` returns the original full closure,
and an exact resource key returns that resource). No domain method is trimmed.
The real Web App single-Bundle regression measures this reading budget separately
from the tiny native SDK fixture. Candidate capabilities can list, read
and write bounded relative Design File paths and run the existing target
validators. They cannot write `project.json`, definitions, the live project, or
arbitrary Host files. Validation failure returns diagnostics to that same
generator; it does not publish. Writing again invalidates its accepted evidence.

This supersedes the original migration instruction requiring both entire
serialized Kits as mandatory reading. Retention: complete affected professional
methods and output contracts remain required; direct related declarations and
shared constraints remain required; all original methods, resources and full
compiled closures remain readable. Only duplicated compiled representations and
unrelated assets moved to on-demand reading. Semantic preservation, uncertainty
handling, same-generator repair and publication authority are unchanged.

Semantic evidence accounts for every existing canonical source. It must preserve
saved facts, IDs, references and assets. Schema validity alone is insufficient.
A target requiring new domain facts returns `needs-user-input`; the runtime does
not manufacture answers to satisfy a schema. A compatible presentation change
may preserve all canonical data bytes.

Only the owning Host's verified normal native terminal permits adoption. Prompt
text containing a candidate path is routing evidence, not confinement evidence.
A supplied receipt or scripted Agent response is not proof of a real model's
semantic judgment.

## Same-project adoption and recovery

The original UUID, root, name, creation time and knowledge provider remain the
same. Core rechecks the source checkpoint, live bytes, exact source/target hashes,
target contracts and Host quiescence inside the existing project mutation lane.
It commits the target pin and captured canonical bytes together using the
existing Git compare-and-swap operation. It never publishes the pin first.

A pending receipt beneath `.git/design-system-content-adoption` gates ordinary
reads and writes while worktree materialization and the existing DesignJournal
are reconciled. Success requires the corresponding idempotent journal reference.
Recovery checks the exact original identity, Git parent/subject, candidate bytes
and original journal owner. It reconciles an already authorized adoption rather
than starting another migration or creating a new project. External edits and
unrelated later commits are preserved and cause a conflict where appropriate.

Rejected preparation, semantic validation and pre-publication adoption leave the
current pin and Design Files unchanged. If Git publication succeeds but later
materialization or journal persistence fails, the new checkpoint is already the
Git authority: the runtime reports failure and blocks ordinary use until exact
recovery. It does not claim that the old pin is still authoritative or silently
serve partially updated content.

On session restoration and prompt assembly, the pending marker selects a
location-only recovery notice without loading the mixed Kit or Design Files.
The actual registered `design_recover_content_upgrade` capability remains
reachable through the native tool guard; a copied tool name grants no exemption.
Ordinary project reads, writes and scoped stores remain gated, and Host file
writes retain the existing denial policy. The mounted DesignService regression
uses the official SDK session-start, prompt assembly, tool loop and subprocess
service with a scripted model; it does not certify model semantic judgment.

Candidate definitions, recovery receipts and any diagnostic `.old` copies are
not independent KAG sources. This implementation stores its candidate and
recovery data outside the live Design Files and does not create `.old` Design
Files. Knowledge continues to derive from the accepted native design sources
and artifacts at the project's exact checkpoint, not from migration history or
restoration copies.

All selected DSH sessions invalidate their effective-content caches after
adoption. Old scoped stores remain rejected even after another session reopens.
A Companion refresh likewise resolves the committed full pin before continuing.
No observer is allowed to treat mixed old/new files as authoritative.

The receipt protocol is tested for process interruption and journal failures.
File contents are synced before rename; directory entries are not fsynced. These
checks therefore do not certify power-loss durability on every filesystem.
Prepared candidates are retained for diagnosis; this MVP has no automatic
candidate garbage collection. Disconnected Panel observations remain unknown,
including an old page which was closed without settling its draft. The runtime
does not silently discard that observation to permit an upgrade.

## Host entries and current verification

| Host entry | Implemented boundary | Verification and remaining gap |
| --- | --- | --- |
| DSH `design_upgrade_content` | Exact Kit/version and optional Bundle pairs; attached native child; inherited model route; inherited general tools filtered before publication; five candidate-only tools; Core adoption | Official SDK factory, registry, Agent loop and normal terminal tested with a scripted LLM adapter. Real-model semantic migration, installed-package and Windows acceptance remain unverified. |
| DSH `design_recover_content_upgrade` | Existing exact project's pending adoption and original journal owner | Isolated recovery, interruption, conflict and cache regression checks; no new migration. |
| Companion `design_prepare_content_upgrade`, candidate read/write/validate tools, `design_finish_content_upgrade` | Shared exact candidate capabilities and Core adoption; adapter-owned project-wide guard and confinement verification required | HTTP fixture checks validate this API boundary. Default Codex, Claude Code and Qoder CLI upgrade adapters do not yet provide verified confinement and remain unavailable for this operation. Their existing Bundle execution and Panel saves are unaffected. |
| Companion `design_recover_content_upgrade` | Reconcile an already recorded pending operation | Shared transaction checks; not a claim that those CLI hosts can start migration. |
| QwenWork / WorkBuddy | No new upgrade conformance claimed | Their ordinary integration tests do not establish a confined content-upgrade Producer or project-wide guard. |

The DSH entry uses the calling Host's Agent factory, delegation policy, route,
cancellation and disposal. It has no second model client, credentials store or
replacement scheduler. The Companion adapter extension points are
`assertProjectQuiescent(projectId)` and
`verifyNativeConfinement(binding, candidateRoot)`. A no-op implementation does
not satisfy their production contract; the HTTP tests' fixture callbacks are
explicitly not native CLI acceptance.

## Focused reproduction

Use the repository's declared Node and pnpm versions and installed dependencies.
Build Core before tests consuming `lib`, and do not clean/rebuild it while those
tests run:

```sh
pnpm --filter dsh-design-core build
pnpm --filter dsh-design-core typecheck
node --test packages/core/test/project-content.test.mjs \
  packages/core/test/project-content-transaction.test.mjs \
  packages/core/test/project-content-migration.test.mjs \
  packages/core/test/project-content-guard.test.mjs \
  packages/core/test/project-content-service.test.mjs \
  packages/core/test/project-content-candidate.test.mjs \
  packages/core/test/project-content-definition.test.mjs \
  packages/core/test/dsh-content-upgrade.test.mjs
pnpm --filter dsh-design-core test:workspace-refresh
TSX_TSCONFIG_PATH="$PWD/tsconfig.base.json" node --import tsx --test \
  packages/panel/test/panel-draft-lease.test.mjs
TSX_TSCONFIG_PATH="$PWD/tsconfig.base.json" node --import tsx --test \
  packages/companion/test/content-upgrade.test.mjs \
  packages/companion/test/content-library.test.mjs \
  packages/companion/test/project-commands.test.mjs
```

The separate internal `dsh-content-upgrade-sdk.test.mjs` requires a built official
DSH checkout supplied through `DSH_TEST_HOST_ROOT`. It proves SDK tool isolation
and terminal handling with synthetic model responses; it requires no user
profile or credentials and is not a public installation step.

Actual browser checks separately confirmed one Kit/Bundle card, historical
version selection in the detail header, and an unchanged old project pin.
With the normally built Companion browser and an isolated source-server fixture,
actual Chrome checks also confirmed clean reload identity, clean close retirement,
multiple-page draft protection, explicit confirmation after a dirty reload, and
continued blocking after another page disconnects while a clean page remains
connected. These actions left the saved canonical bytes unchanged. Those checks
do not prove native Panel rendering, semantic generation or installed distribution. Source
review, main integration, public export, npm packaging and publication remain
separate delivery operations.

# Shared Design Studio UI

`dsh-design-studio-ui` is the shared React Studio. Its sidebar contains Kits
and Bundles, with Kits as the entry view. A host may additionally expose the
Component Library capability. The established Studio layout has a compact
breadcrumb/refresh bar above the workspace, with neutral typography, colors and
control details. Shared authoring guidance is in the
[Panel UIUX standard](../../docs/panel-uiux-standard.md). Storage concepts such as
Panel drafts must not add top-level navigation sections. The optional **Panel Component Library / 面板组件库**
entry is a bottom sidebar utility, above the shared language switch, not another
primary Kit/Bundle section.

The Kit list provides a compact **Browse official kits / 浏览官方设计套件**
documentation link to the maintained public `docs/wiki/kit-sharing.md#official-kits`
guide. It opens a separate tab and does not install, adopt or update content, or
retarget project pins. The installed catalog still comes only from the host.
Public repository visibility and document synchronization must be verified before
claiming that this external guide is available to anonymous users.

## Locale and catalog copy

Studio accepts an explicit host `locale` (`zh` or `en`) with a document/browser
fallback. Bundle cards use the loader's existing bilingual title and display
description; IDs and raw source files remain unchanged. Search includes those
localized catalog fields without replacing the authoritative method description.
Kit, Bundle and editable-copy catalog cards share the same grid, 15px padding,
15px title and 12px description scale; differences in content do not introduce a
separate Kit size variant. Description excerpts stay bounded to three lines.
Kit cards and file sidebars use the loader-projected optional bilingual display
description from Mindset frontmatter, with the original description as fallback.
Bundle file sidebars reuse existing bilingual picker copy. A narrow, independently
scrollable right sidebar shows full copy; standard file purposes appear after the
filename in 12px secondary text. Exact standard relative paths are recognized by
one shared UI map; unknown files have no guessed purpose. No file bytes are edited
or translated by viewing or changing locale. English names/headings use Title Case,
actions and explanations use sentence case, following the shared
[Panel UIUX standard](../../docs/panel-uiux-standard.md); Chinese Kit is 设计套件.
The sidebar-footer Chinese/English switch is the single Studio language control; hosts
persist it via `onLocaleChange`. Trial requests snapshot the current Studio
language as `locale` (`zh-CN` or `en-US`); there is no trial-local selector.
Switching language never reruns or translates existing results.
User task text remains byte-exact; natural-language locale
inference is not implemented. Hosts must bind the result Panel to its recorded
trial locale rather than inheriting an unrelated browser-origin preference.

## Mindset editing and source files

`MindsetInlineEditor` is an optional control embedded in the original Kit page.
It lazily creates/reopens a Kit working copy via the existing authoring client,
edits body segments without trimming, and preserves frontmatter and the unique
`design_skills` block byte-identically in folded read-only sections. Ambiguous
protection boundaries refuse editing; CAS failures retain pending input. Hosts
keep `installedSource` stable and adopt `onSource` into both raw/reading draft
views. Saved content is marked unpublished, not installed or published.
Optional `initialId` explicitly reopens a selected saved
record on mount; `onRecord` returns checked create/read/save receipts so the parent
can retain/select IDs on the original page. No latest-record heuristic is used.
Disposal invalidates late requests. `onDirtyChange` supplements the browser-unload guard
with the host's navigation/close guard. Focused source-plane checks:
`TSX_TSCONFIG_PATH=packages/studio-ui/tsconfig.json node --import tsx --test packages/studio-ui/tests/mindset-inline.test.mjs`.
These controller/SSR checks do not establish integrated browser or durable host
save/reopen acceptance.

The Kit files tab uses the same file explorer as Bundle and local-copy views.
Hosts expose optional `readKitFiles` / `readKitFile` ports for confined, exact-version
installed source reads; without them only the supplied Mindset is available.
The Companion adapter provides the full physical tree and bounded UTF-8 reads.
Raw Mindset includes the mount XML. Local Kit mounts are explicit checkboxes over
retained exact Bundle versions, saved through `updateMounts` with revision checks;
installed originals stay protected. Removal means deleting a recoverable local
copy, not uninstalling a Kit or Bundle. UI classes use the `ygd-studio` prefix;
package identities are unchanged. Studio loading locations share one indicator
with the KAG indeterminate sweep treatment (no fake completion percentage).

## Bundle trials

The title row owns the sole explicit trial entry. It checks the host connection,
then asks the native Agent to prepare a concrete input and execute it in the same
turn; merely mounting the UI never runs a Bundle. Preview uses left `panel.yaml`
and right sample Panel; trial uses the same split with left test input and right
actual isolated runtime Panel, not a modal or another mode toolbar.
A host may supply `panelUrl`
for its authenticated Panel-only presentation; otherwise the independent result
link remains available. Editing input does not execute anything: an
explicit rerun sends the exact edited text to a separate isolated trial. History
keeps the original input of each result. A waiting interaction may start another
round, but an uncertain or running sibling trial blocks reentry.

Hosts can supply `trials: StudioTrialClient` to enable a Bundle-local trial action,
including saved Panel draft revisions. The adapter owns immutable snapshots,
isolated projects, native dispatch, durable history and cleanup. This UI does not
start a model or write Design Files. Queue acceptance is not completion; missing
native evidence remains `unknown`. Stop failures leave the trial active, and only
verified terminal trials can be removed. Result links open the isolated runtime
Panel. The installed viewer and draft editor retain their existing behavior when
the capability is absent. The browser fixture under `tests/trial-browser.tsx`
tests presentation only and is not evidence of native execution.
The optional `checkConnection` port must return `available`, `unavailable` or
`unknown` from non-generating transport/session evidence. Absent, unknown or failed
checks do not launch a trial. API/thread reachability is not proof that a native
turn was consumed or completed; the existing trial evidence rules remain in force.

The trial's fixed bottom-right actions are “Undo edits” and “Demonstrate save”.
They demonstrate the Panel's saved UI state in the current browser only; they do
not publish design changes or send an Agent continuation. Undo returns to the
latest local demonstration baseline. Reload restores the actual generated result.

## Panel authoring and shared controls

Optional authoring: hosts may supply `StudioAuthoring` to edit the left YAML in
the preview workplane. The first actual source change lazily creates a retained
Panel draft through the existing port, preserving text typed during creation.
Simply viewing installed content never creates a draft or changes the installed
Bundle. Subsequent source edits debounce the shared runtime preview, and save uses
the existing optimistic revision check. An unambiguous retained copy can be resumed
explicitly; a delayed recovery read cannot replace subsequently typed source.
Late or mismatched save receipts cannot switch another Bundle's trial source.
Trials of edited Panels use the saved
exact draft revision; unsaved source must be saved first. Native Panels without
`panel.yaml` explicitly explain that they have no editable YAML source.
`StudioPanelDraftController` rejects stale or mismatched preview replies. Hosts
render with sample-only ports; the shared UI imports no Panel implementation.
`onDraftDirtyChange` guards host closure and navigation. Confirmation locks a
local draft, not a published Kit; preview alone never starts execution.

The optional host-neutral `renderSelect: StudioSelectRenderer` port supplies the
shared choice control for Bundle/Kit versions, Mindset working-copy recovery and
the two Kit preview Bundle selectors. DSH's standalone browser page and Companion
inject the existing Panel control; Studio UI imports only the local port types.
Hosts without the port retain a controlled native select. Values, empty choices,
unknown stored values and disabled options remain caller-owned. Studio supplies
its compact 32px trigger geometry and semantic token bridge; the shared popup
keeps keyboard/focus handling and carries its own styles. Recovery menus stay
inside an open native dialog's top layer. This changes presentation only, not
working-copy, preview, CAS or save operations.

## Component library

The optional `componentLibrary: StudioComponentLibrary` adapter supplies the
actual same-build DSL catalog, display names, trusted synthetic examples and
the bundled `design-component` Skill. The UI does not register components or
import Core/Panel. The Companion adapter renders examples through the existing
`DslPanel`, using only confined fixture artifact reads and no data-write port.
Search, independent catalog scrolling, fixed read-only examples,
copyable full declarations and an extension prompt are available. Entries without
standalone examples remain visible with an honest limitation and a query for the
existing `design_list_panel_components` authoring tool. DSL availability and
generated-subset eligibility are distinct. All currently registered components
have populated examples; runtime-log examples explicitly use a finite synthetic
transcript and never read native Host logs. No host, model, project-save,
installation or publication port is granted by this view.
Preview containers distinguish compact inline examples, bounded navigation
examples and height-filling workspaces, while keeping the same renderer and
declarations. This is component documentation, not a draft editor or state-test
workbench: examples cannot modify their content, save, or create drafts. Viewing
interactions such as tabs, expansion and record navigation remain available.
An optional host `renderDirectory` port reuses the real shared Panel tree groups
and items; the host-neutral fallback uses expandable disclosure groups. Human-facing
catalog and preview titles use the selected locale; machine component identifiers
remain in Declaration and Usage, not a second apparent title.
Hosts may additionally supply `libraries` read-only metadata. A separate catalog
shows primary third-party UI libraries, package names, exact same-build resolved
versions and bilingual purposes. This is not an exhaustive transitive dependency
or license inventory, an update manager or a second DSL registration authority.
Companion derives version values from the same package metadata used by its
browser build; changing these entries never installs, upgrades or enables a component.
The self-contained Skill's single source is
`packages/companion/plugin/design-system/skills/design-component/SKILL.md`;
Companion embeds those exact bytes for copying and includes them in its existing
Codex, Claude Code and Qoder packaging slots. WorkBuddy packaging and installed
plugin activation are separate integration steps. Custom compiled components
require a development-source change and the existing registration/validation/UI
contract; this view is not a dynamic executable component marketplace.

## Source browsing and retained copies

Bundle pages put Source files first and Panel preview second. The recursive file
explorer displays actual source paths, including nested reference folders. Trial
execution is a Bundle-local action. Installed previews use the optional read-only
`previewInstalled` transport and the same runtime renderer. The installed host
loads Bundle-owned `reference/preview.json` before runtime initial values; the
preview displays the actual selected sample rather than an empty placeholder.
A missing sample is a diagnostic, not a fabricated populated Panel.
User-provided preview samples remain
isolated from project files. Request revisions and exact Kit/Bundle pins prevent
obsolete responses from replacing the current preview.

Mindset reading separates its body from frontmatter and the generated
`design_skills` section. The complete byte-exact file remains available in a
dialog; the reading projection never rewrites source. The contents list is
derived from rendered headings, so headings inside fenced examples do not create
incorrect navigation entries. Installed reads never mutate the original.
Hosts may supply the optional `instances` client for complete retained local copies.
Copy opens an independent editable file set; title-pencil renaming changes the
selected language's display name without changing source identities. The header places
an arrow-only Back action on the left and direct Copy/Delete actions on the right.
Deletion checks local references and retains recoverable
data. The existing Kits/Bundles lists include local copies, with no new navigation
area. Saves use optimistic revisions; preview compiles saved local bytes through
the existing renderer. Copies are unpublished and never retarget active sessions.
Hosts without this capability expose no inert mutation placeholders. Mount editing,
publication and native trial dispatch of complete local copies remain separate
capabilities, not implied by save or preview.

When Kit authoring is available, Mindset editing stays in the original document
page. Complete source is saved through the existing revision-checked draft API;
frontmatter and the generated mount block are preserved byte-for-byte. Saved
records can be selected explicitly after refresh, never by an implicit “latest”
lookup. Reading/full-file views show the selected saved draft, clearly unpublished;
the installed source remains the immutable editing base. Leaving dirty input
requires confirmation. This is not Kit publication or full Bundle-file editing.

The package renders installed Kits, searchable Bundles, Kit workspaces and byte-exact read-only Bundle source files. Resource inventories belong in the file explorer, not a paragraph beneath the Kit cards. File viewing uses one toolbar, a scrollable document body and a compact byte-count/status footer; Markdown metadata is folded without removing it from the raw source. Schema and validation files use that same viewer without additional compiled-summary blocks. A Bundle workspace overlays its original section and returns without a re-read. Kit selection carries the exact `name@version` pin; divergent identities and obsolete asynchronous responses cannot replace the current workspace. Without the explicit authoring capability there are no draft controls. With it, edits are kept in a separate draft rather than changing installed content. All data comes from server views; the UI hardcodes no Kit, Bundle or version and imports no Agent Host, Design Core, G/R/A or filesystem API.

## Layout and typography

Styles are scoped to Studio: system CJK typography, purple `#7c5af6` brand accents
(hover `#6849d8`, active `#5032bc`), neutral `#272727` primary text,
`#6d6d6d` secondary text, light borders, 8px control radii, and compact search and
file rows. They do not import a Panel or Core theme. Markdown uses an
injection-safe subset renderer; raw Bundle files remain byte-exact.
All Studio page title regions share one compact baseline: a 32px content row
with 8px above and below (48px single-line height), 18px/24px medium-weight
headings, and 32px title icons and action buttons. Kit, Bundle, catalog and local
copy pages do not own competing vertical sizes. Optional catalog guidance sits
beside the title when space permits. Long titles, guidance and action rows may
wrap naturally on narrow screens; the header never clips them to a fixed height.
Pipe tables render with column headers, delimiter alignment, inline code and
emphasis. Escaped pipes stay in their cells; fenced examples remain code. Tables
use compact borders and a horizontal scroll container within the file viewer.
UI copy follows the host document/browser locale, but authored file content is never
translated or abbreviated in the document viewer.

## Content archives

Hosts may pass `contentClient` to expose **Content archives** in the existing
workspace toolbar; the sidebar remains Kits / Bundles. The archive workbench
accepts a file or pasted JSON, retains the import and displays its exact identity,
provenance and validation diagnostics. Import preparation does not create a
working copy. Explicit adoption retains validated content in the local content
library. Adopting a complete Kit additionally requires `kitAuthoring`; its receipt
opens the exact unconfirmed Kit working copy in the existing editor. A standalone
Bundle requires no Kit editor and opens its exact source workspace after the
catalog refresh. It is not implicitly mounted into a Kit or attached to a project.
The adoption receipt must preserve the import ID, exact content closure and inert
authority; a Bundle receipt must not contain a Kit draft. Adoption never overwrites
installed sources, retargets project pins, publishes or executes content.

Unprepared input participates in workspace navigation and browser-unload guards;
leaving the workbench invalidates late UI responses. Export uses the selected
installed Kit's exact version and user-supplied source/license declarations, and
downloads the returned archive bytes unchanged. Hosts without `contentClient`
retain the existing UI. The size check includes the JSON RPC wrapper and escaping
against Companion's 12 MiB request limit; it never truncates an archive.

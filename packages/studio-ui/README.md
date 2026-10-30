# Shared Design Studio UI

`dsh-design-studio-ui` is the shared React Studio. Its sidebar contains Kits
and Bundles, with Kits as the entry view. A host may additionally expose the
Component Library capability. The established Studio layout has a compact
breadcrumb/refresh bar above the workspace, with neutral typography, colors and
control details. The narrow-screen menu and navigation drawer are anchored to
this workspace, including when a host places it beside or below a conversation;
they do not cover the host's header. The drawer fades within that boundary
throughout its opening transition. A closed drawer also hides its controls
from keyboard focus and the accessibility tree. Shared authoring guidance is in the
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

Catalogs and installed source remain read-only browsing surfaces. With the
`instances` capability, **Open / 打开** reads a local copy without host conversation
or mutation controls; **Copy / 复制** uses the existing S2 service to create an
independent copy and opens it for reading; **Edit / 编辑** explicitly enters local
copy authoring. A local copy can be copied again using its saved canonical source.
`instances.editCurrent` opens the same library identity for editing; Copy alone creates a new independent identity. Delete and less frequent
working-copy actions live in the shared right-hand overflow menu. Studio does not
expose an installed-package uninstall port; installed packages remain host-owned.
Hosts can supply `renderPreview` for saved-instance sample Panels, including
read-only **Open**, independently of the legacy Panel-draft `authoring` client.
The renderer receives the existing isolated preview and read-only context;
supplying it does not enter native authoring or grant a save capability.
Optional `instances.create` adds **New Kit / New Bundle**, creating a real blank S2
record before entering its editor. Empty definitions may still require content or
mounts before validation succeeds.

Kit and Bundle catalogs share the established header: a 300px search control on
the left, matched/total counts, and New on the right. The product breadcrumb already
names the section; the catalog does not repeat its heading. There is no local version picker or publication status. The existing leave guard protects unsaved edits.

Only new/edit object entries invoke `renderContent(content, context)`, inside the
Studio stage. The context supplies the object's `id`, create/edit `intent` and
`onDirtyChange` for unsent input. Editing retains product navigation, top bar,
object title, Back and full file tree. It hides the introduction sidebar; normal
reading can show the existing description. Introductions remain source-owned in
Mindset/SKILL metadata and existing locale resources: AI can propose the wording,
which people can revise and confirm through source editing.

A Kit editor has two tabs: **Source Files / 原始文件**, followed by
**Mount management / 挂载管理**, without a Panel preview or arbitrary
first-Bundle selection. Mount management uses the same Bundle cards as the catalog: only unmounted candidates on the
left in a narrow single column, mounted Bundles in the wider main area on the
right, with search only on the left. Card descriptions use the same Bundle
metadata and presentation as the catalog. Add/Remove
moves the card between columns and reports the unsaved added/removed counts; the editor's global Save uses the existing revision CAS.
Missing mounted sources remain visible and cannot be silently omitted from a save.
Preview diagnostics describe incomplete definitions without preventing source saves.
Save and Revert stay in the object's top-right header across source, preview and
mount views. The source toolbar switches between Edit and Diff against the saved
revision. AI proposals and manual corrections share the current source draft;
changing files or switching to Panel Preview does not discard it. Preview renders
the current files through the existing preparation service, including unsaved
`panel.yaml` and locale edits. Its sample data is not a separate save target.
Editing an AI proposal prepares a new digest for the exact files being saved.
Human and AI edits share ordinary source-save semantics; stale or
uncertain saves remain blocked until the existing read/reopen path verifies them.
The file workspace fills its content area using ordinary column dividers,
without another bordered card, rounded frame or exterior gutter.

The workbench's `renderSupplement` reports the canonical record/revision,
dirty/busy state, exact preview Bundle pin, entry intent and current relative
source file. The Preview workplane reports `panel.yaml` as `currentFile` when
that source exists, and uses the existing split: the same source editor/diff on
the left and live sample Panel on the right. Both views share drafts and the
object-level Save/Revert controls. Hosts use these as editing context,
retain revision and native-binding checks, and invalidate late asynchronous
results on exit or object switch. These hints grant no source or save authority.

The optional `proposalReplacement` supplement capability derives from the same
source, title and mount drafts and the existing candidate-save fence. A host can
replace a pristine proposal during one request, or offer an explicit choice that
uses the editor's ordinary discard confirmation. In-flight and unverified saves
block replacement. Same-revision refresh preserves the selected file and view;
human edits keep their current proposal until explicitly discarded.

Hosts may open an exact working copy through `initialInstance` (`id`,
`expectedRevision`, optional `bundle`). The standard `InstanceWorkbench` checks
that revision and pin before exposing source or preview; a Kit handoff without a
Bundle pin starts in source files and does not guess the first mount. This is a
one-time entry selection: later explicit saves and navigation use the existing
instance lifecycle. A host-supplied `renderInstanceWorkbench` receives the same
`initialSelection` and must preserve those checks. The host validates its native
binding separately; these props grant neither execution nor save authority.

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

Kit and Bundle content uses one instance editor. `editCurrent` opens a stable
library identity, internally materializing its source only on first edit; subsequent
edits return that same record. The UI replaces the installed card with this current
record rather than showing two copies. An explicit Copy creates an independent
identity and file set. Mindset, manifests and nested resources are ordinary source
files; there is no separate Mindset draft, recovery picker or confirmation lock.

The Kit files tab uses the same file explorer as Bundle and local-copy views.
Hosts expose optional `readKitFiles` / `readKitFile` ports for confined, exact-version
installed source reads; without them only the supplied Mindset is available.
The Companion adapter provides the full physical tree and bounded UTF-8 reads.
Raw Mindset includes the mount XML. Local Kit mount management presents available
and mounted Bundle cards by stable identity, saved through `updateMounts`
with revision checks. Mounted local Bundles use their current saved content;
project-owned copies are unaffected by library changes. Removal moves the local
copy to the system Trash, without uninstalling installed content. UI classes use the `ygd-studio` prefix;
package identities are unchanged. Studio loading locations share one indicator
with the KAG indeterminate sweep treatment (no fake completion percentage).

The shared working-copy editor's **Refresh working copy / 刷新副本** action reads
the current saved revision, including changes made through the Host conversation.
It uses the existing discard confirmation for local source edits. Host conversation
input remains owned by its surrounding workbench; refreshing source does not send
that input. A Kit's existing mounted-Bundle preview selection is also available
to the Host supplement, so authoring uses the same view context.

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
using the current saved source files. The adapter owns immutable snapshots,
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

Hosts pass an already prepared S1 `{request, candidate}` through
`InstanceWorkbench.sourceChanges`. The current workbench and complete source tree
stay mounted. A proposal opens its changed file in **Source Files**, where exact
inline additions, removals and context show the pending source. Unchanged files
remain readable in that tree; new files appear beside the existing source. The
existing **Panel Preview** is a read-only sample view of the same candidate.
There is no separate review page or review-entry button.

The shared candidate state captures the full replacements once, rechecks the
working-copy revision and saves only through the supplied `saveChanges` port with
the digest of the exact proposed files. Saving remains explicit. Success updates that same
copy and its new saved revision in place, so the existing export action reads
the saved source. A proposal arriving during human edits waits without reloading
or replacing them. A stale base cannot save; an uncertain save receipt disables
resubmission and export until the existing refresh/reopen path verifies the copy.
A failed reopen leaves that uncertainty intact. Late receipts cannot switch the
selected copy or candidate.

Operation failures use contextual `StudioFeedback` cards with recovery actions.
`StudioEmptyState` separately displays missing content in the affected region,
centered with a warning icon and the missing file or sample; valid no-Panel content
uses its neutral `info` tone. Neither state opens a modal automatically.
Blocked explicit saves use the shared `StudioErrorDialog`. Its
controlled props are `open`, `onClose`, `title`, optional `message`, `details` and
`actions`, and `locale`. Details expand inside the dialog; file navigation and
recovery actions close it without taking focus away from their destination.
Escape and ordinary dismissal restore the trigger's focus. `StudioFeedback`
opens technical details in this dialog on request; explicit `autoOpen: true`
is reserved for blocking action results and opens once per stable `feedbackId`.
Success remains nonblocking.
Hosts provide real recovery actions and keep repair in the existing conversation.

The editor toolbar contains actions without inline error explanations. Incomplete
source can be saved; preview errors remain in the affected preview region. Human
and AI source changes use the same save mode. Busy, stale or uncertain writes
remain protected, and filename format errors stay beside the input. A missing
preview renderer does not prevent saving files. Native Agent completion, source
save, preview success and runtime consumption are distinct facts.

`StudioAuthoring` supplies only installed sample preview and the shared runtime
renderer. All editing uses `StudioInstanceClient`; the old Panel/Kit draft editors,
confirmation/fork workflows and standalone review page are removed. `renderSelect`
remains the optional shared control adapter for ordinary supported choices. It
must preserve caller-owned values, unknown stored choices, focus and popup styles.

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

## Source browsing and current content

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

Mindset reading preserves the complete source alongside its Markdown projection.
Reading files never creates an editable record.
Hosts may supply the optional `instances` client for complete retained local copies.
An optional `renderInstanceWorkbench(props)` presentation port can render an
existing instance inside the same Studio navigation. It receives the complete
`InstanceWorkbenchProps`, including the original client, ID, locale, preview and
back/change/dirty callbacks. The instance ID keys its lifetime; a nullish return
keeps the standard workbench. This presentation port grants no additional catalog,
save, execution or publication capability. Hosts that omit it retain the existing
source editor. Catalog counts and empty states include visible local copies using
the same search filter as their cards.
Copy opens an independent editable file set; title-pencil renaming changes the
selected language's display name without changing source identities. The header places
an arrow-only Back action on the left and copy/edit actions on the right, with
export and the red **Move to Trash** action in the shared overflow menu.
Removal checks local references and moves the working-copy record to the system
Trash. Its confirmation identifies that destination; success appears only after
the operation succeeds. Users restore through the operating system or import
again. The existing Kits/Bundles lists include local copies, with no new navigation
area. Saves use optimistic revisions; preview compiles saved local bytes through
the existing renderer. Saved content is usable without publication. Existing projects retain their own definition trees.
Hosts without an editing capability expose no inert mutation placeholders. Native runtime consumption still needs its own verification; preview success does not prove it.

The package renders searchable Kits and Bundles, current content editors and
byte-exact file views. Resource inventories belong in the file explorer, not a
paragraph below cards. One toolbar, scrollable body and byte-count/status footer
serve every source file. Metadata may be folded for reading without changing raw
source. All data comes from host ports; the UI hardcodes no Kit or Bundle and
imports no host runtime, Core implementation or filesystem authority.

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

## Import and export

Hosts provide `instances.importSources` for the **Import / 导入** action beside
**New** in each catalog. Bundle import accepts a ZIP, folder or bare `SKILL.md`;
Kit import accepts a ZIP or folder containing `mindset.md` and `kit.yaml`.
A folder can be selected from the adjacent import menu. Archive manifests remain
supported, but ordinary source ZIPs do not need a manifest.
Import preserves the complete selected Skill directory, including nested
`references/`, `assets/`, `scripts/` and other resources with their original paths
and bytes. `SKILL.md` identifies the Skill; it is not a whitelist of its contents.
Saving and exporting an incomplete copy retains these resources too.

Import creates a local working copy. Missing Bundle files are listed in a simple
completion dialog: **Not now** keeps the copy with an **Incomplete** card warning;
**Complete with AI** opens its editor and prefills the host conversation with the
missing items. The user sends the request and reviews the ordinary source diff,
preview and save. The source file tree also offers **New file** for manual additions;
new paths share the existing unsaved changes, diff, global save and revert.
No new model client is used. Kit issues can be corrected in
its existing source/mount editor. The warning reflects current saved sources.
Name collisions get distinct local names rather than overwriting content.

`contentClient.export` downloads a ZIP directly from the object's overflow menu
or saved-copy action. There is no source/license form, export modal or licensing
check. The download preserves source files and readable Unicode titles, without
internal revision/version suffixes. Export uses the exact saved revision; pending source
edits retain the existing save/discard behavior. Imported incomplete copies may
also be exported. Installed content and project pins are unchanged.

Import success refreshes the current catalog. Failure to refresh after import
retries the read, never the import write. File selection cancellation is inert;
existing transport limits report errors without truncating sources.

## Host contribution beside a working copy

`ConversationMessage` and `ConversationActivity` provide the same message and
collapsible tool-record presentation for Companion and Studio. Hosts supply actual
public messages, tool names and observed outcomes; these components own no model
client, transcript store or execution state. Running work uses the shared circular
indicator and the composer Stop action, without an estimated progress bar. Polling
preserves a user-collapsed tool group; terminal work stops animating.

`InstanceWorkbench` is available as a component value as well as a props type.
Its optional `renderSupplement({ record, dirty, busy })` renders host controls
after the existing header. This callback must stay pure; its `dirty` projection
includes source and title edits. The shared editor keeps source state and save
behavior. Host containers supply the existing Studio shell and styles, preserve
pending edits across asynchronous results, and supply `sourceChanges` for
in-place prepared source changes and explicit save.

Hosts composing a persistent conversation beside the content may use
`embedded` on the workbench to render a section inside their existing main.
A full Studio retains its original conversation beside the content; a host
embedding only the content keeps its own conversation and does not read or add a
second one. A single exact native proposal enters the current source workbench
directly. Pending proposals preserve the current human edits; replacing one uses the ordinary discard decision and never saves implicitly.
`InstanceWorkbench.initialView` selects `files` (the unchanged default) or
`preview` on opening. A Bundle without `panel.yaml` opens its source files even
when the host requests preview. These presentation options grant no new execution or save
capability. The shared authoring layout keeps conversation and content scrolling
separately and places the input below the conversation; a narrow viewport stacks
both regions. Request history shown by a host must identify its actual scope,
rather than imply a durable native transcript.


### Portable import and export

Export downloads a `.zip` file containing the original sources and assets under
`content/` plus `studio-manifest.json` with the exact version, provenance and
integrity metadata. Import accepts this ZIP or a previously exported JSON envelope
through the stateless `readArchive` integrity parser, then `instances.importSources`.
There is no retained import record or separate adoption step. Missing, unexpected or damaged
files produce a recoverable error; importing never silently repairs a package.
The existing expanded-content and HTTP request limits still apply. Export checks
the same import request budget before downloading, so oversized content is
reported without discarding or truncating source files.

An import that succeeds remains successful if refreshing the catalog fails. The
notice offers a read-only refresh retry without repeating the import. Downloading
initiates the browser save operation; it does not prove the user saved to disk.

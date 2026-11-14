# Yugoo Design Panel package

This package supplies the shared Panel runtime for Yugoo Design: declarative
compilation, React rendering, editing controls, and workspace state. Host
discovery, compilation and rendering have separate entry points.

Ordinary read-only fields share one reading surface: the caption stays outside,
while text, scalar choices and simple lists use the base background and a subtle
semantic border. Table cells, complete record cards and specialist canvases keep
their existing boundaries. Record headers can place brief read-only metadata at
the end of their title row; long context retains its separate reading line.

## Import entry points

| Import | Purpose | Runtime requirements |
| --- | --- | --- |
| `dsh-design-panel` | Node plugin `name`/`apply`, DSL compiler and pure state helpers | Node and declared Host/Core dependencies; no React runtime |
| `dsh-design-panel/ui` | Complete component/interpreter library and Node rendering tests | React 18, ReactDOM and the declared renderer dependencies |
| `dsh-design-panel/interpreter` | Browser renderer library | Browser and React 18 |
| `dsh-design-panel/client-api` | Broad shared APIs consumed by trusted browser providers | React 18 and the shared provider/renderer dependency graph |
| `dsh-design-panel/select` | Isolated browser choice control and popup stylesheet | React 18, ReactDOM, Radix Select and Lucide; no workspace/canvas runtime |
| `dsh-design-panel/sample-preview` | Isolated declarative sample using the runtime interpreter and shared styles | Browser and React 18; sample data only |
| `dsh-design-panel/client` | DSH browser plugin factory | DSH client module loader and its shared platform instances |

Public npm specifiers use the `@yugoo-design/` scope. Development source uses
the unscoped workspace specifiers shown above.

`pnpm --filter dsh-design-panel build` builds CSS and runs the normal browser, Node and declaration builds sequentially to bound peak memory.

Browser builds retain the standalone image resizer and the reducer's embedded
resizer as separate pinned inputs. The browser dependency plugin compiles fixed
classic Worker scripts only when each package entry is loaded. Browser entries
that load these dependencies emit a `pica-static-workers-<entry>.json` inventory with source pins, precise
Parent patch ranges and the actual task, empty-probe and OffscreenCanvas
capability scripts. Their build-time checks cover script source and finite
adapter seams; Pool behavior and browser/Host execution require their own checks.
Upstream source or compiler drift fails the build until its pins are reviewed.

Browser adapters inject `PanelSelect` from the separately built `select` entry
into a neutral control port without loading the Panel/DSL workspace or canvas
dependencies. The broad `client-api` retains compatible re-exports but is not a
control-only bundle entry. `PANEL_SELECT_MENU_CSS` is
the same popup stylesheet used by the control's open Portal, so standalone pages
can include it in their own DOM lifetime. Trigger geometry stays with the owning
scene stylesheet. Shared surfaces inherit the Host's resolved `color-scheme`
and semantic colors, with scoped light/dark defaults in `visual-components.css`.
The ported utility stylesheet includes this same foundation, including load-error
surfaces. The initial client-owned styles entry also loads that foundation, so
host-level shared controls such as advisory help do not depend on opening the
Design Dock first. Both paths retain the same source and existing CSS/HMR owner;
dock chrome must not add another palette or copy of a control's styles. Canvas
theme controls retain explicit user choices; their initial default follows Host.
The popup inherits the trigger's actual theme and remains
inside the nearest open native dialog when present; other menus use the owning
document body.

The DSH Loader row must name the **package root**. In the installed
DSH 0.2.0-rc.2 client-module discovery contract, a package subpath is not a
substitute for that row. The root's optional HTTP CSS carrier follows the
`webServer` lifecycle. Browser registration of `designNativePanels` and
provider registration retain their existing browser-owned lifecycles.

Import components and interpreter helpers from `dsh-design-panel/ui`, rather
than the package root. Keeping React out of the root lets native Node activation
work without renderer peers that the Host supplies only in the browser. The
existing `lib/index.js` library and all its exports remain in `ui`. This entry
includes Node Host APIs and is **not** a browser bundle; browser callers should
use `interpreter` or `client-api`, or `select` for the isolated choice control.
The root retains DSL parse/validation, record edits, attachment limits, clarity,
navigation, native registry, workspace admission and dock state APIs.
UI-associated advisory, project and continuation helpers remain with their
components in `ui`.

## Shared presentation and editing

The workspace exposes two icon buttons in its top-right header: one switches
Chinese/English, and one switches light/dark from the actual current appearance. Host adapters supply controlled values and save through their existing
settings owner; changing either preference retains the design draft and does
not translate authored content. The workspace has no separate close button;
embedded hosts retain their native Panel toggle. Nested Studio previews omit
these global choices, while a workspace that hides project metadata retains a
compact preference toolbar. Relationship canvases can override appearance and
return to following the page without rearranging the graph.

Page title bars share `PanelRecordHeader` across forms, questions, diagrams,
reports, previews and canvases. The common frame has a 44px minimum, the shared
content gutter, centered title and actions, and one background/divider treatment.
Page actions use 32px controls; the inline title pencil and inner canvas tools
retain their own roles. Supporting context keeps its full text with one 4px gap;
long titles or context can increase the height. Scene components supply content
and native handlers rather than another title-bar geometry.
Counts follow the title with the shared 8px gap; actions stay on the right.

Record workspaces select one object or grouping in the sidebar and show only
that scope. Grouped boards retain adjacent child cards and natural scrolling
inside the selected group. The current scope uses the shared page title bar and
divider. Its first-level form units use muted content groups: each function or
acceptance record supports its base reading/editing body, while a process node
collection supports its base node cards. Group labels stay projections of the existing
records; navigation adds no parent entity or second save channel. Diagram
details show one process title and its child node cards without repeating the
process in an outer disclosure. Saved identity fields are not automatically
promoted into visible business numbers; presentation uses explicit number
bindings and preserves technical element identities.

In record boards, save, failure and retry retain the chosen view, group, selection, disclosures and
scroll position. Saving locks editing without becoming a Bundle execution;
the board's automatic overview transition follows actual execution completion.

Local drafts keep the original canonical content on which editing began, including
pending native editor input. Incoming Agent updates remain available for Cancel
without replacing that save baseline. Ordinary saves carry the baseline and
prepared artifacts through the existing save channel; a concurrent content change
reports a conflict and preserves both the newer saved content and the local draft.
Cancel loads the latest content so the user can reconcile and save normally.

Always-expanded question groups share one compact form frame. Single choices
use the shared dropdown, multiple choices wrap inline, and fields adapt from two
columns to one at narrow reading widths. Answers, context, ordering and editing
permissions retain their original draft/save channel. Ordinary question cards
retain their independent disclosures.

Static document readers derive chapter-end source links from the existing heading
annotations. These links inherit the document’s reading style and use the shared
Panel navigation callback; they do not add a persistent source toolbar, rewrite
the authored HTML, or change the authority of the source records.

`artifact_workspace` can expose declared parent and child plan fields through
the shared record form. Plans are editable before execution and before their
report exists. Published child artifacts retain their reader while Details
shows the saved questions and the available artifact-scoped activity read-only;
missing logs are reported without inventing question-level associations. Parent
conclusions remain readers without a Details switch. All plan edits use the
canonical record and global Panel draft/save channel. Unconfigured artifact
workspaces remain readers. The shared `list` control edits complete
string entries individually, preserving internal line breaks, whitespace,
duplicates and order in ordinary, nested and standalone fields.

Automatic node progress uses `ExecutionRollingLog` only while its observed
executor is queued or running. Settling unmounts its reader and polling, rather
than leaving a collapsed trace header; content errors retain their own recovery.
Empty artifact, Page, diagram and canvas regions share the same centered placeholder.
While their actual executor is active, an unpublished result shows its progress
without a second empty or unavailable message. Missing log access uses the shared
loading indicator; read and parse failures keep their error and recovery paths.
Artifact workspaces use the same runtime progress for the selected parent or
child, keeping already readable reports beside the progress rather than covering them.
Whole-document workspaces use that same centered progress for first generation
and regeneration. Regeneration hides the previous report and outline until the
current execution settles. A not-yet-written output remains progress while active;
real read/path/capability errors retain their feedback, and terminal missing-file
feedback and Refresh recovery remain available.
Explicit history readers opt into `retainHistory`: artifact Details, the Host
conversation's Producer history and authored `execution_log` keep their existing
read-only behavior. `presentation` selects appearance, not log lifetime.
Panel history opens at its first available activity so searches and source reads
can be found; live progress and conversation logs retain tail-following behavior.
System-owned tool activity carries optional semantic label metadata in the read
projection; shared locale resources render it in the current UI language, even
for a reopened native history. Locale changes preserve the reading position.
Native prose and entries without known metadata retain their original message.

DSH artifact history is requested once when its workspace opens or Refresh is
used. It pairs the existing Host execution provenance and delegation results
with the selected project and native session ancestry, using the official
read-only session handle. Later revisions without Workers and Host restarts do
not erase an available association. Missing observations or native logs remain
unavailable. Current execution takes precedence over historical activity; history
does not restore a running state or restart automatic progress. Failed directions
without a report retain their editable plan and can open their real activity in
Details, without fabricating a findings file.

In DSH, accepting an advisory records the real acceptance first, then the host
adapter queues a Yugoo-authored notice through the existing Agent inbox. Its
source metadata carries a summary of the accepted suggestion; its model content
retains the exact finding, acceptance identity and paired action receipts. The browser does
not submit internal authorization instructions as an ordinary user prompt.
The current official DSH Host 0.2.1-rc.3 renders waking messages as a collapsed
Turn trigger with a generic title, not the business summary carried in
`source.summary`. Expanding it reveals the original model context. Showing the
accepted business intent in that header remains an unmet UX goal; the
non-waking context renderer's summary support does not prove this waking path.
Delivery is separate from execution. While the review surface remains mounted,
unconfirmed delivery retains an explicit retry without replacing saved receipts.
Ordinary pending advice needs no status label beside its actions. Special states
show one primary status: Needs review for changed design/review context, Deferred,
or saved acceptance with unconfirmed delivery. When deferred advice also needs
review, shared help beside Needs review retains the deferral fact and explains
the changed context. Details retains the finding,
rationale and source references.

Ordinary navigation, titles and field labels use the semantic typography roles
defined once in `src/visual-components.css`. Components supply the role and state;
their layout rules do not define another font scale. Reading and editing inherit
the same role, including related record cards rendered with a detail frame.
Remove superseded declarations when changing a role. The maintained
[Panel UIUX standard](../../docs/panel-uiux-standard.md#3-字体层级与阅读编辑)
owns the guidance; specialist notation retains its own presentation.

Ordinary record cards edit the shared Panel draft directly. Their title actions
stay visible; the Panel's global Cancel / Save & continue remains the save boundary.
`PanelTextarea` owns multiline sizing across forms: fit actual content from one
line to five automatic lines, then scroll internally. A user's manual resize can
exceed that budget and survives subsequent input and temporary hiding.
Named typed child records reuse the same inline title editor for their declared
text name, with one canonical input and no duplicate name field in the body.
Visibility, readonly, requiredness and dependent-field clearing remain unchanged.

Diagram details place the current process overview and node collection in shared
muted content groups, with base node cards inside the collection. Sidebar selection
reveals the matching card, and folding retains mounted editors and drafts. Names, roles and outgoing
routes still come from the original BPMN model.

Review settings separate saving a policy from running a review. The dialog uses
Cancel / Save, with three discrete scope stops and stable space for their help.
Cancel restores the last saved choice; saving uses the existing direct policy
port. Manual review execution remains with the Host's existing review entry.

The interpreter uses the existing component catalog’s workspace ownership for
both host scrolling and a shared, inset-free layout surface. Full workspaces,
single-child stacks and switches between workspaces pass the allocated height
through this surface. Components own scrolling within their navigation and content
areas; ordinary document content keeps its natural height. Hosts supply the outer
space instead of styling individual component wrappers.

`PanelRecordHeader` shares title layout across record forms and specialized readers.
Its optional `context` briefly orients the reader to the current object's scope,
shown below the title using shared 12px supporting typography. Essential decisions
and constraints remain body content, not captions. Missing context adds no row;
long context wraps and expands the header. Counts and actions remain beside the
title. This does not replace workspace action guidance, field help or error feedback.
`PanelRecordId` places a bound, saved identity before the name using the existing
record-card typography and wrapping. Ordinary record headers opt in with
`form.header.show_id`, reading the section's `create.id_field` or `id`; the
readonly identity can stay hidden in the body. Boards retain their explicit
`board.id_field`; a readonly identity already shown there is omitted from default
details. Editable IDs and explicit detail bindings retain their controls.
Question and artifact workspaces use `question_policy.show_ids`
and `artifacts.show_ids` for their existing record keys. Related tables keep
numbers in the name cell; plans, reports, page previews and canvases keep the
same shared header treatment. Fixed first-round settings retain natural labels.
Missing bindings
or values add no identifier. Diagram process and node headings can supply their
known canonical record keys. Counts remain separate, and same-record detail
projections do not repeat the identity or introduce another save channel.

Trusted native Providers can opt into the bounded
[component-package contract](../../docs/component-package-contract.md) for exact
file/dependency admission and provenance in the existing native registry. This
entry supports native Panel API 1 with Host React 18; it does not extend the DSL
vocabulary or install executable code through content imports.

`PanelSamplePreview` accepts `skill`, `panelYaml` and an original `sample` record.
It defaults to read-only while retaining navigation and disclosure. To edit a
local sample, set `readOnly={false}`; optional `value`/`onChange` let the caller
control that sample. Replacing `sample` resets uncontrolled edits; locale changes
preserve them. This surface never reads project artifacts, accepts attachments,
submits prompts, saves or publishes. Callers own any explicit adoption of edits.
Hosts may supply already confined, bounded synthetic `artifacts` from the same
definition snapshot. The sample reads only those supplied bytes through its
existing sandbox; it has no project or filesystem fallback.
Its component lifetime includes the shared presentation, content-state and graph
foundation styles; it does not rely on a Host having loaded them first.
Source consumers use their existing CSS build pipeline; the standalone
browser entry emits resources through the Panel's ordinary CSS asset routes.

Artifact readers keep refresh in the current record's top toolbar. Shared
Markdown uses a bounded heading scale and paragraph rhythm; user-authored HTML
stays inside its existing sandbox without tool typography injection. Actual
Panel/reading-container widths select the compact 13px density below 560px,
retaining the 12px auxiliary floor and normal input/target sizes. This is CSS
container adaptation, not page zoom or a display-resolution heuristic.

Interactive Page and Scenario previews allow native form validation and local
`submit` handlers. Their opaque sandbox retains host, popup and top-navigation
isolation; `form-action 'none'` and `connect-src 'none'` still block network
submission and connections. Reading-only documents and thumbnails retain their
existing restrictions. A working local form does not write canonical Design Files.

`PreviewWorkspace` and full Page/Scenario `NavigationPreview` readers default to
Fit width for an overview and offer Actual size (100%) in their existing toolbar,
before Refresh. Other existing actions retain their relative order.
Actual size preserves the declared
design width and allows horizontal scrolling in the same reading area; returning
to Fit width restores the left edge. This local reading choice remains available
in read-only mode, retains the preview document and does not change design data
or palette drafts.

Page details show the declared plan fields before an artifact is available.
With a preview, Details and Preview share the same record and global save;
view changes retain the preview document. Landed Worker artifacts remain
readable through the existing execution projection before canonical integration.
With Host file digests, unrelated project files or checkpoints do not remount
the selected prototype or its unchanged shared stylesheet. Its inputs, scroll
and local success state remain in that document. The real incoming edge/context
and target digest govern an arrival; full transaction versions still guard
binding and drag actions. Reader changes, actual artifact/resource changes and
explicit Refresh retain their existing isolation and update behavior. Without
file digests, the existing revision-based freshness checks remain available.
Layout and trigger feedback describes those checks, not interaction acceptance.
It follows the current DOM and layout with coalesced mutation/resize checks,
reporting only changed results. Intentionally hidden conditional branches are
skipped; absent declared bindings and visible zero-size controls still fail.
Observation ends with the preview document's lifetime.

Authored related-record tables reuse the section's original field editors and
canonical map. Every visible field remains declared in a table column; conditional
custom inputs, inherited read-only groups, stable IDs, derived labels and the
usual create/delete/save ports are retained. Optional single-parent header
placement edits the same hierarchy edge. See the [DSL contract](../../docs/dsl-spec.md)
for these authored extensions.

## DSH dock and project navigation

On DSH Web and Desktop, the Yugoo Design toggle (「Yugoo设计」 in Chinese) occupies
the public conversation toolbar utilities slot before the Host's file-open control, independently of
Trajectory tabs. The normal project header has two rows: completion, then project
name with an unobtrusive native folder button. The button uses the existing
Session Remote to open the exact project directory, not a model prompt, shell
command, `file:` URL or path tooltip. Hosts without the native capability do not
advertise the action; opener failure remains retryable without changing design
data. The explicit compact embedded mode retains its single-row layout.

Opening the dock collapses Host navigation and applies the initial 70/30 split.
The user can reopen navigation while Design remains open; reflow clamps the dock
to the available space. Later Design activity only focuses its tab and preserves
the user's layout. Closing restores navigation only if this opening collapsed it
and no later Host or user transition superseded that ownership.

The dock measures the actual resident `conversation.header` element, relative to
the shell overlay's positioning origin. It clears the Desktop menu/caption band
and aligns its project header's bottom rule with the Host conversation header,
including the Host's one-row/two-row header changes. Geometry is observed while
the dock is mounted and discarded when it closes; display-contents wrappers and
the inner title row are not header boxes. No Desktop height is hard-coded. With
an absent/zero-height Host header, top clearance is still derived independently
from the Host frame; a safe two-line height is retained instead of claiming exact
divider alignment where the Host has no visible information bar.

## Save continuation and assessment

The shared `DesignContinuationBar` presents Runtime `user_continue` descriptors
in Host chrome, once per visible workspace. Hosts provide the ordinary native
prompt handler and can disable it with a readable status while edits or delivery
are unresolved. Adjust is rendered only when the Host supplies its native input
focus action, which preserves the draft and restores its caret. It does not
query a particular DOM editor or submit the draft. The DSH adapter reads this
optional service through Cordis `get()`; an unavailable composer hides Adjust
without blocking Continue, Later or the Panel. Later dismisses locally, with an
optional Host callback to retain dismissal across composer visibility changes.
The component neither guesses a Bundle stage nor consumes a Runtime gate.

Saving and assessment are separate stages. A multi-Panel save collects the
actual successful save receipts; a partial save failure does not submit the
final continuation or assessment batch. Once required saves settle, the shared
client queues the ordinary Host prompt with its native submission echo. Only
after successful root-conversation admission does it send the actual save
`eventId`, returned `commit` (when present), and native request id to the existing
workspace Remote for passive receipt validation. That metadata starts no model
job or pending activity and does not delay prompt admission. Before Save returns,
the server injects the meaningful saved checkpoint's exact input and tells the
main Agent to report U/S/T in this continuation before its final reply or next-step
recommendation. Unchanged or replayed saves do not request another assessment.
Explicit regeneration keeps its own intent;
an already-saved Panel does not invent another save receipt.

The workspace's optional `clarity.activity` exposes queued, running, failed,
stale or unavailable assessment state independently of the persisted score
authority. Its compact status remains in the existing two-row project header;
unknown progress has no fabricated percentage. Prior scores are labeled as the
previous assessment while new work is pending or unsuccessful, and an unassessed
project remains unassessed rather than receiving placeholder scores. A saved
design stays saved even if assessment or its metadata handoff fails.

Panel receipt registration creates none of those activity states. Until the main
Agent records a current report, existing currentness checks keep older scores
as the previous assessment. Attached Bundle evaluators retain their own activity.

## Review activity

The Design advisories lightbulb shows the selected project's actual background
review scheduler status independently of the pending-advice count and U/S/T.
Scheduled work is distinct from running work; concurrent profile failures remain
visible while other reviews continue. Completion or cancellation removes the
activity indication, and a disconnected workspace read cannot keep an old
spinner alive. This read-only projection does not start a review or claim model
consumption. Web and Desktop share the same entry, styles and reduced-motion
behavior.

## Verification

After the normal package build, run `node --test test/host-entry.test.mjs`.
The import regression rejects React/ReactDOM and renderer imports even when
development dependencies happen to be installed. It also checks the explicit
UI API and shared pure-function identities. Set `YUGOO_PANEL_PACKAGE_ROOT` to
run the same test against an installed candidate. Source rendering and isolated
browser/store tests cover their own boundaries. Verify native rendering, durable
save/reopen, assessment and main-Agent consumption separately in the installed
host; the import test does not cover these interactions.

# Yugoo Design Panel package

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
design stays saved even if assessment or its metadata handoff fails. Native
rendering, save/reopen, assessment and main-Agent consumption remain
separate installed-host checks.

Panel receipt registration creates none of those activity states. Until the main
Agent records a current report, existing currentness checks keep older scores
as the previous assessment. Attached Bundle evaluators retain their own activity.

The Design advisories lightbulb shows the selected project's actual background
review scheduler status independently of the pending-advice count and U/S/T.
Scheduled work is distinct from running work; concurrent profile failures remain
visible while other reviews continue. Completion or cancellation removes the
activity indication, and a disconnected workspace read cannot keep an old
spinner alive. This read-only projection does not start a review or claim model
consumption. Web and Desktop share the same entry, styles and reduced-motion
behavior; native rendered acceptance remains a separate Host check.

This package supplies the shared Panel runtime for Yugoo Design. Host discovery,
declarative compilation and React rendering have separate entry points:

Artifact readers keep refresh in the current record's top toolbar. Shared
Markdown uses a bounded heading scale and paragraph rhythm; user-authored HTML
stays inside its existing sandbox without tool typography injection. Actual
Panel/reading-container widths select the compact 13px density below 560px,
retaining the 12px auxiliary floor and normal input/target sizes. This is CSS
container adaptation, not page zoom or a display-resolution heuristic.

Authored related-record tables reuse the section's original field editors and
canonical map. Every visible field remains declared in a table column; conditional
custom inputs, inherited read-only groups, stable IDs, derived labels and the
usual create/delete/save ports are retained. Optional single-parent header
placement edits the same hierarchy edge. See the [DSL contract](../../docs/dsl-spec.md)
for these bounded authored extensions. Source rendering, isolated browser/store
checks and installed-host acceptance are separate evidence boundaries.

| Import | Purpose | Runtime requirements |
| --- | --- | --- |
| `dsh-design-panel` | Node plugin `name`/`apply`, DSL compiler and pure state helpers | Node and declared Host/Core dependencies; no React runtime |
| `dsh-design-panel/ui` | Complete component/interpreter library and Node rendering tests | React 18, ReactDOM and the declared renderer dependencies |
| `dsh-design-panel/interpreter` | Browser renderer library | Browser and React 18 |
| `dsh-design-panel/client-api` | Broad shared APIs consumed by trusted browser providers | React 18 and the shared provider/renderer dependency graph |
| `dsh-design-panel/select` | Isolated browser choice control and popup stylesheet | React 18, ReactDOM, Radix Select and Lucide; no workspace/canvas runtime |
| `dsh-design-panel/client` | DSH browser plugin factory | DSH client module loader and its shared platform instances |

Public npm specifiers use the `@yugoo-design/` scope. Development source uses
the unscoped workspace specifiers shown above.

Browser adapters inject `PanelSelect` from the separately built `select` entry
into a neutral control port without loading the Panel/DSL workspace or canvas
dependencies. The broad `client-api` retains compatible re-exports but is not a
control-only bundle entry. `PANEL_SELECT_MENU_CSS` is
the same popup stylesheet used by the control's open Portal, so standalone pages
can include it in their own DOM lifetime. Trigger geometry stays with the owning
scene stylesheet. The popup inherits the trigger's actual theme and remains
inside the nearest open native dialog when present; other menus use the owning
document body.

The DSH Loader row must still name the **package root**. In the installed
DSH 0.2.0-rc.2 client-module discovery contract, a package subpath is not a
substitute for that row. The root's optional HTTP CSS carrier follows the
`webServer` lifecycle. Browser registration of `designNativePanels` and
provider registration retain their existing browser-owned lifecycles.

Previously the package root also statically re-exported the React library.
That made native Node activation depend on renderer peers which the Host can
supply only in the browser. Code importing components or interpreter helpers
from the old root must use `dsh-design-panel/ui`; the existing `lib/index.js`
library and all its exports remain there. This entry includes Node Host APIs
and is **not** a browser bundle; browser callers should use `interpreter` or
`client-api`, or `select` for the isolated choice control. The root retains DSL
parse/validation, record edits, attachment
limits, clarity, navigation, native registry, workspace admission and dock state
APIs. UI-associated advisory, project and continuation helpers remain with
their components in `ui`.

After the normal package build, run `node --test test/host-entry.test.mjs`.
The import regression rejects React/ReactDOM and renderer imports even when
development dependencies happen to be installed. It also checks the explicit
UI API and shared pure-function identities. Set `YUGOO_PANEL_PACKAGE_ROOT` to
run the same test against an installed candidate. This does not prove native
rendering, durable save/reopen or Agent consumption; those require their own
installed-host checks.

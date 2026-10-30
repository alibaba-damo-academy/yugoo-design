# Yugoo Design Panel package

This package supplies the shared Panel runtime for Yugoo Design: declarative
compilation, React rendering, editing controls, and workspace state. Host
discovery, compilation and rendering have separate entry points.

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
scene stylesheet. The popup inherits the trigger's actual theme and remains
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

The interpreter uses the existing component catalog’s workspace ownership for
both host scrolling and a shared, inset-free layout surface. Full workspaces,
single-child stacks and switches between workspaces pass the allocated height
through this surface. Components own scrolling within their navigation and content
areas; ordinary document content keeps its natural height. Hosts supply the outer
space instead of styling individual component wrappers.

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
Its component lifetime includes the existing shared presentation and content-state
styles. Source consumers use their existing CSS build pipeline; the standalone
browser entry emits resources through the Panel's ordinary CSS asset routes.

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
are unresolved. Adjust is rendered only when the Host supplies an actual
composer-focus handler; it preserves the draft. Later dismisses locally, with an
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

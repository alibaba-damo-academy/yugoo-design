# Flow output contract

## Record IDs

For new processes prefer `P-001`, `P-002`, and so on; new independent step supplements prefer `N-001`, `N-002`. Keep the actual `process_ref` and `bpmn_element_ref` mapping, built-in `System`, cast IDs and native BPMN/DI element IDs unchanged.

Existing IDs, including older formats, remain valid during ordinary edits and reconstruction. If the user explicitly requests business renumbering, revise actual record keys/IDs and current references/orders together through their existing owners; keep technical IDs and history unchanged. Names and titles remain readable content, separate from identity.

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Shared by authoring and reconstruction; convert established behavior into BPMN without inventing policy. Canonical state is `flow_design/flow_design.json`; active processes are listed by `process_order`, stakeholders reuse `roles[].name`. The installed schema and validation own the accepted shape; optional node supplements preserve compatibility with existing process-only files.

For product automation, keep exactly one built-in role with stable `id: "System"`
and a non-empty display name in the authored language, for example
`{"id":"System","name":"系统"}` in Chinese or
`{"id":"System","name":"System"}` in English. Role IDs and display names
remain unique. Process stakeholders and BPMN lanes reuse the exact canonical
`roles[].name`; resolve the product's display name by its `System` ID, never by
a translated-name whitelist or lane ID. Check the cast, participating roles and
automated/human task ownership before accepting a file.

Bind serial/delegated activity using `artifact_kind: "flow_bpmn"`, the stable process ID and `artifact_file: "flow_design/<process_id>.bpmn"`. A Worker receives the matching process descriptor, focused evidence and this shared contract; the Producer integrates its returned file reference.

## Process information

The Panel offers the BPMN overview and continuous process/step details. The
process heading and its child steps navigate the same document; selecting a
mapped diagram element locates that step. Existing process-level information
remains readable from the same canonical descriptor:

The overview presents the description, participants and cross-step constraints
at the same level. Participants use short role labels; constraints use readable
list entries. Step details follow within the same process group.

Category and structural pattern share one row in the overview, without an
additional disclosure. Previously recorded events and recovery cases remain
readable below the constraints when nonempty; empty collections do not show
captions or table headers.
These records are not necessarily starting conditions or global failures:
step-local waits and failures belong with their corresponding BPMN element and
step supplement; normal return/retry cycles are ordinary flow behavior.

System responsibility and capability summaries remain in saved process data and
retain their existing authoring/validation meaning, but are not repeated in the
Panel. Read system responsibilities through the actual actors and step behavior;
use Function Modules for the independent capability inventory. This presentation
change does not remove source facts, migrate old entries or alter generation and
validation requirements.

| Field | Purpose |
| --- | --- |
| `tier` | The process's role in the product: `core`, supporting `business`, or `auxiliary`. It supports review order, not a High/Medium/Low delivery priority. |
| `process_type` | The established structural pattern: `linear`, `approval`, `parallel`, or `event_driven`. `approval` describes a human confirmation/approval gate in this product flow; it is neither the current status nor the user's approval of the design. |
| `stakeholders` | The exact participating names from the canonical role cast, also used by BPMN lanes. |
| `system_responsibilities` | What the product validates, stores, decides, sends or waits for, as distinct from human work. |
| `trigger_hints` | Established asynchronous/event-waiting conditions and their expected outcomes; absent triggers need no entries. |
| `key_features` | Distinctive capabilities a reader needs to recognize in this process. |
| `business_rules` | Concrete conditions and outcomes governing its branches and actions. |
| `exception_handling` | Evidenced exception/response pairs needed to understand recovery. |

These fields describe the current process; they are not additional user
questions or a reason to add steps. Preserve existing values when changing
presentation or revising an unrelated path.

## Step supplements

Optional `nodes` is a map of stable supplement IDs, with optional `node_order`
for reading order. Each node has string `process_ref` (the process map key) and
`bpmn_element_ref` (the exact element ID in that process's accepted BPMN).
Reuse existing supplement IDs. For a new supplement prefer an `N-001`-style
business ID; the explicit process/element pair remains the mapping authority. The order
is reading order, never execution order or a substitute for BPMN connections.

The BPMN owns element names, types, lane/actor membership, conditions and
outgoing branches. The Panel reads those as context; do not duplicate them as
editable `title`, `role`, `node_kind`, `next`, or edge arrays in JSON. Preserve
unknown existing fields rather than silently cleaning user data. A supplement
adds only business detail the diagram's short label does not communicate:

| Optional string | Purpose |
| --- | --- |
| `activity` | What happens in this step, beyond the short diagram label. |
| `entry_condition` | A meaningful condition that must hold before the action; omit when ordinary incoming flow already explains it. |
| `exit_condition` | An observable completion result or changed business state. |
| `failure_response` | A material local failure and its established response; actual alternate routing stays in BPMN. |
| `remarks` | Supplementary context, source explanation, rationale, or an explicitly unresolved point. Optional; never invent content to fill it. |

These facts are supplied or corrected from the user's intent and saved evidence
by the Flow owner. They support checking a step's behavior and observable result;
they are not a request to re-enter diagram-derived names or fill every input.
Add details for meaningful business/system steps and consequential decisions.
Start/end markers or self-explanatory steps do not need identical forms.
Keep constraints spanning steps at process level; do not distribute old parent
strings into arbitrary nodes or remove the originals. Function capability
descriptions are context, not a second independent feature inventory here.

Example supplement (synthetic; it describes an existing BPMN task):

```json
{
  "nodes": {
    "review-request": {
      "process_ref": "P-001",
      "bpmn_element_ref": "UserTask_P-001_2",
      "activity": "Review the submitted request and record the decision.",
      "entry_condition": "The request has been submitted.",
      "exit_condition": "The decision and explanation are saved.",
      "remarks": "Example only; use the actual saved policy."
    }
  },
  "node_order": ["review-request"]
}
```

When a node/role/branch name changes, edit the same BPMN authority and retain
its ID. If a saved supplement's process or element is missing, keep its ID,
text and source references visible as unmapped content. Repair its exact mapping
from evidence or remove it only when the user's revision authorizes removal.
Never reconnect by label similarity or drop supplements on navigation/save.
Two supplements mapping to the same existing element are ambiguous; merge them
without losing user text or repair the mistaken reference. Do not generate a
second graph to make a missing binding appear valid.

### Existing projects

Absent `nodes`/`node_order` remains valid. The optional step-detail notice asks
the current Native Agent to supplement this Flow, without blocking reading,
editing or saving the existing diagram. Use the project's actual current Flow
definition. Updating that definition is an ordinary, explicitly requested edit
of this Bundle's files in `design_kit`; a library save alone does not update it.
Do not add a version gate or migrate the whole Kit. Read the existing Flow JSON
and BPMN, add grounded step supplements, and preserve old parent content,
unmapped supplements, unaffected processes and all other Bundles. Correct an
affected diagram only when the requested behavior requires it. Existing
geometry/IDs are not regenerated merely to add narrative detail.

## Structure and file operations

Use the pinned `reference/bpmn_authoring.md` resource for every new or revised
diagram. Never place XML inside JSON. The file path remains
`flow_design/{process_id}.bpmn`. A future path is not an artifact: a new process
has `bpmn_file: null`; a revision clears only the affected stale reference until
its revised file passes final validation.

Choose the route from the file's actual state:

- **New diagram:** write one coherent structure-only XML candidate, validate
  its structure, run layout, then validate the final file using the calls below.
- **Existing diagram:** read the affected semantic paths and make targeted
  edits in that file. Preserve IDs of retained roles/lanes, nodes and flows;
  deleting a role does not renumber the remaining lanes or assign its old ID
  to a different role. New entities get new IDs; removed or replaced entities
  require reference repair. Retain existing DI for changes that leave geometry
  valid and run the final validator directly. If topology, lane membership or
  readable label geometry changes, run layout on the revised file, then final
  validation. Do not send a laid-out file to the structure-only validator or
  rebuild it from scratch just to satisfy the new-diagram route.

Read relevant excerpts to edit or review semantics, but do not resend complete
XML through model tool arguments merely to acknowledge a file or run scripts.

For a new structure-only candidate, validate with `run_skill_script`: use `path: "bpmn-validator.mjs"`,
`args: ["validate-bpmn-file"]`, `input_file` equal to the pre-bound BPMN path,
and `input_context` containing
`{"process_id":"P-...","process":{...},"roles":[...]}`. `roles` is the existing
canonical role cast, not a new process field. The bounded `process` object is the
matching canonical descriptor; it needs the supplied stakeholders,
system_responsibilities, trigger_hints, and process_type. The validator returns
validity and diagnostics, plus mapping information when nodes are supplied.
Repair the same file and retry until it passes.
Older calls without `roles` retain the original Chinese system-lane semantics;
always include the canonical cast for new or revised localized files.

Also pass the current `nodes` map as optional `input_context.nodes` when step
supplements exist. The file validator checks unambiguous exact mappings for
that process and returns `unmapped_nodes` for retained elements missing from
the diagram. A retained orphan is not a reason to delete user content or block
ordinary Panel save; report and repair it within the requested scope.

When layout is needed, call `run_skill_script` with `path: "layout.mjs"`, the same `input_file`, no
args, and `output_file` equal to that same BPMN path. On exit 0 the Host writes the
layout output directly back to that file and returns a compact write receipt;
the XML never enters the model context. For every new or revised file, run `bpmn-validator.mjs` with
`args: ["validate-final-bpmn-file"]`, the same `input_file`, and the same
`input_context`. This final validator checks both structure and layout, accepting
existing DI. Repair the reported defect and repeat the applicable route;
structural or semantic corrections are not reasons to discard stable identities.
Never hand-author BPMN DI or repair a truncated layout result. Only after final
validation succeeds does the Producer set the canonical `bpmn_file` reference.
Script execution never publishes Design Files. 

## Semantic integration

A successful file receipt and validator establish artifact identity and format,
not agreement with the user's requirements. Before accepting an authored or
delegated file, the Producer follows its relevant task/branch/handoff paths and
compares them with the current request and authoritative source constraints.
Check who performs an action, under what condition, and who receives its outcome;
a prose description of a handoff does not create the missing diagram path.
Preserve established limits even when a related implementation choice remains
undecided. Correct every known mismatch in the affected owned processes before
publication; do not rely on a later review to repair it. An unresolved upstream
decision stays an explicit gap rather than an invented behavior or a change to
another Bundle. No full XML echo or second evidence artifact is needed.

Read [reference/bpmn_authoring.md](bpmn_authoring.md) for exact structure, lane grammar, node semantics, events and a complete example. Supplied rules, triggers and roles are facts to represent, not a checklist to fill with invented behavior. Required format does not establish missing source facts.

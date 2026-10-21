# Flow output contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Shared by authoring and reconstruction; convert established behavior into BPMN without inventing policy. Canonical state is `flow_design/flow_design.json`; active processes are listed by `process_order`, stakeholders reuse `roles[].name`. The installed schema/validation are unchanged.

For product automation, the existing built-in role is
`{"id":"System","name":"系统"}`. `System` is its ID, not its stakeholder or
lane label: process stakeholders and BPMN lanes use the exact name `系统`.
Check this in the canonical plan as well as the XML before accepting a file.

Bind serial/delegated activity using `artifact_kind: "flow_bpmn"`, the stable process ID and `artifact_file: "flow_design/<process_id>.bpmn"`. A Worker receives the matching process descriptor, focused evidence and this shared contract; the Producer integrates its returned file reference.

## Structure and file operations

Use the pinned `reference/bpmn_authoring.md` resource for every new or revised
diagram. In the initial plan for a new process, set `bpmn_file: null`; a future
path is not an artifact. Never place XML inside JSON. Write structure-only XML
once to the pre-bound `flow_design/{process_id}.bpmn` path, while its canonical
ref remains null. From then on, do not read and resend the complete XML through
model tool arguments.

Validate the file with `run_skill_script`: use `path: "bpmn-validator.mjs"`,
`args: ["validate-bpmn-file"]`, `input_file` equal to the pre-bound BPMN path,
and `input_context` containing
`{"process_id":"P-...","process":{...}}`. The bounded `process` object is the
matching canonical descriptor; it needs the supplied stakeholders,
system_responsibilities, trigger_hints, and process_type. The validator returns
only validity and diagnostics. Repair the same file and retry until it passes.

Next call `run_skill_script` with `path: "layout.mjs"`, the same `input_file`, no
args, and `output_file` equal to that same BPMN path. On exit 0 the Host writes the
layout output directly back to that file and returns a compact write receipt;
the XML never enters the model context. Finally run `bpmn-validator.mjs` with
`args: ["validate-final-bpmn-file"]`, the same `input_file`, and the same
`input_context`. Repair and repeat the file pipeline if it reports diagnostics.
Never hand-author BPMN DI or repair a truncated layout result. Only after final
validation succeeds does the Producer set the canonical `bpmn_file` reference.
Script execution never publishes Design Files. 


Read [reference/bpmn_authoring.md](bpmn_authoring.md) for exact structure, lane grammar, node semantics, events and a complete example. Supplied rules, triggers and roles are facts to represent, not a checklist to fill with invented behavior. Required format does not establish missing source facts.

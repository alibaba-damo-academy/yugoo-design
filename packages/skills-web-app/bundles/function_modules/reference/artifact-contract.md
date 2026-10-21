# function_modules output contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Source-to-capability judgment

For new design, derive candidate capabilities from established user outcomes;
a source product is evidence or inspiration, not automatic approval to copy its
scope. For reconstruction, trace a visible entry through its reachable behavior
and outcome before naming the capability. A folder, route, dependency, disabled
control or mock alone does not establish that the product offers that behavior.
Group by user purpose, not the source tree. Preserve evidenced administrative
capabilities when administration is part of the actual product.

Keep intended, implemented and runtime-observed behavior distinct. Record
material source locations and limits in existing explanatory text or the handoff;
do not put external repository paths into Design File pinned references.
For a revision, reconcile source findings with saved user decisions, rejected
cards and local details rather than replacing the map with a fresh inventory.
Missing source coverage is an uncertainty, not proof that a capability is absent.
Do not invent features to complete a journey or erase established features to
make the map smaller; report the concrete gap within the requested scope.

Shared by ordinary design and reconstruction. Canonical state is
`function_modules/function_modules.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

Functions express user-visible capabilities at a coherent granularity, not a directory inventory. Preserve evidenced scope; do not remove a real product capability because a template example omits it. Product-facing administration can be a capability; internal deployment work alone is not.

## Output contract

Persist only the declared function fields below. Functions are the entities;
`function_epic` is a grouping label. Optional details enrich that function, not
a second story collection. Rejected functions remain in rejected/full views.

### Purpose

Produce a concise, user-facing function map. A function is the only persisted
entity. `function_epic` is merely its grouping label; the panel groups
functions by that label when it renders.

### Usage

Maintain the function map as complete state JSON, preserving unaffected fields.
Run `design_validate({outcome:"complete"})`, repair named state defects, and
publish through `design_publish({action:"complete"})`. The panel renders from
the published Design File. Panel saves already persist the user's card edits;
do not repeat them.

### Data contract

Keep the existing overview shape. The current contract uses a single usage scenario;
do not send it to a differently pinned validator or rewrite its retained state.

```json
{
  "functions": {
    "F-001": {
      "function_id": "F-001",
      "function_name": "记账录入",
      "function_description": "记录收入、支出及其分类。",
      "function_epic": "账本管理",
      "priority": "High",
      "rejected": false,
      "source": "ai",
      "reason": "家庭账本的核心使用动作"
    }
  }
}
```

- `function_id`, `function_name`, `function_description`, `function_epic`
  are required for every function. `priority` is optional (panel default Medium).
- `rejected` means the user rejected the function. It remains visible in the
  rejected filter and may be restored. It is not deletion.
- `source` identifies the card's origin. Optional `reason`, shown as Notes, can
  contain the proposal's basis, design rationale, tradeoffs, supplementary context
  and unresolved points. It does not establish user approval.
- Never persist Epic as a separate entity or duplicate function membership in
  additional lists.

### Optional local specification

`details` is a closed object with one optional `situation` string (Usage scenario),
plus optional `behaviors`, `inputs`, `outputs`, `limits`, `exceptions` maps.
The first four maps have stable keys and closed values `{ "description": "..." }`.
Exceptions have closed values `{ "condition": "...", "response": "..." }`.
Their required fields apply only to existing entries; no dimension is required.
Do not add approval, completeness, formal story, or per-field status metadata.
Stable map keys are identities, not names or ordering positions; preserve them
when editing. Card description remains a short capability overview. The usage
scenario explains who uses it, under which circumstances and for what outcome;
it combines the former purpose and situation. Notes supplement the design, not
replace core behaviors, inputs, outcomes, boundaries or exception handling.
The Panel displays fixed optional inputs, directly editable without a read/edit
switch or dimension add/delete. Empty/absent dimensions remain legitimate;
collection item add/delete still operates on stable keys.

Example added to an existing function (hypothetical, not user evidence):

```json
{
  "details": {
    "situation": "用户整理综述中的论点时，查看已保存的材料及原文，判断依据是否充分。",
    "behaviors": { "B-001": { "description": "选择论点后查看已关联的文献摘录和笔记。" } },
    "inputs": { "I-001": { "description": "用户选中的论点和已有材料关联。" } },
    "outputs": { "O-001": { "description": "依据及原文位置，没有依据则明确告知。" } },
    "limits": { "L-001": { "description": "不把 AI 推测当作原文已支持论点的证明。" } },
    "exceptions": { "E-001": { "condition": "关联原文不可读取。", "response": "保留来源标识，告知暂不可读，不虚构摘录。" } }
  }
}
```

The local usage scenario is not a second product background authority. Local conditions,
limits and failure responses are permitted even if testable; shared rules,
cross-function flows, common data/access definitions and formal acceptance
retain their existing owning Bundles. Refer to them only when actually present.
Do not force those Bundles to run just to explain known local behavior.

### Optional pinned sources

`references` is a stable-key map. Each closed record has required `file` and
`revision`, optional `pointer`, `note`, and `subject_pointer` strings. No other
fields exist. `file` is confined relative to this project's Design Files, never
an absolute path, traversal, host transcript, or `.git` path. `revision` is a
real full project commit hash (40 or 64 lowercase hexadecimal characters),
not HEAD or a placeholder. `pointer` is an RFC 6901 JSON Pointer; omit it for a
whole-file source. JSON Pointer is only valid for a JSON file. `note` explains
why the source matters, not a copy of its content or evidence of confirmation.

`subject_pointer` optionally locates a detail in the current owning function,
for example `/details/behaviors/B-001`. It must exist there, not in the target
file, and must not traverse an array position. Omit it to refer from the whole
function. A map source pointer keeps identity through display renaming; an
array-element pointer remains historical evidence only in this version, even
if the array contains ID fields. Do not guess current identity from an index.

Unsafe formats or missing local subjects fail mechanical validation. A valid
source's history or current target may later become unavailable; preserve the
reference and report unreadability/deletion, never invent an endpoint. The
source browser must distinguish the pinned evidence from a later edited source;
old content is not stronger than a later explicit user decision. References
provide location, not causal/support semantics or automatic confirmation.

Preserve all optional detail and source fields during overview editing, panel
save, complete-state publication, and reconstruction. Source is not approval;
`source: ai`/`user` and nonempty content do not introduce a confirmation state.
Overview-only cards need no empty templates or changed IDs. Viewing never
converts retained state. During internal development, manifest versions stay
at 1.0; that label does not mean an edited schema accepts every earlier shape.
Adopting changed definitions must explicitly validate existing data against the
actual loaded contract. Convert split fields before saving under this contract;
do not assume selecting the Mindset alone transforms old data. Preserve retained
snapshots and historical evidence rather than overwriting them to force a refresh.

### Explicit conversion of split purpose/situation

Only for an authorized conversion from the split-field contract,
`scripts/merge-usage-scenario.mjs` accepts
the complete old state as JSON on stdin and emits a transformed copy on stdout.
It is a Bundle resource, not a Core migration hook or an automatic Panel load
operation. Invoke it through the existing confined script capability when
available; the executor then validates and publishes the returned state through
its normal WorkingCopy. A script receipt alone is not a saved migration.

The converter joins both original strings verbatim with a blank line, removes
`details.purpose`, and keeps the existing `details.situation` when purpose is
absent. It does not invent a scenario for an empty card. Local reference
`subject_pointer: /details/purpose` moves to the present `/details/situation`;
stable keys, other content, file/revision and source `pointer` remain unchanged.
Pinned source pointers describe historical evidence and must not be rewritten.
Invalid split values fail rather than being stringified or silently dropped.
After conversion, use the target schema and source-location validation, check
the complete diff, and settle the explicit project upgrade using the existing
project flow. Never retarget another active project or edit its history.

### Quality rules

- Make the function set complete, non-overlapping, and at a consistent level
  of granularity.
- Every active function needs a clear, user-facing description and one Epic
  label.
- Keep active function names unique.
- Do not turn internal deployment or infrastructure work into product functions.
  If managing deployments or servers is the actual user-facing product capability,
  retain it; judge the product boundary, not the technical vocabulary.

### Example

```text
// the function_modules state JSON you output:
{
  "functions": {
    "F-001": {"function_id": "F-001", "function_name": "记账录入", "function_description": "记录收入、支出及其分类。", "function_epic": "账本管理", "priority": "High", "rejected": false, "source": "ai", "reason": "核心记账动作"},
    "F-002": {"function_id": "F-002", "function_name": "账目浏览", "function_description": "按日期和分类查看历史账目。", "function_epic": "账本管理", "priority": "High", "rejected": false, "source": "ai", "reason": "用于回顾收支"}
  }
}
```

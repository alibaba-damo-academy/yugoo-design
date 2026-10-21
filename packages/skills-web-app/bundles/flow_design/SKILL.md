---
name: flow_design
description: |-
  - **Capability**: product-process design — BPMN per material process with human/system responsibility, triggers, handoffs, and outcomes.
  - **Resolves**: S/T gaps by making established actors, product automation, ordered states, branches, triggers, and observable outcomes inspectable.
  - **Candidate when**: roles, approvals, handoffs, exceptions, or an explicitly material journey need an agreed process contract.
  - **Do not infer**: ordinary clicks or a vague product idea do not justify inventing actors, policy branches, or a BPMN diagram.
  - **Output**: `flow_design` panel — one BPMN per material product process; every diagram exposes what the system actually does.
---

# Business Flows

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Ownership and tools

The foreground Producer owns the complete flow result: process metadata in the
canonical JSON and one canonical `flow_design/{process_id}.bpmn` file per active
process. It may author and repair every file serially. When two or more process
diagrams are independent and `design_delegate_frontier` is available, submit the
complete ordered frontier with a `batch_id` and full `items` after persisting
the plan. Each item uses the artifact arguments below. A changed frontier needs
a new batch ID. Use `design_delegate` for one process or as a compatibility
fallback, dispatching independent sibling calls together. It may keep genuinely dependent diagrams serial or take
over any process when delegation is unavailable or a Worker fails. Delegation
is optional acceleration, never completion authority; there is no required
Worker count or fixed process order. A delegated Worker writes only its exact
pre-bound BPMN artifact and never canonical JSON. That Worker runs
`scripts/bpmn-validator.mjs validate-bpmn-file`, `scripts/layout.mjs`, and
`scripts/bpmn-validator.mjs validate-final-bpmn-file` against that file, consumes their diagnostics, and
repairs its own file before finishing. The Producer consumes the successful
file receipt without reading or resending the complete BPMN and writes the matching canonical state
into its current WorkingCopy. The Producer remains responsible for complete-
Bundle integration validation, repair, and the single terminal publication.
Each delegated call passes `artifact_kind: "flow_bpmn"`, `artifact_id` equal
to the stable process ID, `artifact_file` equal to the exact BPMN path, and a
complete `prompt` containing the bounded process contract, relevant evidence,
the BPMN authoring resource instructions, and the validation/layout loop.
These explicit call arguments bind runtime status and panel logs; no task
declaration or domain validator belongs in `skill.yaml`. Before serially
authoring or taking over one BPMN, call `design_focus_artifact` with that same
kind, ID, and file.

Resolve common actor names, object states, rule conditions and process handoffs
once before delegation. Give each Worker its complete process descriptor, the
relevant role cast and evidence excerpts with source locators, plus neighboring
handoff conditions. Do not require blanket rereads of every upstream Bundle.
Workers read material gaps as needed and report shared contradictions. A
targeted KAG lookup may locate such dependencies; actual source records remain
the authority. Apply the same method when the main Agent executes this Bundle.

The Producer first uses project-scoped `list` and `read` to inspect
`flow_design/flow_design.json`, every active BPMN ref, and relevant upstream
evidence. It uses `write` or `edit` to maintain canonical JSON and owned BPMN
files. It writes the canonical JSON plan before authoring BPMN so file polling
immediately exposes the complete process plan. The active author (Worker, or
Producer during serial authoring/takeover) lays out and validates each BPMN in
place. As each file receipt settles, the Producer updates only that process in
canonical JSON; the panel sees each filesystem change without an intermediate
commit.
After completion validation, call `design_publish({action:"complete"})` once.

New processes keep `bpmn_file: null` until a validated BPMN is accepted, then
carry that durable direct reference. Do not author transient queued/working
state: the Host records Producer and Worker attempts and the Panel polls those
native events.

Read [reference/artifact-contract.md](reference/artifact-contract.md) before serial or delegated BPMN authoring. It links the BPMN structure contract and defines the shared in-place validation/layout pipeline. Give every Worker that same entry; script execution never publishes files.

Each process captures an end-to-end product scenario: who is involved, what the
product validates, stores, decides, sends, or waits for, in what order, and with
which decisions, grounded triggers, and exception paths. A purely external
human procedure with no product responsibility is context, not a process
artifact. One process = one BPMN 2.0 XML file.

## Maintaining existing design

The saved `flow_design` state is the authority for the current process contract
and its BPMN files. A later request changes the affected process; it does not
start a separate refinement invocation. When you re-run this skill to revise,
output the **full** updated plan, preserving unaffected process IDs, order,
roles, approved rules, and `bpmn_file` refs. Change only the affected process.
When nodes, branches, roles, system responsibilities, trigger hints, process
type, step order, membership, diagram-visible title, timer, rule, or exception
change, edit only that process's canonical BPMN file. Clear `bpmn_file` while
the accepted diagram is stale, and restore the same stable ref only after the
validated revised BPMN exists. Pure prose metadata that is not represented in the
diagram may preserve the existing completed BPMN. Never regenerate unrelated diagrams to revise one flow.
When the user explicitly requests replacement of all diagrams, rewrite each
active canonical BPMN file; ordinary reruns preserve unchanged files and refs.

## When to use

Use this skill when multi-role work, approval, handoff, exception handling, or an explicitly ordered user journey is a material design decision. Function cards alone are insufficient when their dependencies or outcomes must be made explicit.

## Close-out evidence

Close only after the required BPMN artifacts and confirmed process rules are persisted. These processes primarily add S and T evidence because roles, sequence, branches, and outcomes become inspectable and testable. U may improve only when drawing the process resolves a previously unclear business rule. Report the persisted evidence behind those changes; process count alone adds no clarity.

### Typical evidence guidance

- Persisted actors, ordered steps, branches, handoffs and observable outcomes can provide S/T evidence under the shared rubric; explain what is clear or still inconsistent in the current design, without a fixed increment.
- Resolving a previously unclear actor, rule or business boundary can also provide U evidence; the direction and size of any score change follow the saved facts and current agreed scope.
- A metadata-only plan without BPMN, missing branches/outcomes, or a diagram that reveals unresolved policy questions may leave scores unchanged or lower them.

## Output contract

Process metadata and one BPMN artifact per process land in the `flow_design` panel. The generated BPMN exposes lanes, decisions, exception paths, and observable outcomes where they apply.

### Pre-Design Context (Read Prior Skill State Before Designing)

Before proposing processes, inspect the `<persisted_design_state_doc>` for output from previously-completed skills. Use them to ground the flow:

| Prior skill | What to extract | How it shapes flow design |
|---|---|---|
| `smart_questions` (answered) | const_auth_mode, const_storage_mode, and any domain/workflow-related dynamic answers | Auth mode determines whether there's a "注册登录" process; storage mode influences whether persistence-related processes exist; domain answers identify stakeholder roles and business scope |
| `research` (confirmed + findings) | Competitor workflows, industry-standard process patterns, domain conventions | Reuse established patterns (e.g. "通用审批链路: 提交→审核→归档") rather than reinventing; cite research-derived conventions in business_rules when relevant |
| `function_modules` (confirmed) | active function cards: `function_name`, `function_description`, `function_epic`, `priority`, and `rejected` | Start from active capabilities and their stated priorities. Derive roles only from the user, answered questions, or confirmed flows; a function card does not itself prove a stakeholder list. |

If NONE of these prior skills have run (e.g. very first turn, or triage routed directly to flow_design), fall back to the user's raw requirement. In that case infer stakeholders and process scope directly from chat text, but stay conservative (don't invent roles or steps the user didn't imply).

**Hard rule**: don't re-derive information that `smart_questions` already captured. If `const_auth_mode=anonymous`, DON'T design a "账号注册" process. If the evidence establishes an unnamed end user, use `用户`; add `管理员` or another actor only when an established responsibility requires it. Generic titles do not make invented roles grounded.

### Heavy content lives in files (lazy artifact reference)

BPMN XML is LONG and never appears in your plan output. The process's
`bpmn_file` stores the accepted path; the panel fetches XML only for the
selected process.

- Project path: `flow_design/{process_id}.bpmn` holds the XML.
- State: `processes[process_id].bpmn_file` carries the relative ref (e.g. `flow_design/P-001.bpmn`).

### Data Format

This is the canonical state. The Producer writes the matching BPMN file beside it.

```json
{
  "topic": "审批流程设计",
  "epoch": 0,
  "roles": [{"id": "Employee", "name": "员工"}, {"id": "Manager", "name": "直属领导"}, {"id": "System", "name": "系统"}],
  "processes": {
    "P-001": {
      "process_id": "P-001",
      "title": "请假审批",
      "description": "员工提交请假申请，直属领导审批，超过3天的申请加签上级。",
      "tier": "core",
      "process_type": "approval",
      "stakeholders": ["员工", "直属领导", "系统"],
      "system_responsibilities": ["保存请假申请并驱动审批状态", "向员工发送审批结果"],
      "trigger_hints": [
        {"kind": "timer", "trigger": "直属领导24小时未处理", "expected_outcome": "系统提醒直属领导"}
      ],
      "key_features": ["分级审批", "时长门槛", "驳回可修改重提"],
      "business_rules": [
        "请假天数≤3天时，直属领导审批即可通过",
        "请假天数>3天时，需要加签上级领导",
        "驳回后员工可在24小时内修改重新提交"
      ],
      "exception_handling": [
        {"scenario": "审批人休假", "handling": "系统自动转交给备份审批人"},
        {"scenario": "员工撤回申请", "handling": "流程终止，通知所有已审批节点"}
      ],
      "deleted": false,
      "bpmn_file": "flow_design/P-001.bpmn"
    }
  },
  "process_order": ["P-001"]
}
```

The completed-state example above includes a settled artifact reference. A new
plan must instead use `bpmn_file: null` until the Producer has written the BPMN
in its invocation-local workspace. Do not place XML in state. The Producer's
validated publication atomically persists both.

### Process Categorization (Priority Tiers)

Classify each process into one of three tiers. This supports review ordering (core first, auxiliary last) and helps the user identify which processes matter most.

| Tier | What it is | Typical examples | `tier` field value |
|---|---|---|---|
| **core** | User-facing flows that deliver the product's primary value — the reason this application exists | Sales pipeline stage progression, order fulfillment, the approval chain a product is built around | `"core"` |
| **business** | Supporting business workflows — routine operations that back the core flows | Contract creation + approval, customer onboarding, billing reconciliation | `"business"` |
| **auxiliary** | System / administrative flows — notifications, logging, housekeeping, exports | 系统消息通知, 异常告警, 日志归档, data export jobs | `"auxiliary"` |

**⚠️ TWO SEPARATE DIMENSIONS — do NOT confuse them:**

| Dimension | Field name | Allowed values | What it describes |
|---|---|---|---|
| **Business value** | `tier` | `"core"` / `"business"` / `"auxiliary"` | How important the process is to the product's core value |
| **Flow shape** | `process_type` | `"linear"` / `"approval"` / `"parallel"` / `"event_driven"` | The dominant structural pattern (sequential / approval / concurrent branches / event race) |

Both fields are independent. A `core` process can be `linear` (simple checkout) or `approval` (purchase order). A `business` process can be `parallel` (concurrent onboarding tasks). Choose each field based on its own dimension.

Guidelines:
- A selected flow-design round needs at least one material process. If no process can be named from established evidence, do not invent one; return to the current U-gap decision instead.
- Don't over-inflate `core`: typical distribution is 1–3 core, 2–5 business, 0–3 auxiliary.
- `auxiliary` processes are often OPTIONAL — skip them when the user's requirement doesn't mention them (don't pad the flow count).

### BPMN authoring reference

`reference/bpmn_authoring.md` is the single authoritative contract for BPMN
structure: the exact lane-reference grammar, IDs, output boundary, minimal
complete example, anti-example, and self-check. The Producer reads this pinned
resource for serial authoring. A delegated BPMN Worker receives the same
resource with its bounded assignment. The active author runs the Bundle's
file validation/layout pipeline; the Producer integrates the validated file
receipt and checks cross-process consistency before publication.

### Workflow: plan → author and integrate → close-out

The plan and its BPMN authoring happen in one foreground Producer run — no extra
confirmation and no detached background generation. Write the metadata plan
with pending records; never claim it is complete
before the BPMN artifacts settle.

1. **PLAN.** FIRST decide the product-wide role cast. It includes the built-in
   `{"id":"System","name":"系统"}` role whenever the product has an active
   responsibility in the process. THEN maintain ALL process
   descriptors in ONE complete canonical state. The
   cast is decided once so every process + BPMN lane reuses the SAME names
   (no 主管/审批主管 drift). `process.stakeholders` MUST be drawn from
   `roles[].name`. NO BPMN XML in the plan.

   ```json
   {
     "topic": "采购审批流程",
     "roles": [{"id": "Buyer", "name": "采购员"}, {"id": "Manager", "name": "审批主管"}, {"id": "System", "name": "系统"}],
     "processes": {
       "P-001": {"process_id": "P-001", "title": "采购审批", "description": "采购员提交采购申请，审批主管决定是否批准。",
                 "stakeholders": ["采购员", "审批主管", "系统"],
                 "system_responsibilities": ["保存申请并驱动审批状态"], "trigger_hints": [],
                 "business_rules": ["审批通过后申请进入待采购状态"],
                 "exception_handling": [{"scenario": "审批超时", "handling": "系统提醒审批主管"}],
                 "bpmn_file": null}
     },
     "process_order": ["P-001"]
   }
   ```

   Write this complete canonical JSON with empty/null BPMN refs for new work.
   For revisions, clear the ref on each process whose diagram must change. Then
   finish that file write before BPMN authoring starts. File polling makes the
   unresolved artifact reference visible immediately.

2. **AUTHOR AND INTEGRATE.** The Producer may author every process BPMN serially
   itself. When delegation would materially help, it dispatches independent
   processes in one `design_delegate_frontier` call when available (otherwise
   sibling `design_delegate` calls), and supplies
   `reference/bpmn_authoring.md`, the exact `artifact_file`, and one bounded
   process assignment to a Worker. The Worker writes and repairs one
   BPMN at that path, runs `scripts/bpmn-validator.mjs validate-bpmn-file`,
   `scripts/layout.mjs` in file-transform mode, and
   `scripts/bpmn-validator.mjs validate-final-bpmn-file`, and
   repairs failures in the same Worker loop. The Producer consumes the final
   file receipt without re-reading the BPMN and updates only that process's
   `bpmn_file` reference. Serially
   authored processes follow the same script and file path. Preserve every
   unaffected process.

3. **VALIDATE, PUBLISH, AND CLOSE.** Review the complete WorkingCopy for role
   drift, duplicate processes, broken hand-offs, and missing core coverage.
   Every referenced BPMN must already have passed the per-file final validator;
   do not assemble or resend a complete UTF-8 artifact map through the model.
   Run `design_validate`, repair any canonical-state diagnostic, then call
   `design_publish({action:"complete"})`.
   After all processes are
   published, report the persisted
   evidence that the completed flows add across U/S/T, plus any grounded next
   choices. If some processes cannot be completed, report the affected ones and
   why instead of recording an optimistic score.

After the canonical writes settle and before closing, inspect the refreshed
Design projection once. Compare the persisted processes with
available `smart_questions`, `research`, and `function_modules` evidence. Repair
at most one deterministic mismatch owned by `flow_design` with one focused
follow-up run; report a missing, malformed, or unresolved upstream decision as
a non-blocking evidence gap rather than editing another Bundle or inventing
policy. G/R/A owns ongoing cross-Bundle drift detection after this check.

**Process ordering**: default `core` → `business` → `auxiliary` (by `tier`). Switch to role-grouped only when the requirement is strongly role-organized; switch to complexity-progressive only when >6 processes are expected.

**Hard constraints**:
- The plan must carry COMPLETE descriptors (description, stakeholders,
  system_responsibilities, trigger_hints, business_rules, exception_handling)
  — BPMN is authored only from this established state and the role cast.
- Every active process includes `系统` and at least one concrete
  `system_responsibilities` item. If the product has no responsibility in the
  procedure, omit that procedure rather than drawing human-only choreography.
- `trigger_hints` records only established asynchronous or event-waiting
  timer/message/error/conditional/signal facts. A state change produced by the
  immediately preceding task (for example, “status becomes closed, then
  archive it”) is not a conditional trigger: keep the condition in
  `business_rules` and express the outcome with the responsible activity and
  normal sequence/gateway flow. Do not add decorative events; do not flatten a
  genuine external, delayed, or independently observed trigger into a generic
  task.
- When two named roles can perform exactly the same action with no distinct
  responsibility, prefer one established shared role (for example, `评审者`)
  during plan authoring. Keep separate roles and lanes only when the product
  must expose their different responsibilities; then model the assignment or
  hand-off explicitly instead of cloning an entire process without semantic
  difference.
- Decide `roles` (the cast) up front; every `stakeholders` value and BPMN lane name must reuse those exact names — a lane named outside the cast is rejected. One 词表 for all.
- Before publication, review the complete current WorkingCopy for cross-process consistency (role drift / duplicate processes / broken hand-offs / missing core coverage). Classify findings as:
  - **wording-only fixes**: clarify metadata without changing diagram-visible meaning; preserve `bpmn_file` only when the current BPMN still represents the revised contract. A changed rule outcome or condition is a semantic change even when edited as text.
  - **structure fixes**: when nodes, branches, roles, step order, or process membership must change, edit only each affected canonical BPMN file.
- Don't re-derive what `smart_questions` / `function_modules` already captured (e.g. if `const_auth_mode=anonymous`, don't propose a "账号注册" process).
- If >10 processes are contemplated, reconsider scope rather than adding more.
- The BPMN authoring contract is `reference/bpmn_authoring.md`; the active file author must run `scripts/bpmn-validator.mjs validate-bpmn-file`, then `scripts/layout.mjs` in file-transform mode, then `validate-final-bpmn-file`, and repair every failure before publication. For delegated work that is the Worker; the Producer runs this loop only for serial authorship or takeover.

### Pre-Close-Out Self-Check

Every new or revised BPMN must pass the Bundle layout/validation pipeline in
its active author before publication. Do not rerun layout solely to acknowledge
a validated Worker receipt. Candidate-format checks stay inside delegated
Worker repair loops. Before close-out, check the complete WorkingCopy and state:

1. **Every process accepted** — every active process has a non-empty `bpmn_file` and a readable BPMN artifact. If any attempt failed without a fallback succeeding, tell the user which failed and why.
2. **Summary numbers match**: if you claim N processes in the close-out chat, `process_order.length == N` and every listed process has its artifact ref.

### Business Rules Format

`business_rules` is a list of short, declarative strings. Each rule captures ONE constraint that governs the process behavior. Keep each rule under ~40 characters when possible.

Good:
- `请假天数>3天时需要加签上级领导`
- `采购金额 ≤ 5000 元走快速审批`
- `只有部门经理可以发起预算调整`

Not good (too vague / too procedural):
- `按照公司规定执行`
- `先提交，后审批`

### Exception Handling Format

`exception_handling` is a list of `{scenario, handling}` objects. Each pair describes one exception path and its resolution. Keep each field to one short sentence.

Shape examples, valid only when these policies are established in the current product:
```json
[
  {"scenario": "审批人休假", "handling": "系统自动转交给备份审批人"},
  {"scenario": "员工撤回申请", "handling": "流程终止，通知所有已审批节点"},
  {"scenario": "系统超时24小时无响应", "handling": "自动升级到部门经理处理"}
]
```

Consider actor unavailability, cancellation, timeout, and dependency failure as
applicability checks, not required branches. Include only exceptions and
responses supported by the current request or design evidence. An unknown
response remains a decision gap; do not invent a deadline, fallback actor or
escalation policy to complete the diagram. `exception_handling: []` is valid
when no exception is established.

### Anti-Patterns

- **Closing with a metadata-only plan** — a close-out without BPMN strands the design at "descriptions only, no BPMN". The Producer must author or integrate every required canonical BPMN before complete publication; optional delegation does not change that responsibility.
- **Close-out without evidence** — after persisted evidence is complete, summarize what the flows clarified and any remaining material gaps before offering evidence-grounded next choices.
- **All processes in one BPMN blob** — each process gets its own accepted artifact ref. Do NOT nest multiple `<bpmn:process>` elements in a single XML document.
- **Emitting `bpmndi:*` / `dc:*` / `di:*` elements in a structure candidate** — let the Bundle layout script produce the canonical positioning before the Producer writes the final artifact.
- **Element ids without process prefix** — causes id collisions when multiple processes render together. Always use `{ElementType}_{process_id}_{num}`.
- **Process without a start or end event** — BPMN requires both. Every process has exactly one `<bpmn:startEvent>` and at least one `<bpmn:endEvent>`.
- **Infrastructure "processes"** — do NOT propose processes for deployment, server setup, database migrations, CI/CD, log rotation, etc. Those are platform-managed. Only propose product user-facing / business-facing behavior.
- **Human-only procedure presented as a product flow** — every process must reveal an actual product responsibility in the `系统` role.
- **Known automation flattened into generic tasks** — state product work in `system_responsibilities`; author it with the appropriate BPMN activity type.
- **Decorative BPMN events** — only express timer/message/error/conditional/signal facts established in `trigger_hints`.
- **Inventing stakeholder roles not mentioned by the user** — use a generic name only for an evidenced participant; neither an organization title nor `管理员` is a default extra actor.
- **Vague business rules** — a rule like `按公司规定执行` is worthless. Rules must be specific, testable assertions. If no concrete rule can be stated, drop the item rather than padding.
- **Too many processes** — 10+ for a simple app dilutes focus. Typical: simple single-user app = 2–4; mid enterprise = 4–6; large enterprise = 6–10. Split into sub-domains rather than flat-listing.

#### ❌ / ✅ Contrasts (common mistakes)

**Element id collision**

```xml
❌ <bpmn:task id="Task_1" name="填写请假单"/>           <!-- not prefixed -->
   <bpmn:task id="Task_2" name="部门经理审批"/>

✅ <bpmn:task id="Task_P-001_1" name="填写请假单"/>     <!-- prefixed with process id -->
   <bpmn:task id="Task_P-001_2" name="部门经理审批"/>
```

**Emitting layout / DI elements in the structure candidate** (waste — the Producer runs the Bundle layout script)

```xml
❌ <bpmn:definitions ...>
     <bpmn:process id="Process_P-001">...</bpmn:process>
     <bpmndi:BPMNDiagram id="BPMNDiagram_P-001"> ... </bpmndi:BPMNDiagram>
   </bpmn:definitions>

✅ <bpmn:definitions ...>
     <bpmn:process id="Process_P-001">...</bpmn:process>
     <!-- structure only — scripts/layout.mjs adds DI before the Producer writes it -->
   </bpmn:definitions>
```

**Fabricated stakeholder**

```
❌ stakeholders: ["员工", "人力资源专员", "财务主管", "CEO"]   # user never mentioned HR/finance/CEO
✅ stakeholders: ["员工", "直属领导", "上级领导"]              # grounded in the request
```

**Vague business rule**

```
❌ business_rules: ["按照公司制度审批", "流程按要求走"]
✅ business_rules:
     - "请假天数 ≤ 3 天时直属领导审批即可"
     - "请假天数 > 3 天时需加签上级领导"
     - "驳回后 24 小时内员工可修改重新提交"
```

### Process-edit rules (skill-specific)

- A persisted process is the current design, not evidence of user approval. Address user objections by revising the relevant process content. When revising legacy state, remove the obsolete process `is_confirmed` marker while preserving other fields; do not rerun only to remove it.
- To remove a process, drop its id from `process_order` in your output. `process_order` is the source of truth for which processes are live — both the panel and the deliverables check key off it, so a process not in `process_order` is gone everywhere. Don't rely on a `deleted` flag.
- When revising descriptions, rules or stakeholders, preserve unaffected metadata and artifact refs. If diagram-visible meaning changes, clear only the affected process's ref and repair its BPMN as described in Maintaining existing design; restore the same path after final validation.
- For replacement BPMN, keep the same canonical file path and repair target, not an accepted ref to a stale diagram. Clear the affected `bpmn_file` while revising and restore that path only after final validation. A retry repairs the same artifact.
- The Producer treats the active processes' `bpmn_file` refs as the complete
  Flow artifact set. A successful save removes BPMN files no longer referenced
  by the canonical process map in the same atomic publication.
- Wording-only fixes do not require regenerating a correct diagram. A change in conditions, outcomes or responsibilities does require updating the affected BPMN, not waiting for a separate diagram request; never regenerate unrelated processes.

The skill is done when every active process has a readable direct BPMN ref. After that, return control for the normal fused assessment; this skill does not own the close-out wording or suggestions.

---
name: role_access
description: |-
  - **Capability**: define product roles, how each role is obtained, the concrete operations each role is allowed or explicitly forbidden to perform, and optional single-parent permission inheritance.
  - **Resolves**: S/T gaps where actors are known but authorization boundaries, target ranges, runtime conditions, or extra verification remain unclear.
  - **Candidate when**: different users or service identities use the product differently, a flow/page contains protected actions, or the user explicitly asks for roles, permissions, RBAC, or access control.
  - **Do not infer**: a job title, flow lane, persona, or page visitor is not automatically a product role; do not invent organization levels or enterprise separation-of-duties rules.
  - **Output**: `role_access` panel — editable roles with assignment rules, local permissions, and an optional same-source inheritance graph with read-only ancestor permission sources.
---

# Roles and Permissions

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Ownership and tools

`role_access/role_access.json` is the only canonical state. The foreground
Producer uses project-scoped `list` and `read` to inspect that state, GROUND,
and the smallest relevant Design evidence. It uses `write` or `edit` to maintain
the complete authorization design in its owned WorkingCopy. This lightweight
skill is completed directly by the Producer.

For a proposal that requires explicit review, the Producer calls
`design_validate`, repairs every schema or declarative validation diagnostic in
the same WorkingCopy, and repeats
until valid. It then calls `design_publish({action:"handoff"})` to publish the
canonical state before the review gate. A panel save already persists the
user's edits; later runs read and preserve them.

## Maintaining existing design

The saved `role_access` state is the authority for the current authorization design. A later request changes the affected role or permission; it does not create a parallel permission matrix.

- Read the current state before a material revision when the relevant role, assignment rule, permission, condition, or extra requirement is not already visible in the current design context.
- Preserve unaffected role and policy IDs, order, wording, conditions, and requirements. A policy belongs to one role only, so editing one role must never alter another role's policy record.
- For the first material role design and for any later add, rename, delete, reassignment, permission change, or condition refinement, maintain the complete updated state in the Producer's WorkingCopy, preserving unaffected records and including the complete changed order list. A deletion drops the role or policy from the state and from its order list. Panel saves already persist edits and must not be repeated merely to continue the conversation.
- Preserve existing inheritance edge IDs, direction and explanation. Removing a role
  removes its own policies and incident inheritance edges in the same state; it
  never deletes another role or copies a removed parent's permissions to its children.
  A parent-policy edit can affect descendants' inherited view: name that impact
  and keep those policy records at their original owner. Changing an assignment
  rule does not change descendants' assignment rules.

## Prerequisite evidence

This Bundle deepens established capabilities and protected journey actions from `function_modules` and `flow_design`. Treat their persisted records as references and never copy them into a parallel function or flow model. When either source is absent, keep only roles and permissions grounded by the current request and visible design evidence; do not invent actors or protected actions to complete the panel. The user may explicitly authorize reasonable assumptions, but unsupported decisions remain assumptions rather than facts attributed to another Bundle. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted roles and permission decisions with the available `function_modules` and `flow_design` evidence. Repair one deterministic issue owned by `role_access` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real authorization decision is required. If an upstream Bundle or record is missing, malformed, or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when the product needs an explicit answer to two questions: how an identity receives a named role, and what that role may do. It is appropriate after actors or protected product actions are known, or whenever the user directly asks to design or revise access control.

Do not use it to repeat personas, job descriptions, responsibilities, organization charts, workflow participation, or page navigation. Those facts may provide evidence for a role, but a role exists only when a distinct permission set is needed. Public access is a permission decision outside this granted-role panel. A function or page being visible does not by itself prove that every visitor may operate it.

The general Web App model assumes one current role per user or service identity within the product context. An optional single-parent chain can reuse an evidenced permission set; it does not grant the identity multiple roles. Products that intentionally compose multiple roles, require multiple parents, calculate permissions from organization hierarchy, or require separation-of-duties matrices belong in a custom enterprise skill.

## Close-out evidence

Close only after the visible roles, assignment rules, and material permission decisions are persisted and reviewed through the native panel, with every completion issue repaired. A reviewed role design primarily adds S and T evidence because authorization boundaries and observable allowed behavior become inspectable. It may improve U only when resolving roles clarifies who the product actually serves. Report the persisted evidence behind those changes; role or permission count alone adds no clarity.

### Typical evidence guidance

- Reviewed roles, assignment conditions and material permission decisions provide evidence about authorization structure and observable allowed behavior under the shared rubric; no fixed S/T increment follows from producing a role design.
- Resolving an unclear actor or product boundary can also provide U evidence; any score change follows the saved facts and current agreed scope, not a fixed range.
- Empty roles, permissions copied from job descriptions, uncovered protected actions, or broad access without a grounded condition may leave scores unchanged or lower them.

## Output contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Inputs and authority

Before proposing roles, inspect GROUND and the smallest relevant set of persisted design evidence:

| Prior evidence | Extract | Use in this skill |
|---|---|---|
| `smart_questions` / GROUND | established users, account mode, membership or invitation facts | identify grounded identities and assignment rules |
| `function_modules` | active user-facing capabilities | find product areas that may contain protected operations; do not turn every function into a permission |
| `flow_design` | actors, approvals, handoffs, exceptional actions | inventory who performs material actions; a lane is evidence, not automatic permission |
| `business_data` / `business_rules` | business things, visible states, eligibility and prohibitions | write a natural `applies_when` or explicit deny only when required |
| `page_design` | visible actions on lists, details, forms, and workspaces | check that every protected user action has a role decision |

If those artifacts do not exist, use the user's current requirement conservatively. Prefer `用户` and `管理员` over fabricated department titles. Never invent identity-provider groups, organization levels, API scopes, endpoint names, or database identifiers.

### Usage

Maintain the complete role design state for the first material design and for every later chat-requested change. Run integration validation and publish the paused WorkingCopy before presenting the native panel. The native panel persists its own edits; do not repeat a panel save.

The host appends the exact generated schema to this body. Follow that schema literally: `roles` and `policies` are ID-keyed mappings, `role_order` and `policy_order` are ordered ID lists, and every policy uses the singular `role_ref`.

## Workflow

### 1. Build an action inventory from evidence

List the material product operations implied by established flows and pages before creating roles. Focus on operations that change data, reveal non-public information, approve or reject work, manage other users, export information, or alter configuration. Ordinary navigation and viewing public content do not need role records.

For each protected operation, identify:

- the actor that needs it;
- the user-visible capability, written as a verb plus its target, such as `审批订单` or `查看项目成员`;
- whether it applies everywhere or only to a target range/state;
- whether the operation needs an extra confirmation step.

Do not persist this inventory as another collection. It is a reasoning checklist used to form `roles` and `policies`.

### 2. Derive permission sets, not job titles

Start with established actors, then group them by required access:

- Merge actors into one role when they obtain access the same way and need materially the same permission set, even if their business titles differ.
- Split roles when their allowed operations materially differ. A reviewer who can approve an order and an applicant who can only submit it need different roles.
- Keep one role and use `applies_when` when the operations are the same but apply only to owned records, one workspace, or a lifecycle state.
- Do not create a second role merely to express temporary confirmation, record ownership, or one conditional operation.
- Treat a service identity as a role only when it authenticates to the product and performs protected product operations.

A role title must be durable and understandable to the user. Prefer `项目成员`, `审批人`, and `系统管理员`; avoid person names, temporary team names, and internal group codes.

### 3. State how each role is obtained

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

For a new design, grant only operations needed by established tasks and add
extra verification only when an allowed high-impact operation needs it.
Restoration preserves the evidenced grants and verification even when a better
policy could be proposed; policy improvements are separate design work.

### Optional permission inheritance

Start with flat roles. Add `inheritances` only when the request or observed access
behavior establishes that one role receives another role's permission set. A job
title, seniority, flow lane, larger scope, or similar capability names do not prove
inheritance. An administrator needing a wider target range does not inherit a
member's narrower grant merely because the administrator looks more senior.

Use one edge from child `source` to parent `target`, with `kind="inherits"`.
Each child has at most one parent; a parent may have multiple children, and
chains may span multiple levels. Reject self-links, cycles, missing endpoints
and duplicate parent edges. Never add `roles.parent_ref` as a second authority.

Local policies remain attached through their original singular `role_ref`.
Show inherited policies read-only with the originating role, preserving the
original `effect`, target range and `applies_when`, `requirements`, and
`custom_requirement` at every level. Do not copy those policies to the child,
remove verification, rewrite “own records” as “all records”, or inherit the
parent's `assignment_rule`. Edit a sourced policy at its owning role only when
that change and its descendant impact are authorized.

Walk a concrete protected action for the child through the entire parent chain.
If local and ancestor decisions might overlap or contradict, explain the source
roles, conditions and unresolved decision in the handoff and ask when needed.
Do not infer that a local rule overrides a parent, that deny always wins, or that
identical natural-language capability text establishes the same authorization
scope. This Bundle designs inspectable access facts, not an enterprise ACL
evaluator. Do not claim the inheritance design is resolved while a consequential
allow/deny conflict remains unclear. Reconstruction preserves supported source
semantics and reports unsupported composition rather than inventing precedence.

### 7. Reconcile coverage and least privilege

Before writing or closing, check the design in both directions:

1. Every protected action established in a flow or page has one grounded allow decision for the role expected to perform it.
2. Every allow decision traces to an established user task; remove speculative or convenience access.
3. Every `role_ref` resolves to one existing role, and each role has at least one material local or explicitly inherited permission.
4. Similar role titles do not hide identical permission sets that should be merged.
5. Conditions do not contradict business rules or lifecycle states.
6. A role cannot approve, administer, export, or view sensitive information merely because it participates in the same flow.
7. Every inheritance edge is evidenced, single-parent, acyclic and endpoint-valid;
   inherited permissions retain their original conditions and verification, with
   any consequential conflict resolved explicitly rather than guessed.

If a required identity fact is missing, preserve the smallest safe design and report the gap in close-out. Do not silently broaden access to make a workflow appear complete.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Interaction gate

This skill uses `must_edit` because authorization decisions require explicit review. After the current role/access facts are validated and published with `design_publish({action:"handoff"})`, pause for the native role-centric panel. A successful panel save persists any user edits and releases the review gate; it does not create or change an evidence-review status.

The form and canvas edit the same role and inheritance records. Use the shared
canvas/details overlay switch to inspect the chain, then return to the selected
role's details; do not create another matrix or a sidebar viewing-mode selector.
The local permission editor and read-only ancestor sources have different edit
ownership even when both are visible. Default flat data remains useful without
an inheritance edge or an invented parent.

## Close-out

Summarize the reviewed result by role: how it is obtained, its principal permission decisions, optional parent chain and original permission sources, and material conditions or extra verification. Report only actionable uncovered operations, contradictory decisions, excessive access, or missing identity facts. Do not repeat the full permission list in chat when it is already readable in the panel.

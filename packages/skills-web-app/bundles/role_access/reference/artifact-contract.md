# role_access output contract

## Record IDs

For new roles prefer `ROLE-001`, new policies `AP-001`, and new inheritance records `RI-001`, continuing each type separately. Preserve the actual role endpoints and requirement/assignment tokens.

Existing IDs, including older formats, remain valid during ordinary edits and reconstruction. If the user explicitly requests business renumbering, revise actual record keys/IDs and current references/orders together through their existing owners; keep technical IDs and history unchanged. Names and titles remain readable content, separate from identity.

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Shared by ordinary design and reconstruction. Canonical state is
`role_access/role_access.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

Roles represent permission sets, not job descriptions or flow participants. Preserve actual access behavior rather than improving its least-privilege policy during restoration. The model uses one current role per identity in context; report multi-role composition or other unrepresentable semantics instead of silently flattening them. A missing permission in inspected evidence does not prove source denial; the panel’s unlisted-operation convention must not become a claim about unexamined source behavior.

Author new business text in the language requested for the design, otherwise in
the established project language (or the current request's language for a new
project). This includes titles, custom assignment rules, capabilities, conditions
and descriptions. Keep IDs, enum values and the assignment presets below exact.
Preserve unaffected saved wording; a UI language change does not translate user
content. Reconstruction retains source wording unless translation is requested.

## Output contract

Persist the role and policy evidence, with optional explicit inheritance edges:

1. `RoleDefinition`: a durable named permission set and one plain-language rule explaining who receives it and when.
2. `AccessPolicy`: one allow/deny decision owned by exactly one role, expressed as a user-understandable capability with an optional applicability sentence and optional pre-operation verification.
3. Optional `RoleInheritance`: one child-to-parent permission-set edge. It does
   not express organizational rank or a second assignment rule.

Do not create persona, responsibility, role-conflict, shared-policy, access-scope, condition-rule, design-reference, safeguard, assumption, or open-question collections. Keep detailed source content in its owner skill and refer to it while reasoning; do not duplicate it into role state.

### 3. State how each role is obtained

Write one self-contained `assignment_rule`. The two existing radio presets have
stable stored values and localized display labels:

| Stored value (keep exact) | Meaning |
| --- | --- |
| `注册后自动拥有` | Automatically granted after registration. |
| `由管理员授予` | Explicitly granted by an authorized administrator. |

Use a preset only when its meaning matches the evidence. Otherwise write the
actual rule in the design's authoring language, such as “Granted on joining the
project; revoked on departure.” Do not store the localized Other option label
or describe what the role does in `assignment_rule`. Preserve existing preset
values and custom rules on unrelated edits.

### Permission decisions

Record the evidenced local operations for each role. Each policy belongs to exactly one role through `role_ref`; never share its ownership between roles. For independent roles with similar operations, use separate local records so their target range and later edits remain independent. When explicit inheritance is evidenced, retain the policy at its original owner and refer through the parent edge instead of copying it.

Write `capability` as one natural user-facing phrase. Do not split it into technical resource/action fields and never expose strings such as `approve:business_data:order`, endpoint names, or code symbols. For a new or revised capability, set `title` to that same operation phrase. The separate `effect` field records and displays allow/deny; do not add a language-specific effect prefix to the title. This derived title is record metadata, not a second permission concept shown for user input. Preserve unaffected saved titles.

The panel models explicit permission decisions, with unlisted operations implicitly denied in that model. This convention does not establish source behavior when evidence coverage is incomplete.

- Use `effect="allow"` for an evidenced grant, even if it appears broader than necessary.
- Use `effect="deny"` only when an explicit prohibition must remain visible because a broader-looking permission could otherwise be misunderstood, a business rule expressly forbids the operation, or the user asks to record it.
- Do not generate exhaustive deny lists for everything the role cannot do.

### 5. Add one applicability sentence only when needed

Leave `applies_when` empty when the decision applies to every instance and state relevant to the role. Otherwise combine target range and runtime condition into one plain-language sentence, for example “Only assigned customers while follow-up is active.”

Use this field for ownership, workspace boundary, record relationship, lifecycle state, amount threshold, or another established condition. Do not create separate scope and condition records. Do not hide a second permission inside the condition.

### 6. Add extra verification only when the operation itself needs it

`requirements` may contain:

- `confirm`: show a separate confirmation prompt immediately before performing the capability;
- `reauthenticate`: verify the user's identity again;
- `custom`: perform the plain-language step in `custom_requirement`.

Record these when a requirement, agreed design decision, or observed behavior
establishes that independent verification for the allowed operation, regardless
of its perceived risk. Business approval, sign-off, or choosing
Approve/Return/Reject is the operation itself; neither its label nor its impact
establishes another confirmation prompt. Preserve independently evidenced
verification during reconstruction.

A required Return reason belongs in `custom` with its explanation in
`custom_requirement`; assignment and lifecycle limits belong in `applies_when`.
Neither implies `confirm`. When `custom` is absent, leave `custom_requirement`
empty. These steps do not grant permission; they are additional checks after
the role is already allowed to act.

### Optional single-parent inheritance

Old `schema_version: 5` state without `inheritances`, or with an empty map,
remains flat. Do not insert edges merely to populate the canvas. The optional
map uses stable edge keys equal to `id`; each edge has `id`, readable `title`,
`kind: "inherits"`, child role ID `source`, parent role ID `target`, and optional
`description` explaining the evidenced relationship. There is no second
`parent_ref`, ancestor list, inherited-policy copy, derived effective-policy map,
or inheritance order list. The existing role and policy order lists are unchanged.

For example, synthetic `reviewer -> member` and `lead-reviewer -> reviewer`
edges express a two-level chain. The reviewer still has its own assignment rule,
and its ancestor's “edit own requests while open” grant does not become “edit
all requests”. Its ancestor's confirmation, reauthentication or custom step also
remains required. The example is a representation illustration, not source facts.

Mechanical checks reject self-inheritance, cycles, dangling endpoints, more than
one parent edge for a child (including duplicate edges to the same parent), and
edge ID/key mismatch. The `kind` enum admits only `inherits`. Parent and child
must already exist in `roles`; do not create a speculative role to repair a link.
Removing a role removes its own local policies and every incident edge while
preserving other roles, their local policies and remaining edges. Removing an
edge does not remove either role or materialize its ancestor permissions locally.

Inherited policies stay read-only at the child and identify their originating
role. Preserve their effect, natural-language applicability, confirmation,
reauthentication and custom verification without expansion. Role assignment is
always local. Changes to a parent policy can affect descendants and need explicit
impact discussion; changing a child's local policy never mutates an ancestor.

No precedence evaluator is defined here. If an inherited/local allow or deny
may conflict, identify both owners and original conditions and ask for the
material missing decision. Do not infer local-over-parent or deny-over-allow from
wording or string equality. Reconstruction reports multi-parent/multi-role or
unknown precedence as unsupported/uncertain rather than silently flattening it.
Both form and canvas operate on the same edges and original policies.

Read [the synthetic Chinese-language inheritance example](example.json) only for
representation; its wording does not select a project's language and it is not
user authorization evidence. The flat English-language example below remains valid.

## State contract

Write `RoleAccessState` in this shape; the generated schema remains authoritative for exact types:

This example assumes that a requirement, agreed design decision, or observed
behavior independently establishes a confirmation prompt before removing a
project member; removal alone does not imply that prompt.

```json
{
  "schema_version": 5,
  "title": "Project Roles and Access",
  "summary": "Members maintain their own tasks; administrators manage members and workspace settings.",
  "roles": {
    "project-member": {
      "id": "project-member",
      "title": "Project Member",
      "assignment_rule": "Granted on joining the project; revoked on departure"
    },
    "workspace-admin": {
      "id": "workspace-admin",
      "title": "Workspace Administrator",
      "assignment_rule": "由管理员授予"
    }
  },
  "role_order": ["project-member", "workspace-admin"],
  "policies": {
    "member-edit-own-task": {
      "id": "member-edit-own-task",
      "title": "Edit assigned tasks",
      "role_ref": "project-member",
      "capability": "Edit assigned tasks",
      "effect": "allow",
      "applies_when": "Only while the task is unfinished",
      "requirements": [],
      "custom_requirement": ""
    },
    "admin-remove-member": {
      "id": "admin-remove-member",
      "title": "Remove project members",
      "role_ref": "workspace-admin",
      "capability": "Remove project members",
      "effect": "allow",
      "applies_when": "Only within an administered workspace",
      "requirements": ["confirm"],
      "custom_requirement": ""
    }
  },
  "policy_order": ["member-edit-own-task", "admin-remove-member"]
}
```

Use stable IDs and keep map keys equal to each record's `id`. Keep every live ID exactly once in its order list. Order lists replace wholesale, so the canonical state carries the complete changed order list when adding, removing, or reordering records; a removal also drops the record from its map.

## Quality gates

- Every role is a distinct permission set with one clear local assignment rule and at least one material local or explicitly inherited permission.
- Every policy names one existing role, one effect, and one user-understandable capability.
- Every allow is supported by the applicable evidence; missing evidence is not a denial fact.
- Explicit denies are exceptional and grounded, never an exhaustive negative matrix.
- `applies_when` is optional and combines target range and runtime condition in one self-contained sentence.
- Extra requirements describe evidenced verification beyond allow/deny.
- Flow participation, a job title, or page visibility is never treated as permission proof.
- Every policy record keeps one owner. Editing a child's local policy cannot
  change another role's policy record; authorized ancestor edits may change
  descendant inherited access and must report that impact.
- Inheritance is optional, grounded, single-parent and acyclic. Original
  conditions and verification are preserved; unresolved consequential conflicts
  are not hidden by an invented precedence rule.

### Common mistakes

```text
Wrong: role = “Sales Manager”, responsibilities = “Manage team performance”
Right: role = “Sales Manager”, assignment_rule = “由管理员授予” (stable preset), policies = “View team customers” and “Approve discount requests”

Wrong: capability = “approve:business_data:order”
Right: capability = “Approve orders”

Wrong: one shared “View orders” policy points to both salesperson and manager
Right: salesperson gets “View assigned orders”; manager gets a separate “View team orders” policy

Wrong: generate denies for every omitted operation
Right: omit unavailable operations; add an explicit deny only for a grounded prohibition such as “Approve one's own request”
```

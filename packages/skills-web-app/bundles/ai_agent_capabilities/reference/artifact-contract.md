# AI Agent design output contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

For related design slices, read [the cooperation guide](cooperation-guide.md).
It covers ownership, source evidence and caller handoffs for both design and
reconstruction, not permission to write another Bundle or invent missing facts.

Shared by ordinary design and reconstruction. Canonical file:
`ai_agent_capabilities/ai_agent_capabilities.json`. The active schema is
authoritative. This capability is unreleased and has not been used. The manifest
stays 1.0 and `schema_version` stays 1. No migration or version-management layer
is part of this first release.

## Design and evidence

Each `agents` map record is one responsibility/outcome, from a bounded direct
model transformation to an interactive Agent. Skills, tools, Agents and optional shared model entries/knowledge resources are
independent collections. Do not invent manual functional groups or require an
SDK choice. Page layout, shared rules/data/access and formal acceptance retain
their current owners. Preserve existing functional links and exact source pins;
ordinary forms do not require a duplicate link/evidence section.

For reconstruction trace a real entry to the instructions, resource loading,
registered tools and runtime/model configuration it actually uses. Dependencies,
mock controls, prompt files and MCP entries alone do not establish running
behavior. Preserve exact instructions, user configuration and source locations;
improvements remain explicit proposals. Missing coverage stays unknown.

Uploads are not parsing; recordings are not realtime voice; image inputs are not
vision; UI cancellation is not task cancellation. Intended permissions are not
enforced permissions. Designed/configured resources are not installed/tested.
A schema or preview cannot prove runtime support or model quality.

## Shape and editable information

Root requires `schema_version: 1`. Optional map collections are `skills`,
`tools`, `agents`, `model_sources` and `knowledge_resources`, so a draft may
start with an Agent or a resource.
Every record has stable `id` and `name`; each map key equals `id`. Agents also
require `description`. Completion requires at least one named Agent
with a responsibility. Other dimensions are optional; notes are always optional.

- `description`: responsibility and overall useful outcome, without repeating
  a separate result box.
- `entries`: stable-key map of entry name, trigger (`conversation`, `action`,
  `background`), location, input modes, optional `auto_context` and feedback. Multiple entries may coexist.
  `location` is the chat entry position, dedicated action position, or automatic
  event/timing and conditions respectively. `input_modes` means supported chat
  inputs or optional extra user input for an action; it is not applicable to a
  background entry. Missing/empty action inputs are valid. `auto_context` describes
  information automatically supplied by this entry (selected text, current object,
  event payload), not the Agent-level `context` library or `memory_retention`.
  Visibility is presentation-only: preserve stored values when switching trigger
  and when saving/reopening; do not interpret hidden input modes as a request for
  interactive background input.
  `trigger` describes the entry point: chat, a dedicated button/menu, or an
  automatic trigger. It does not determine single-turn versus multi-turn behavior;
  a button may open a conversation. These stored enum values remain unchanged.
- `context`: optional material/library sources and authorized scope. For free
  conversation this includes current messages, attachments, selected material
  and permitted history, not a fixed transcript or context-window setup.
- `memory_retention`: optional long-term memory and access/update/deletion rules.
  Existing SDKs do not settle the product's retention policy. Omit when unneeded.
- `system_prompt`: complete editable instruction text.
- `skill_refs`, `tool_refs`: references to independent resources, not copies.
  Even a direct model call may use Skills. Agent-specific loading/authorization
  belongs in its action conditions, material scope or complete prompt. Reuse
  does not share permissions, history or credentials.
- `actions`: optional stable-key map, closed string fields
  `{action, condition, result?}`. New authored rows explain all three meanings;
  old rows without result and empty drafts remain valid. Actions are not entries,
  tool names or enforced guards. A result distinguishes display, draft, adoption,
  write and durable save. Explain whether/how adoption protects or overwrites
  subsequent user edits, earlier results and original material according to source
  evidence or explicit user decisions. Unknown behavior does not default to
  protection. Reconstruction preserves source-backed overwrite behavior;
  adding protection is an explicit proposal, not an observed fact. This does
  not relax the requirement to preserve user-owned fields when revising Design Files.
- `exceptions`: optional stable-key map of `condition` and `handling`.
  Include meaningful unavailable evidence, denied actions, invalid output, stop,
  retry and takeover cases. Partial results are not completion;
  stopping, resuming and replaying are different behaviors. Describe retained
  work and actual recovery, not invented durable resume or retry safety.
- `collaborations`: optional stable-key map of `agent_ref`, `external_target`,
  `condition`, `handoff`, `result`. Each row names a specific local Agent or an
  external task/host collaborator, when to hand off,
  task/material transferred, returned result and failure ownership. Do not copy
  a global handoff into every target. An absent or empty target permits a draft;
  a selected nonempty local `agent_ref` must exist, with no whitespace normalization.
  The graph derives the same references, never an independently editable copy.
  Sub-Agents use the same dimensions; references do not establish execution,
  inheritance or a coordinator. Use free-text `external_target` only when no local
  `agent_ref` is selected; it creates no local record or graph node and does not
  claim the external service exists, is accessible or connected. Any nonempty
  `agent_ref` takes precedence, with external text retained but inactive. Stale or
  whitespace local references still fail validation, never fall back automatically;
  only an explicit clear restores the external target. Keep condition/handoff/result
  when switching. Older `external_delegation` text remains in canonical data and
  scalar summaries, not a separate daily editor. Only an explicitly requested
  revision may organize that text into rows without losing its meaning or constraints.
- `model_connection`: optional per-Agent fallback when no `model_source_ref`
  is selected, `runtime | existing | other`. `runtime` means the
  product provides a model API settings entrance for use-time configuration;
  it needs no model parameters in this design. `existing` integrates a service
  described manually in `model_service`, or uses an existing `integration_ref`.
  `other` uses `model_service` as free-text explanation, e.g. the product user's
  existing local model access. Absent means undecided, not a guessed default.
- `model_service`: optional configuration plan for `existing`, or connection
  description for `other`. Preserve useful service/source preferences, required
  modalities and material data/access boundaries; action/context restrictions
  and supplementary notes retain their owners. This is not runtime configuration.
  A template may use `${MODEL_API_KEY}`; real keys are supplied at product use time,
  never stored in Design Files. These are not mandatory SDK, model, endpoint or credential configuration.
- `integration_ref`: optional real `integration_design.integrations` record,
  active only with `model_connection: existing`. Referenced integration owns its
  configuration; local text may supplement product intent, not duplicate or
  override its parameters. Conflicts need review. No requirement to create or run
  that Bundle first, no guessed ID or inference that designer-host login grants
  deployed product access. Switching choices retains both optional fields;
  hidden values are inactive, not authorization or a verified connection. Earlier
  `model_service`/`integration_ref` without a choice remain unchanged; opening
  the Panel must not infer a choice, migrate, or remove the original values.
- Root `skills`: purpose, activation, complete `body`, optional `source`,
  referenced `resources` and notes. Keep full methods and failure handling,
  not only a routing description. `source` is optional acquisition provenance,
  such as an existing repository/local path; original content can omit it.
  `resources` lists supporting document/template/script locations used by the
  body, separately from provenance. This list neither uploads nor installs files.
- Root `tools`: `purpose` describes the required capability, relevant input and
  useful result in product language. It does not require an API signature or a
  selected implementation. Optional `tool_kind` is `function` or `mcp`; absence
  means undecided, never an inferred function default. An Agent may reference
  this capability before choosing its connection; references do not prove it works.
  When an implementation is supplied/selected, preserve complete `interface`
  input/output or opaque `config_json` in optional connection details. Known
  implementation text remains intact during reconstruction and revision; a
  collapsed editor is not permission to omit or shorten it. MCP text is the sole
  connection authority; preserve unknown keys. Source and tool-specific
  `scope`, `approval`, `failure` are optional. Do not duplicate Agent rules.
  Switching type hides but never clears the other full content. No type,
  interface, JSON, URL or credential is required merely to describe the capability.
- `notes`: optional rationale, observations, proposals and unknowns.
  Exact `references` remain structured metadata, not a daily input form.

### Optional shared-resource identities

Root `model_sources` is an optional stable-key map of closed records with required
`id/name` and optional `description/model_connection/integration_ref/notes`.
`model_connection` is `runtime | existing | other` with the same product-intent meaning
as the Agent fallback. `integration_ref` is active only for an existing connection;
its target owns configuration. Descriptions explain intent, not copied parameters.

Root `knowledge_resources` is an optional stable-key map of closed records with
required `id/name/kind` and optional string fields `description`,
`source_and_maintenance`, `formation_and_update`, `user_management`, `access_scope`
and `notes`. `kind` is explicitly
`knowledge_base | long_term_memory`. The key equals the record's id. No name,
shared prose or similar connection method proves that two resources are one.
Different resources with equal names remain distinct.

- Knowledge base: `description` identifies available material;
  `source_and_maintenance` describes its source and how it is added, updated or
  removed. Unknown availability or maintenance is not inferred automatic refresh.
- Long-term memory: `description` identifies what persists between conversations;
  `formation_and_update` describes creation, confirmation, update and conflict
  handling; `user_management` describes viewing, correction, clearing and later
  use after clearing. Source-backed absence of a control stays explicit; a proposed
  control is not an observed feature. Memory is not a copied full transcript.
- Both: `access_scope` explains meaningful personal/project/team sharing and
  use boundaries. A resource definition is never an access grant.

These optional product facts do not require storage technology, an API, fixed
retention duration or a complete lifecycle form. Switching kind hides branch-only
fields without deleting them; hidden branch values are inactive under the chosen
kind. A legacy description remains byte-for-byte until an explicit revision;
do not silently interpret broad old prose as confirmed content or a new policy.

Agent `model_source_ref` optionally selects one real local model source.
When selected it takes precedence over retained Agent `model_connection`,
`model_service` and `integration_ref`: those remain stored but inactive.
Clearing the ref omits it and restores the fallback's original applicability,
without guessing a choice or rewriting text. A nonempty dangling/whitespace ref
fails the local state check; it must never silently fall back. Optional string
`model_selection` is the Agent's model intent through the entry, not a model
configurator or proof of availability. Agents sharing an entry may select
different models; an unknown selection stays absent.

Agent `knowledge_resource_refs` is an optional array of existing local resource
IDs, classified by target kind. `context` and `memory_retention` remain the
Agent's use/access and retention/update/deletion policies, not copied resource
definitions: supplement common resource policy only with genuine Agent-specific
conditions or differences. Existing Agent fields remain usable without any shared
resource. A conversation-history UI alone proves no long-term memory.
Shared definitions confer no shared credentials, permissions or
user memory. Unlink local refs before target deletion. No automatic migration,
extra resource count, gateway credentials or new completion gate is introduced.

### Earlier optional fields

Schema 1 retains `result`, `boundary`, `memory_retrieval`,
`resource_policy`, `result_adoption`, `failure_handling`,
`usage_requirements`, `execution_policy`, `harness`, `model_access`,
`delegate_refs`, `handoff`, `test_cases`, `function_refs`, `evidence`
and tool `transport` for lossless reads/edits. New content uses the compact
shape above, not two concurrent authorities. Their original values remain
available in raw files; merely opening, switching tabs or saving an unrelated
field never migrates them. Formal acceptance cases belong to
`quality_acceptance`, optionally grouped as AI behavior, not automatic
cross-Bundle writes or a mandatory extra execution.
If explicitly asked to revise earlier content, account for every old meaning
and conflicting fact, keep pins, and adjust local `subject_pointer` only if
its actual subject moves. Do not silently combine conflicting facts.

Map keys are stable identities, not display names or positions. Fields
may be absent; viewing, changing language or changing runtime does not materialize
empty maps or discard hidden fields. Do not store runtime IDs, logs, executable
graph coordinates or a second resource/configuration authority. The read-only
relation canvas derives edges from these references and opens the original
records. Unlink references before deleting their resource; deleting an Agent
does not delete its resources or other Agents. Missing local Skill, Tool and
Agent collaboration targets remain explicit diagnostics and block save, not
invisible or cascading deletion. The optional external `integration_ref` uses
the existing cross-Panel selector: choose a real integration record and retain
an unresolved selection for review. External target existence is not enforced
by this Bundle's local reference save rules; do not claim that it is or require
running the integration Bundle just to save an AI design.

## Resource workflow and secret boundary

Both manual and assisted paths start from the need. Users can provide/edit/save
complete Skill and MCP content without discovery or a candidate catalog.
AI discovery occurs only on explicit user request through tools the host actually
provides. Return recommendations for user review. Failed discovery retains the
need; selection grants no install/connect/call authorization.

No real credentials anywhere in state or resources, including URL query/userinfo,
MCP env/header values, prompt content, examples or diagnostics. References like
`${LIBRARY_MCP_URL}` or `env:MODEL_API_KEY` explain a proposed integration,
not an automatically resolved or verified connection. Config JSON validity,
transport/runtime compatibility and actual connection must be assessed separately;
the opaque text editor does not pretend to perform them.

Pinned `references` use the existing closed locator contract: required relative
Design Files `file` and full exact Git `revision`; optional RFC6901 `pointer`,
`subject_pointer` inside the owning record, and `note`. No absolute repository paths,
HEAD/placeholders or positional array subjects. Missing/deleted source targets
retain historical evidence; never guess a current target or rewrite a source pin.

## Safe revision

Experience, complete instructions/resources, behavior rules, collaboration and
model connection are views of the same Agent. Optional fields add no new completeness gate.
Scalar summaries include useful notes, materials, connection choice, plan and reference;
the selected connection choice determines applicability of retained hidden values.
nested entries/actions/exceptions/collaborations, full prompts, Skill bodies and
MCP configuration must be read from canonical records. A missing summary is
not missing behavior or permission to recreate it.

For revision preserve unrelated units and every user-owned field. Panel save
already persists edits: later generation reads that accepted state rather than
reapplying it. Validate the actual schema and semantic rules, repair rejected
material, publish through the existing WorkingCopy/atomic Git path, then honor
the owning handoff. A saved design is not installed resources, prompt optimization
or live Agent acceptance.

## Samples

`preview.json` is the sole representative synthetic Studio sample. It includes
an Agent, a direct model call and referenced resources; it is not user evidence, an approved harness,
a working server or an executed test. `example.json` is a small independent
contract example. Do not copy sample IDs/references into a real project as facts.

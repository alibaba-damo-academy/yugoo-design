---
name: ai_agent_capabilities
description: |-
  - **Capability**: design the AI behavior embedded in a Web App as Agent or direct-model units, with user experience, complete prompts, editable Skills and tools/MCP, and Agent collaboration.
  - **Resolves**: unclear responsibilities, triggers and results, action-condition-result rules, exceptions, materials and long-term memory, and per-Agent handoffs.
  - **Candidate when**: AI behavior needs to be designed, reconstructed from evidence, or revised; required Skills and tool capabilities can be described before selecting an implementation.
  - **Do not infer**: a chat box, dependency or model name alone establishes the needed mechanisms. Saving the design does not install resources, connect services or prove evaluation success.
  - **Output**: an editable AI design panel with linked Agents, Skills and tools; preserve complete instructions, user configuration and confirmation choices.
---

# AI Agent Design

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Read [the output contract](reference/artifact-contract.md) before authoring.
Own only `ai_agent_capabilities/ai_agent_capabilities.json`. Read relevant
project facts with the scoped Design tools; preserve existing user edits.
Use the actual loaded schema/validation and publication entrance for this host,
in either resolved execution placement. A source update does not upgrade a
project's exact content pins.

When AI behavior affects another design slice, read
[the cooperation guide](reference/cooperation-guide.md). Return concrete gaps
and proposed supplements to the caller; it does not authorize this executor to
write another Bundle or bypass the current handoff.

## Start from the job, not the settings

An Agent is a coherent design unit with a useful result, responsibility and
boundary. A direct model call is a special unit for a bounded transformation:
do not invent a planning loop, tools or memory just to complete a template.
Split independent responsibilities only when their inputs, outputs, authority
or lifecycle genuinely differ. Skills, tools (including MCP), Agents and optional
shared model entries/knowledge resources have independent canonical identities.
Model intent may stay per-Agent or reference an optional shared entry; neither
requires gateway settings or a manual functional group.
Agent records reference Skills and tools rather than copying them.

Identify who needs the outcome, the real entry, the supplied context, expected
result and consequential failure. Existing Function records own user tasks and
local behavior; Page records own placement/layout. AI owns its specialist
trigger/interaction, instructions, resources, context, execution and quality.
Preserve existing `function_refs` and pinned `references` for source facts;
do not require a second functional-link form. Human-facing rationale and
unknowns belong in optional `notes`. Missing upstream entities are a gap, not permission to invent IDs or run
another Bundle automatically. Never modify another Bundle from this invocation.

## Explain the experience and its mechanism together

A unit can have conversation, action and background entries. Each entry explains
its trigger, location, available input modes and visible progress/result/failure.
These are entry points (chat, button/menu, automatic), not a choice between
single-turn and multi-turn interaction; a button can open a conversation.
Describe `location` according to the trigger: the chat entry's position for
conversation, the dedicated control's position for action, or the event/timing
and conditions for background. A chat send button remains conversation; a
user-requested job remains action even when execution is asynchronous.
Use `input_modes` for supported conversation inputs or optional extra user input
on an action. A button may need no additional input; background entries do not
ask for user input. Record selected text, the current object or event payload
in optional `auto_context`: information automatically supplied for this entry,
not the Agent's general library access or long-term memory. Explain authorized
scope, not credentials or implementation wiring. Switching trigger hides inputs
but must not erase existing `input_modes` or other user-authored values.
Distinguish file upload from parsing; recorded audio/transcription from realtime
voice; an attached image from vision understanding; hiding a response from
cancelling the actual task. Do not infer multimodal support from the UI control
alone. Explain unsupported formats, inaccessible content and user takeover.

Write a concrete system instruction draft, not just "be helpful": role/outcome,
input and evidence policy, professional steps, tool boundaries, output format,
uncertainty and stop/escalation conditions. Derive it from the agreed job; test
tasks make the expected behavior reviewable but do not prove prompt quality.
For reconstruction preserve the exact available deployed instruction, distinguish
it from proposed improvements, and report missing source coverage.

Start with the experience rather than an SDK choice. Experience,
instructions/resources, behavior rules, collaboration and model connection are views of one
canonical Agent, not separate drafts. Keep the overall outcome in `description`,
authorized material/library scope in `context`, and optional long-term memory
in `memory_retention`. Do not repeat the same requirement across fields.
Tab/visibility changes must not clear saved values.

Derive `actions` from the responsibility and actual use situations: what can be
done, on what information, and under what meaningful condition. A conversation
entry can suggest an action without permission to execute it; a button or
background entry can invoke the same responsibility. Do not equate a trigger
with an action, a listed tool with authorization, or a stated condition with an
enforced guard. Preserve observed restrictions in reconstruction; new conditions
are proposals until the user accepts them.

Each `actions` row contains `action`, `condition`, and `result`. In that row's
`result`, walk from the output to its use. Is it displayed, offered
as a draft, selectively adopted or written automatically under a supported
product decision? Explain who decides, what changes, and whether/how adoption
protects or overwrites later user edits, earlier results and original material.
Follow source evidence or explicit user decisions; unknown behavior does not
default to protection. When reconstructing, preserve even a source-backed
overwrite policy; added protection is an explicit proposal, not an observed fact.
Rendering, generating and persisting are different steps. Do not infer automatic
overwrite from a usable result. This product adoption policy is separate from
the requirement to preserve user-owned fields when revising Design Files.

Use `exceptions` rows (`condition`, `handling`) for the user's path when evidence is unavailable, an
action is denied or execution stops: visible explanation, retained partial work
and a realistic recovery/takeover. Partial text is not a completed task. Separate
stop from resume and replay; check side effects and duplicate risk before
proposing a retry. Retain meaningful recovery details in the exception's
handling or optional notes, without inventing runtime guarantees.

Include in action conditions or material scope only requirements that matter
to the product, such as
authorized material, supported formats or access to a required capability. An
unknown prerequisite is a gap, not invented setup. Do not force SDK selection,
credentials, resource discovery or deployment details to complete the design.
These dimensions are optional: reason from evidence, not row or field counts.
Do not add standalone adoption, scope or resource-policy fields to repeat
what the action, exception or material definition already says.

## Resource slots leave the user in control

First propose a Skill/MCP slot: needed capability, activation/scope and editable
example content. Mark illustrative content as an example, not installed or
confirmed. Users may directly write or provide existing resources; manual
configuration is a full path, not a fallback that requires AI discovery.

Define these resources once in their own collections, then select references
from each Agent. A direct model call may also use a Skill. Resource reuse does not
share permissions, history or credentials: describe Agent-specific loading/use
conditions in the relevant action, material scope or complete prompt. Tool-specific
limits remain with the tool; do not duplicate those conditions in both places. A Skill catalog is not the full body being loaded;
an ordinary function tool is not MCP; an MCP skeleton is not a connected server.

For a Skill retain its complete Markdown body, source and referenced files,
including important methods, conditions and failure handling. Do not reduce it
to a routing sentence or silently replace user text with a recommendation.
`source` is optional acquisition provenance (such as a supplied repository or
local path); original content need not invent one. `resources` lists supporting
documents, templates or scripts actually used by the body, not generic citations
or a second source field. List locations without claiming files were uploaded,
downloaded or installed. When recommending a resource after an explicit request,
record its real source; preserve supplied source and file references on revision.

For tools lead with the required capability in `purpose`: what it enables,
what relevant information it uses and what useful result it returns. For example,
an explicitly illustrative retrieval capability can find passages in authorized
materials and return text plus source locations, without selecting an MCP server.
Use product language, not a required API signature. Tool references name this
capability even before its implementation is selected. Do not invent a function
tool, MCP choice, endpoint or configuration to make a product design look complete.
Leave `tool_kind` absent when undecided; interface/JSON are not prerequisites.

When the user supplies or chooses an implementation, retain complete function
`interface` input/output text or opaque MCP `config_json` in optional connection
details. Preserve all known content during reconstruction, even when the UI
starts with that group collapsed. Optional source and tool-specific
scope/confirmation/failure limits supplement it. Transport belongs to the
configuration, not a mandatory parallel setting. It is the only connection-parameter authority; purpose and
scope fields describe intent, not a second generated copy of those parameters.
Preserve arbitrary configuration keys when editing. Invalid JSON is an explicit
configuration gap, not evidence that a server is usable.

Only if the user explicitly asks to find resources may the owning host Agent use
available Skill/MCP discovery tools, inspect official sources and recommend a
fit. No discovery tool means report that limit, not invent a registry result.
Return candidates/configuration for user inspection; all content remains editable.
If nothing fits, retain the slot and its unknowns. Finding, choosing or saving a
resource never authorizes installation, connecting or invoking it.

## Shared model entries and knowledge resources

Read [the constellation guide](reference/canvas-guide.md) for the three-band
projection, single midpoint per direction and product-position presentation.
Use optional stable `model_sources` and `knowledge_resources` only when identities
are established or explicitly proposed in new design. Same names, runtime choices
or prose do not prove sharing. Reconstruction preserves actual shared identity
and reports missing information; revision never invents it to complete the view.

An Agent may select `model_source_ref` and independently describe an optional
`model_selection`. The source's `model_connection`, description and active existing
`integration_ref` own the shared connection intent. The Agent's retained
`model_connection/model_service/integration_ref` are then inactive; clearing
the source reference restores their applicability. Preserve their bytes; do not
auto-migrate or delete them. A stale or whitespace reference is a defect, not a
fallback request. Clearing the selector omits the optional reference.

The same entry can serve different selected models. A selected model is product
intent, not a resolved host model or live configuration. Leave it unknown when
not established. Integration records still own actual connection parameters;
no second credentials/settings client or mandatory integration Bundle is added.

An Agent's `knowledge_resource_refs` select independently identified knowledge
bases or long-term memory, classified by the target's `kind`. Definition sharing
does not share user data or access. For a knowledge base, `description` identifies
the material available for consultation, not a second Agent outcome. Optional
`source_and_maintenance` explains where material comes from, who can add/update/
remove it and what changes its availability. Do not invent automatic search,
refresh or indexing. `access_scope` describes relevant personal/project/team
boundaries, not an access grant. Consult the permitted current material and
retain source locations; missing or inaccessible material is an evidence gap.

For long-term memory, `description` identifies information worth carrying between
conversations, such as explicit preferences or accepted conventions, not an
entire chat transcript. Optional `formation_and_update` explains what creates
or updates memory, who decides and how conflicting/incorrect information is
handled. `user_management` describes viewing, correction and clearing, including
what later interactions do after clearing. Preserve observed behavior in
reconstruction; propose user controls explicitly in new design, not as already
implemented facts. `access_scope` identifies whose memory can be used or shared.
Ask about material uncertainty when it changes the experience; otherwise retain
it as unknown. These are product decisions, not storage/retrieval implementation.

`context` remains the Agent's authorized use/material scope and
`memory_retention` its update/retention/deletion policy. When a shared resource
describes common policy, supplement only actual per-Agent use conditions or
differences; without one, these existing Agent fields remain a valid design.
Neither text is a shared store identity. Conversation history, reference materials
and long-term memory are distinct: a history screen does not prove semantic memory.
Changing `kind` hides inapplicable fields but retains all text; legacy broad
descriptions are not automatically split or treated as confirmed new policy.
Omit mechanisms the job does not need.
New maps and references are optional and add no completeness requirement.

## Design model connection without collecting credentials

When no shared model_source_ref is selected, use optional `model_connection`
for one product decision, without choosing an SDK:
- `runtime`: the product will provide a model API settings entrance; the user
  supplies model settings when using it. No connection parameters are needed here.
- `existing`: describe the intended service/configuration plan in `model_service`,
  or select a real existing `integration_ref`. A selected integration owns its
  connection configuration; do not duplicate it. Local text may explain extra
  product intent, not conflicting parameters. Surface contradictions for review.
- `other`: explain the arrangement freely in `model_service`, for example using
  the intended product user's already-configured local model access.

Leave an unknown choice absent; never infer it from the designer's environment.
The model connection tab records design, not working runtime settings. Optional
plans may include an existing company service, official/third-party/local
preference, required modalities or a material data/access boundary. Keep actual
behavior restrictions with the relevant action/context, and supplementary details
in notes, rather than repeating the same requirement. A template is optional;
there is no mandatory model selector, URL, protocol, key or deployment setup form.
Real keys are supplied when using the product, never in Design Files; use only
placeholders such as `${MODEL_API_KEY}`. Do not copy local credentials or probe a
connection. If no real integration exists, leave its reference unset; do not invent
one or force the user to create it here. Switching choices preserves `model_service`
and `integration_ref`, but hidden values are inactive under the selected approach.
Existing text without a choice remains unchanged until an explicit revision.
A service choice does not establish authorization or a working connection, and
the designer's coding-host login does not establish the product user's access.

Use [the bounded runtime guide](reference/runtime-guide.md) only if the user
actually requests technical comparison. For that optional discussion, preserve
which version supplies which behavior, what the app must implement, Skill/MCP
adaptation, deployment/auth terms and unknowns. Do not present a low-level
library, local subprocess and durable graph runtime as identical harnesses.
Product design must not require choosing an SDK; meaningful technical decisions
may remain in notes, not another parallel selector. Existing `harness` and
`model_access` values remain valid historical input, never inferred or cleared
by the Panel. Do not probe endpoints or copy authentication to fill a design.

Never store secret values in prompts, URLs, headers, MCP configs, previews,
evidence or logs. Use environment/Secret references only. Check URL userinfo/query
and configuration as well as visible credential fields. Runtime/model design does
not reconfigure the coding host or introduce another model client.

## Context, authority, recovery and a representative test

Explain the information supplied to every unit and its user/data boundaries.
Describe input/output sources and expectations, not one concrete test input.
A freely conversational Agent receives the current user message and authorized
attachments/material/history; do not demand a fixed input template.
Separate reference knowledge from cross-conversation long-term memory: what
material may be consulted, what preferences or conclusions may persist, and
their access/update/deletion expectations. These are optional product requirements
for any runtime. For an existing runtime, do not require users to redesign its
context window, history compaction or retrieval implementation. A self-built
Harness may record meaningful technical choices in notes. Choose no durable
memory when the job does not need it.
Distinguish intended tool access from enforced permissions; describe meaningful
approval points, timeout/budget/stop, cancellation, retry/idempotency and manual
takeover without promising a mechanism that the chosen runtime lacks.
When units collaborate, use optional `collaborations` rows with a local `agent_ref`
or free-text `external_target`, plus `condition`, `handoff` and `result`: name the particular target, when to hand off,
the task/material it receives, returned result and failure ownership. Do not
copy a single global handoff into every target. The graph projects these same
rows, not a separately maintained list of edges. Sub-Agents use the same
Agent design dimensions; no extra orchestration system is required. Name external
task/host targets in the same row's `external_target`, not invented local Agent
records or graph nodes. A nonempty `agent_ref` is the current target; external text
is then retained but inactive. A stale or whitespace reference still fails the
local-reference check, even if external text exists; never silently clear it.
The user may explicitly clear the local selection to restore the external target.
Unspecified targets remain editable drafts. Preserve any older `external_delegation`
text in saved data and summaries; only organize it into rows during an explicitly
requested revision, retaining its meaning, handoff and failure requirements.
Retain meaningful execution/recovery notes. References do not imply actual
delegation, inheritance or execution. Do not infer a multi-Agent coordinator just
because several units exist.

Check the design against representative input/expected-result tasks and important
negative cases: unsupported attachment, missing evidence, denied tool, unreachable
service, invalid output. They are design examples, not executed evaluation results.
Formal acceptance belongs to `quality_acceptance` (optionally grouped as AI
behavior), not another test-case form in this Bundle. Discuss or hand off relevant
scenarios; do not automatically write that Bundle or require running it first.
Shared rules/access/data stay with their existing owners.

## Revise, validate and return evidence

Read saved state before revising. Preserve unaffected Agent IDs, resource
keys, complete text/configuration, references and decisions. Changing tabs or
visibility never erases hidden configuration. Earlier optional fields remain
readable in the raw file; do not migrate, discard or manufacture them on open.
When explicitly revising old content, relocate each meaning to the relevant
new field, retain original source pins and update any local `subject_pointer`
only when its subject actually moved. A conflict stays explicit, not silently merged.
Deletion removes only the explicitly selected record, never its shared resources
or referencing Agents. Unlink references before deleting a used resource; invalid
local Skill, Tool and Agent collaboration references must be repaired before
saving. For optional external `integration_ref`, select an existing integration
and check an unresolved selection without discarding it; this Bundle's local
save rules do not verify external target existence. The graph projects these same references
and opens their original records, not an independently editable graph copy.
Assess an already saved
user diff rather than replaying it.

New proposals, observed implementation, successful calls and user decisions must
remain distinguishable in evidence. This is an unreleased first capability;
do not add a migration or multi-version system to complete it.

Validate the full AI state with the host's actual validation tool, repair all
schema/state/completion diagnostics in this WorkingCopy, then publish through the
existing scoped entrance and honor `must_edit`. A useful handoff names what the
Agent will do, what the user can change, and material unknowns. Mechanically valid
state, a preview or a published design is not native Agent execution, resource
installation, a successful model call or an optimized prompt.

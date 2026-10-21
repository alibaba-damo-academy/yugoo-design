# AI design cooperation

Read this when an AI design depends on or changes another design slice. It is
shared by ordinary design and reconstruction. It supplements the
[output contract](artifact-contract.md), not the host's execution/permission rules.
Design-Bundle cooperation here is not the product's Agent `collaborations` list.

## Keep each fact with its owner

AI owns responsibilities, triggers, complete instructions, Skill/tool needs,
knowledge/memory use, behavior rules, exceptions and per-Agent handoffs. Related
Bundles retain their existing canonical facts. Read only relevant current project
facts through the host's permitted project-reading tools; unavailable facts stay
unknown. Saved user decisions take precedence over older suggestions, not over
different source facts without an explicit revision.

| Related owner | Check when relevant | Minimal information to return to that owner |
| --- | --- | --- |
| `function_modules` | The Agent introduces or changes a user task, action, adoption or recovery path | User goal, trigger, useful result, confirmation/write behavior and failure/takeover. Link a real existing function when known; do not turn prompts/resources into duplicate functional requirements. |
| `page_design` | AI needs a chat, button/menu, progress/result surface or conversation-history experience | Real placement, entry/return path, permitted attachments/voice/image modes, progress/error/stop and how the result is used. Specify history only when needed or observed: what users can revisit/manage, without equating it with long-term memory. Page owns layout and artifacts. |
| `smart_questions` | Uncertainty about knowledge, memory, triggers or user controls materially changes the design | Focused unanswered product questions and the evidence gap, not a prefilled answer. For knowledge ask about content/source/maintenance and sharing; for memory ask what persists, who confirms updates and how users correct/clear it. Use an accepted existing answer when present. |
| `integration_design` | The design chooses an existing model service or another product integration | Intended capability/service, data boundary and what the product must exchange. Reuse a real integration ID when available; parameters of that actually referenced integration belong to its owner. AI tools retain their supplied `interface`/opaque `config_json` under this Bundle's contract: external/MCP alone does not transfer configuration ownership or imply an integration reference. Product-time model configuration needs no invented existing integration, endpoint or credentials. |
| `quality_acceptance` | AI outcome, action safety, missing evidence or user control needs acceptance coverage | Observable success and important negative cases tied to an actual responsibility, not claimed evaluation success or another AI test-case authority. |
| `business_data`, `role_access`, `business_rules`, `flow_design` | Persisted history/material/memory, sharing/access, shared constraints or cross-step workflow changes | The specific object/state, user scope, invariant or handoff that needs alignment; those owners design shared data, permission, rules and flow. Do not prescribe a database, invent a role or expand permissions from an AI reference. |

This is a conditional checklist, not a required sequence. An absent or unmounted
Bundle is not an error that forces installation or execution. The caller may
ask the user through available host interaction, retain a stated unknown, or
use an available owning Bundle when authorized. Searching for Skills/MCP still
requires the user's explicit request; this guide does not authorize discovery.

## Read, compare and return a bounded handoff

1. Start with the current request, saved AI state and directly relevant project
   facts. Distinguish observed behavior, accepted user choices, proposals and
   unknowns. During reconstruction recover only evidenced existing behavior;
   this guide's checks do not authorize adding missing product features.
2. Match existing records by actual IDs and meaning, not just equal display names.
   Preserve exact source revision/pointer metadata already recorded. Never guess
   an ID, overwrite a historical pin or create duplicate owners to complete a view.
3. Identify only real gaps or contradictions. Describe the AI record/entry affected,
   target owner and existing target ID if known, evidence location/revision where
   available, and the smallest proposed supplement or question. Include conflicting
   decisions and unknowns; do not silently resolve them by copying one side.
4. This executor writes only its current Bundle. Return the coordination findings
   to the caller at the existing result/handoff boundary. Do not call another Bundle
   from an isolated Producer, mutate its files with shell/fs tools, or bypass
   `must_edit` to advance a chain. The main/calling Agent decides the next relevant
   step under current user authorization and invokes the target's existing entry;
   that target validates, publishes and hands back its own state.
5. Before the caller applies a later supplement, reread the affected target state
   and current user edits. Reuse actual IDs, preserve unrelated fields and avoid
   applying a saved change again. After any authorized target settlement, compare
   the actual saved facts/references with the AI requirement. Report pending work
   separately; a suggested supplement or tool result is not proof of durable save.

Use an ordinary result message; do not invent a cooperation status schema,
automatic scheduler or an independently maintained cross-Bundle graph. Existing
local reference validation still rejects missing local resources. Optional external
`integration_ref`/`function_refs` do not gain cross-file existence enforcement from
this guide; check actual targets when available and retain unresolved selections
for review. The host owns callable tools, credentials and execution scope.

## Example, not project facts

A proposed reading assistant consults a user's selected papers and may remember
explicit reading preferences. Its AI records describe permitted materials,
source use, memory confirmation and clear behavior. If those choices introduce
new product work, return separately: a reading task/adoption path to Function,
the actual chat/history controls to Page, unanswered memory choices to Questions,
a selected external service to Integration, and evidence/no-access/clear-memory
cases to Acceptance. Do not create history, persistent memory, external services
or all these target records merely because this illustrative assistant has them.

---
name: function_modules
description: |-
  - **Capability**: organize the product into user-facing function cards.
  - **Resolves**: S gaps by turning an established product goal and core scenarios into a non-overlapping capability map.
  - **Candidate when**: the outcome, primary users, and material boundary are established, or the user explicitly asks to split or revise functions.
  - **Do not infer**: an app category, domain name, or generic product goal is not enough evidence to invent a function map.
  - **Output**: a function-module panel grouped by Epic for browsing.
---

# Function Modules

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Ownership and tools

`function_modules/function_modules.json` is the only canonical state. The
active executor (main Agent or Producer, selected by execution.mode) uses project-scoped `list` and `read_design_file` to inspect the current
map, GROUND, and relevant Design evidence. It uses `write` or `edit` to maintain
the complete function map in its owned WorkingCopy. Placement does not change
ownership, the schema, or optional Worker artifact boundaries.

Before authoring, read [the output contract](reference/artifact-contract.md).
It covers the optional structured local details and pinned source references.

Before publication, the executor calls `design_validate`. It repairs every
schema or declarative validation diagnostic in the same WorkingCopy, repeats until valid, then
calls `design_publish({action:"complete"})`. A panel save already persists the
user's card edits; later runs read and preserve those edits.

## Maintaining existing design

The saved `function_modules` state is the authority for the current module
map. When it already contains material functions, this skill maintains that
map rather than creating a second "refine" route or a replacement document.

- Read the current state before a material revision when the relevant module,
  Epic, priority, local details, references, or rejected status is not already in the
  current design context.
- Preserve unaffected Epic/function IDs, order, descriptions, priorities,
  local details, references, and `rejected` records. A function rejected by the user
  remains visible as rejected; only a truly removed function disappears.
- For any add, split, merge, rename, reprioritisation, rejection, or
  description refinement of an established map, produce the complete updated
  state and preserve every unaffected card and nested detail/reference key in the executor's WorkingCopy.
- Never recreate an existing map merely because the user asks to refine it.

## When to use

Use this skill when the product goal is understood but the user-facing capabilities are not yet enumerated, or when the user wants to add, split, revise, accept, or reject functions. Do not use it to model infrastructure or to create a separate Epic entity.

## Derive capabilities from outcomes

Start from the established user's situation and intended result, then trace
the smallest meaningful journey that achieves it. Derive the capabilities
needed along that journey; a competitor's feature list or a set of screens is
not itself a reason to include them. For each proposed capability, explain who
uses it, what it enables, and why that matters to the current scope. Put the
concise behavior summary in `function_description`. Use `reason` (shown as Notes)
for the proposal's basis, design rationale, tradeoffs, supplementary context or
unresolved points. Keep core behaviors, inputs, outcomes, boundaries and exceptions
in their own detail fields, not in a long Notes field. Use optional `details`
for grounded local specifications, not a story
collection, discovery database, roadmap, or a second shared product definition.

Check granularity by user purpose: independent user outcomes may deserve
separate functions; buttons, fields and steps of the same capability usually
do not. Group related capabilities into Epics only after their purposes are
clear. Walk a representative journey through the map to find a missing link
or two cards promising the same result.

Prioritize by contribution to the agreed outcome and dependencies, not by
competitor prevalence or giving every card High. When a consequential solution
choice is genuinely open, explain the alternatives and their tradeoffs rather
than include both by default. External evidence supports a proposal; it does
not establish that this user needs or has accepted it.

"Complete" means complete for the agreed scope, not every conceivable future
use. For a personal reading tool, collecting an article, finding it later and
retaining useful notes can form a journey without team invitations or approval
flows. The example is not a mandatory feature set. Respect deferred scope and
preserve existing confirmed functions; reducing scope requires user direction,
not an automatic minimalist rewrite. Detailed flows, policies and acceptance
specifications remain with their owning facets.

## Deepen only what helps the user judge the capability

Reuse the user's existing concrete situations and answers as evidence. Do not
start a new interview just to fill detail fields. Explain a proposed function
through who encounters the situation, what they can do, and what useful result
changes; a hypothetical example is a proposal, never user confirmation.

Where supported, use one `details.situation` usage scenario to explain who uses
the capability, in what circumstances and for what useful outcome. It combines
purpose and situation without repeating the card's capability summary. Add core
behaviors, inputs/results, limits, and exception handling using the contract's
stable-key maps. These are
optional dimensions, not a checklist for every card. Unknown facts remain
absent; don't write six empty sections or make completeness depend on counts.
Local examples and observable conditions belong here even if testable. Full
cross-functional flows, shared rules/access/data, and formal acceptance retain
their existing owners; cite real records instead of duplicating their authority.

Use `references` only when a source really exists in this project's Design Files
at an exact commit. Keep target file/pointer/revision separate from the optional
subject_pointer in the current function. Preserve historical provenance but
reconcile later user intent against current source facts. Positional array
references are historical evidence only, never guessed current identity.
Missing upstream records do not force another Bundle or prohibit known local
behavior. Omit unsupported references rather than invent one.

Only during an explicitly authorized upgrade of old split purpose/situation
data, use the conversion described in the output contract. Preserve both texts,
all other fields and source pins; do not silently upgrade an active project.

When authorized shared specifications later replace local ones, update the owner
through its ordinary authorized path before replacing duplicate local norms with
references. Similar text alone grants no cross-Bundle write authority. Preserve
function-level explanation and history. Renaming keeps IDs; splitting/merging
requires deliberate reference repair, not regeneration of the whole map.

At handoff, name the material change and one concrete user consequence, with a
necessary decision only if one remains. An optional derived experience can help
the user judge established behavior; describe the relevant scene to the main
conversation, not a forced next Bundle. Never generate an unrelated scene or
modify another owner from this invocation, and don't require a story view.

## Close-out evidence

Close only after the active function map and any accept/reject decisions are persisted. A confirmed map primarily adds S evidence by establishing a complete, non-overlapping product skeleton. It can improve U when explicit functions settle the product boundary, and T only to the extent that descriptions make expected user-facing behavior reviewable. Report the persisted evidence behind those changes; card count alone adds no clarity.

### Typical evidence guidance

- Assess U/S/T only from persisted evidence using the shared Host rubric; no fixed increment follows from running this Bundle or filling optional details.
- Rejected functions count only insofar as their rejection clarifies the active product boundary; they do not add score merely by remaining visible in the rejected view.
- A draft with overlapping functions, missing user-facing descriptions, or unresolved module scope may leave scores unchanged or lower them.

## Output contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

# AI Agent constellation — canvas guide

This Bundle-owned reference records the user-confirmed three-layer canvas.
It is shared by ordinary design and reconstruction through the output contract.
The loaded schema, validation and component catalog determine supported fields
and interactions. This guide is not another schema, an executable renderer, a
runtime installer or evidence that a published package implements the canvas.

## 1. Facts and sources

Use the actual `ai_agent_capabilities/ai_agent_capabilities.json`, the accepted
save diff when supplied, and relevant explicit user decisions. Read only the
missing bounded evidence. A saved diff is already applied; never replay it.
Preserve stable IDs, complete prompts/Skill bodies/configuration, source pins,
unaffected records and inactive historical fields.

For new design, identify each useful responsibility, its product entry, inputs,
result and authority before proposing resources. A direct model call is a valid
bounded unit; do not invent a loop, tools, Skills or durable memory to fill its
anatomy. For reconstruction, restore observed responsibilities and references;
the diagram style does not authorize improving the product or guessing missing
mechanisms. For revision, reconcile only the affected facts and their projection.
Use the existing professional method for evidence, instructions, actions,
exceptions, discovery and model-service intent; this reference supplements it.

## 2. Nodes and relationship meaning

An Agent card represents a responsibility/outcome, not a live process. The
human-like metaphor explains its parts without asserting sentience or execution:
model selection is its reasoning center, Skills are methods, tools/MCP enable
actions, and knowledge/long-term memory supply information with different uses.

Every domain node resolves to a canonical identity. Internal-view resource
containers are transient presentation groups, not additional canonical records;
each member still resolves to its original identity. Resource edges represent
explicit use; Agent-to-Agent edges represent explicit collaboration/handoff.
Group frames organize the view, not ownership, permissions or execution order.
Resource reuse does not share authorization, credentials, conversation history,
write access or retention policy. A shared model **entry** is not one model:
different Agents may choose different models through the same entry.

Use current `skill_refs`, `tool_refs` and `collaborations[*].agent_ref` as
declared, including their conditions/handoff/results. Multiple collaboration
rows with the same endpoints remain separate facts, even when a renderer bundles
their stroke and expands the rows in details. Do not replace them with a single
generic relationship. Legacy `delegate_refs` stay readable, not a new authority.
An external collaborator's text does not create a local Agent node. Invalid
nonempty local references remain diagnostics, not a guessed external fallback.

## 3. Groups and layout

The constellation overview has three stable semantic bands:

1. Top: model-access entries. Group Agents by an explicitly resolved entry
   identity; draw one entry node per identity, not per Agent or selected model.
2. Middle: Agent cards. Keep members of one entry group together; an unknown
   entry stays visibly undecided, not merged into a fake common provider.
3. Bottom: knowledge bases and long-term memory. Render one node per explicitly
   identified resource, connect all actual consumers and distinguish the two
   categories. Similar text is not identity or proof of a shared store.

For a selected Agent's internal view, preserve the same meaning at smaller scale:
model entry at the top; selected model at the center; Skills on the left;
tools/MCP on the right; knowledge and long-term memory at the bottom. A selected
model without an explicit field remains unknown, not parsed out of prose.
An absent mechanism is omitted or clearly unconfigured; do not fabricate it.
The overview and internal view read the same records; neither stores a second
resource map or edge list. Keep the Agent name, responsibility and product
position visible without opening a configuration form.

In the internal view, use one connected Skill container and one connected
tools/MCP container, only for populated sides. Inside each container, display
the actual resources as compact, individually selectable mini-cards with their
name and a short capability summary. A mini-card has no independent port or
edge; selecting it identifies that exact original record without leaving the
focused Agent. Bound the list and scroll it locally when needed, rather than
growing the entire constellation with every resource. Do not merge same-name
members, drop references, or make a container alias its first member. Grouped
strokes retain all actual reference identities; view counts are not new facts.

Use measured text/node bounds, consistent alignment and shared Panel tokens.
Do not force fixed pixel coordinates, one card per database object, a tiny font,
or a fixed resource count. Grow/scroll only the canvas region as required;
details may stack below it in a narrow container. Selection should make a
resource's consumers and an Agent's relevant neighborhood easy to inspect.
Dense genuine relationships need readable focus, not a promise of zero crossings.

## 4. Ports, routing and labels

For this AI constellation, each node has **at most one attachment point per
direction**, at the midpoint of its top/right/bottom/left side. Several edges
using one side attach to that same point and branch outside the node. Do not
offset their actual endpoints along the side, add hidden duplicate ports or
only remove the extra visible dots. Directions are available for real
collaboration; they do not create four mandatory relationships.

Hide these real ports in the read-only internal view and disable manual
connection/drag/delete operations. Keep their measured geometry registered for
routing; do not unmount them or hide them with `display:none`. Invisible ports
do not imply connection editing is available. This presentation rule does not
hide ports in other editable canvas types.

Route model access toward the top and knowledge/memory toward the bottom.
Use left/right or an external return corridor for collaboration where useful;
avoid unrelated card bodies and label text. Measure bounds again after resize,
text changes or layout changes, and update endpoints with the node geometry.
Labels explain relationship type and direction; colors or arrows alone do not.
Put labels in clear space and keep complete conditions in the same-source detail.
Bundled paths must not merge distinct resource identities or collaboration facts.
This midpoint rule is AI-specific, not a replacement for BPMN or native
Excalidraw binding/attachment rules.

## 5. Missing facts and field mapping

The optional shared-resource fields in this Bundle support the following mapping.
Always check the loaded schema:
older pins lacking these fields cannot accept them merely because this guide
describes them. The renderer also needs the declared hub layout; adding fields
alone is not proof that the three-band canvas is implemented.

| Canvas information | Canonical source | Boundary |
| --- | --- | --- |
| Agent identity/name/job | `agents[id].id/name/description` | Stable map key equals ID; name is not identity. |
| Product entry/position | `entries[entryKey].name/trigger/location` | Retain all entries and stable keys; not a model entry. |
| Skill / tool / MCP | `skill_refs` / `tool_refs` and original resource records | Tool kind may be undecided; do not infer MCP from its name. |
| Local collaboration | `collaborations[stableKey].agent_ref/condition/handoff/result` | Preserve every row and failure meaning; no invented execution. |
| Shared model entry | `model_sources[id]` plus Agent `model_source_ref` | Stable ID, not display name or connection method; omit when unknown. |
| Shared-entry connection intent | `model_sources[id].model_connection/description` | Optional intent, not gateway parameters or a verified runtime. |
| Model choice inside one entry | Agent `model_selection` | Optional model intent, not a resolved model; different selections may share one entry. |
| Per-Agent fallback | Agent `model_connection/model_service/integration_ref` | Applies only without a selected `model_source_ref`; preserve inactive values. |
| Existing service reference | Active `existing` plus the applicable record's real `integration_ref` | The integration owns configuration; unresolved refs remain visible. |
| Shared knowledge/memory | `knowledge_resources[id].kind` plus Agent `knowledge_resource_refs` | Kind is `knowledge_base` or `long_term_memory`; no name/prose merging. |
| Authorized knowledge/context | Agent `context` | Agent-specific access/use policy, not shared store identity. |
| Retained long-term information | Agent `memory_retention` | Agent-specific retention/update/deletion policy, not shared store identity. |

Full shared-entry/knowledge/memory nodes require the optional identities
and Agent references above. A selected model source owns connection intent;
retained Agent connection fields become inactive, not deleted or migrated.
Explicitly clearing the selector omits the optional reference and restores the
original fallback's applicability. A dangling, whitespace or empty-string ref
is not a clear operation and must not silently fall back. The initial proposal
name `connection` was superseded by `model_connection` before implementation,
so shared forms can reuse the same semantic control without a migration.
Do not add prototype-only `entry`, `model`, `knowledge`, `memory` or `page_ref` properties
to closed canonical records. Do not create mandatory gateway settings, copy
integration parameters, or require another Bundle before authoring this one.
When older pins lack the extension, show honest per-Agent intent/unknowns and report the missing
renderer/schema capability; that limited view is not the full accepted canvas.

Show a brief product position on the card/internal title and all product entries
in the original detail form. The right-hand inspector is a compact summary,
not that complete form: show at most two entry names and locations, with an
additional-entry count when needed. `conversation` means the chat entry position; `action` means the
dedicated control's position; `background` means event/timing/conditions, not
a fabricated page. Missing entries/location stay unknown. A count such as
`+1` means another entry, not another Agent or port. `auto_context` and feedback
remain available in the original detail form, not duplicated in the summary.
No exact Agent-to-Page reference exists here:
location text grants no page jump, and pinned evidence references are not
navigation links. Preserve legacy functional links without reactivating them
as a competing position authority.

## 6. Interaction and saving

The initial constellation is a read-only projection with navigation into the
existing original-record editor. Choosing a node, edge, band or view never
changes design facts, materializes empty resources or clears hidden fields.
Support keyboard selection, visible focus, discoverable details and accessible
selection labels; do not require hover or color to understand a relationship.
Keep resource and collaboration layers distinguishable, with honest controls
only where the installed renderer implements them. Escape user text.

Put the Agent-internal/return action and original-record detail action directly
below the selected Agent's identity in the right inspector. Follow them with
only a short responsibility summary, selected model, product positions and
resource counts; full prompts, entry conditions, feedback and handoffs remain in
the original form. A selected resource exposes its actual brief and consumers,
plus its original detail action, not a fictional Agent-internal action. Selecting
a resource mini-card changes selection only; neither selection nor opening the
original form copies, shortens or writes its canonical definition.

Graph and form use the same canonical state and existing validation/atomic
save/reopen path. Do not add executable graph coordinates, layout-only model
records, graph edges, runtime IDs or logs to this contract. Explicit future
editing requires declared same-source bindings, not private canvas persistence.
Source edits do not update active content pins or installed packages. Saving
does not install/connect resources, invoke a model, prove permissions or run an
Agent. Ongoing GRA is separate background work, never a foreground dependency.

## 7. Positive/negative examples and review

Read [the synthetic contract example](agent-canvas-example.json) for legal
pre-extension fields, not user facts. Three Agents illustrate shared Skill/Tool refs,
multiple product entries, background timing and explicit local collaboration.
Its identical context/memory strings deliberately **do not** establish shared
stores. It supplies no fabricated model-entry/model IDs. It is not a runtime
initializer, a second Studio preview authority or evidence of live execution.
The target contract's [small example](example.json) and sole
[Studio preview](preview.json) include explicit shared model and knowledge identities.
They preserve full old instructions and opaque
configuration; selecting the shared source makes old model intent inactive, not
lost. The bounded title-only unit still has no fabricated knowledge/memory refs.

Positive review: follow one explicit shared resource to all and only its
consumers; inspect every condition of two same-endpoint collaboration rows;
confirm card position and full multi-entry details agree; rename an Agent and
check both views keep its identity. When optional shared identities are supplied,
also review one entry serving two different model selections and one genuinely
shared knowledge/memory resource. These are representative decisions, not a
mandatory number of Agents/resources.

Negative review: same-label resources with different IDs never merge; the same
`runtime` choice or same prose never implies sharing; inactive retained
`integration_ref` values never form a live-entry edge; missing references remain
diagnostics; absent memory creates no node; background events create no page;
unresolved selected collaborators never fall back silently. Protect original
Skill bodies/configuration and unrelated entries during local revisions.
For internal grouping, also check multiple and same-name members, selecting a
non-first member, missing/deleted members, empty sides and return to overview:
grouping must retain identity and diagnostics without leaving synthetic ghosts.

Check actual endpoint coordinates as well as visible port counts, label/card
overlap, resize, long names, narrow-container scrolling, keyboard focus and
safe text rendering. With supported editing, save once, inspect the durable
diff and reopen; never replay the saved diff. Run the actual schema/reference
checks separately from visual review. Without a real view or host, report
unverified rendering/generation rather than claim that these written rules
guarantee model output. Report loaded-resource reachability, generated content,
rendered interaction, save/reopen, native consumption and installed-package
results separately. Repair only the failed owning slice.

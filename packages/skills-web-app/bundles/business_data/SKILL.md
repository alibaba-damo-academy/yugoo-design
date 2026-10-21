---
name: business_data
description: |-
  - **Capability**: define the durable business things a Web App remembers, the information kept for each thing, user-visible states, and grounded associations or subtype inheritance between object types.
  - **Resolves**: S/T gaps where users must find, distinguish, update, or track lasting things but their meaning and information are unclear.
  - **Candidate when**: the product must remember the same business thing across actions or visits, or the user asks what information or custom fields to keep.
  - **Do not infer**: pages, actions, workflow steps, reports, filters, database tables, API payloads, and state-change behavior are not business things. Type relationships belong here; workflow transitions and instance provenance do not.
  - **Output**: a native `business_data` panel with ordered business things, information fields, optional states, and one relationship model shared by the form and canvas.
---

# Business Objects

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Define what lasting things the product remembers, what information belongs to each thing, and which current situations users must recognize. This skill owns business identity, plain-language meaning, local information fields, optional state names, and grounded relationships between object types. It does not own actions, transitions, permissions, layouts, integrations, or storage design.

## Ownership and tools

`business_data/business_data.json` is the only canonical state. The active executor (main Agent or Producer, selected by execution.mode)
uses project-scoped `list` and `read_design_file` to inspect that state, GROUND,
and the smallest relevant Design evidence. It uses `write` or `edit` to maintain
the complete business-data model in its owned WorkingCopy. This lightweight
skill needs no Workers; execution placement does not change its canonical ownership.
Read [the output contract](reference/artifact-contract.md) before authoring and
[the example](reference/example.json) when needed. Resource paths are relative to this
Bundle's installed resource root, never a guessed development checkout.

Use the current Host adapter's actual validate/publish or main-Bundle finish tools.
In DSH, for a proposal that requires panel review, the executor runs `design_validate`,
repairs every schema or declarative validation diagnostic in the same WorkingCopy,
and repeats until valid. It then calls `design_publish({action:"handoff"})` to publish the
canonical state before the review gate. A panel save already persists the
user's edits; later runs read and preserve them.

## Maintaining existing design

The saved state is authoritative. Preserve unaffected object, field, state, and relation IDs, content, and display order. For any addition, rename, merge, reordering, or removal, maintain the complete updated state in the executor's WorkingCopy, including the complete replacement order list whenever membership or order changes; a removal drops the object, field, or state from the state and from its order list. Renaming changes the visible name, never the stable ID. Relation endpoints use those IDs. Removing an object removes its incident relations in the same replacement state; removing a relation never removes its objects. Splitting/merging types requires deliberate endpoint repair. Preserve unknown quantities and inherited field ownership; don't fill defaults merely because a dropdown offers them. A panel save already persists user edits.

## Prerequisite evidence

This Bundle deepens established capabilities and journeys from `function_modules` and `flow_design`. Treat their persisted records as references and never copy them into a parallel function or flow model. When either source is absent, keep only business things grounded by the current request and visible design evidence; do not invent downstream completeness. The user may explicitly authorize reasonable assumptions, but unsupported decisions remain assumptions rather than facts attributed to another Bundle. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted business things with the available `function_modules` and `flow_design` evidence. Repair one deterministic issue owned by `business_data` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real product decision is required. If an upstream Bundle or record is missing, malformed, or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when users create, receive, search for, compare, update, or refer later to the same business instance. Apply the persistence test: an order may qualify; submitting an order, an order page, an approval step, and a monthly report do not.

Keep neighboring concerns with their owners: capabilities with `function_modules`, handoffs and transitions with `flow_design`, conditions and calculations with `business_rules`, permissions with `role_access`, interactions with `page_design`, and exchange/recovery with `integration_design`. Do not invent database types, foreign keys, indexes, audit columns, or technical timestamps.

## Workflow

1. Collect candidates from established user scenarios.
2. Keep only things whose identity must persist over time; merge synonyms and split only independently identifiable things.
3. Give each object a singular user-facing name and one-sentence business meaning.
4. Add the minimum information users must recognize, enter, compare, search, decide with, or exchange.
5. Give every field a user-facing name, meaning, natural value form, requirement, and only a useful example.
6. Add states only when users must see the current situation or product behavior depends on it. Store a fact-like name and meaning, never transitions or actions.
7. Remove pages, actions, rules, permissions, technical helpers, and speculative completeness fields.
8. Add an association only when a real scenario needs it. Give it a readable verb
   and explain identity/ownership or deletion implications when evidenced.
   Define the quantity in each direction only when supported; otherwise omit
   that quantity and describe the open decision rather than guess a maximum.
9. Use generalization only for “this type is a kind of that type”: connect
   subtype `source` to parent `target`. Shared definitions and fields remain at
   their parent; store local additions at the subtype. Multiple inheritance
   is permitted when coherent. Cycles and self-inheritance are invalid.
   Composition, instance membership and “generated from” are not inheritance;
   use an association with an explicit meaning or leave unresolved.
10. Walk a concrete usage situation through the types and both relationship
    directions. A user reads “one project may reference multiple papers; one
    paper may belong to multiple projects”, not cardinality notation alone.
    Self-associations can be legitimate, for example task-to-task dependency.
11. Preserve stable IDs and exact object/field/state order lists, then validate
    and repair every completion issue. Never persist canvas positions,
    collapsed state, UI selections or an OWL document in this JSON.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Close-out evidence

Close only after important business things have understandable boundaries and the smallest information set needed by established scenarios, with every completion issue repaired. Assess U/S/T from persisted evidence under the shared rubric, without fixed increments. Explain which boundaries or relationship decisions became understandable and what remains open. Item count, speculative fields, and database dumps add no clarity.

## Interaction gate

After producing a valid proposal, present the native panel and pause for the user to review and save it. Explain one material modeling choice in ordinary language. The form holds object details; the canvas shows types and relationships, with hover details returning to that object's form. Do not demand a full ontology, all possible relations, or completion of unrelated Bundles. Do not self-confirm the shared object vocabulary or rewrite a successful panel save.

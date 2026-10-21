---
name: business_rules
description: |-
  - **Capability**: turn product decisions into independent rules that name relevant conditions or inputs and deterministic outcomes.
  - **Resolves**: S/T gaps where reasonable implementations could differ without a qualification, validation, calculation, threshold, automation, or exception.
  - **Candidate when**: an action, business thing, flow branch, price, limit, approval, or eligibility decision needs deterministic behavior.
  - **Do not infer**: ordinary step order, role permission, field definition, page layout, UI copy, and technical implementation are not automatically business rules.
  - **Output**: a native `business_rules` panel with an ordered list of editable rules.
---

# Business Rules

Define what the product must consistently decide or do, under which condition or based on which information. This skill owns independent, reusable product decisions and constraints; it does not duplicate the structures of functions, business data, flows, permissions, pages, or integrations.

## Ownership and tools

`business_rules/business_rules.json` is the only canonical state. The foreground
Producer uses project-scoped `list` and `read` to inspect that state, GROUND,
and relevant Design evidence. It uses `write` or `edit` to maintain the complete
rule set in its owned WorkingCopy. This lightweight skill is completed directly
by the Producer.

For a proposal that requires panel review, the Producer runs
`design_validate({outcome:"pause"})`, repairs every completion issue, and calls
`design_publish({action:"handoff"})` to publish the canonical state before the
review gate. A panel save already persists the user's edits; later runs read and
preserve them.

## Maintaining existing design

The saved state is authoritative. Preserve unaffected rule IDs, wording, notes, and order. After a material rule set exists, maintain the complete updated state for any change in the Producer's WorkingCopy, including the complete `rule_order` whenever membership or order changes; a removal drops the rule from the state and from the order list. Renaming changes `title`, not `id`. Split rules with independent outcomes and merge only duplicate decisions. A panel save already persists user edits.

## Prerequisite evidence

This Bundle deepens established capabilities and journey decisions from `function_modules` and `flow_design`. Use their persisted records as references and never copy them into a parallel function or flow model. When source behavior is absent, keep only rules grounded by the current request and visible design evidence; do not manufacture conditions or outcomes to fill the panel. The user may explicitly authorize reasonable assumptions, but unsupported decisions remain assumptions rather than facts attributed to another Bundle. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted rules with the available `function_modules` and `flow_design` evidence. Repair one deterministic issue owned by `business_rules` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real product decision is required. If an upstream Bundle or record is missing, malformed, or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when behavior would otherwise be ambiguous: qualifications, validations, formulas, thresholds, routing decisions, automatic actions, and exceptions. A rule must be independently checkable. “The user clicks submit” is an interaction or flow step; “orders over 100,000 require manager approval” is a business rule.

Keep sequence and handoffs with `flow_design`, permissions with `role_access`, information definitions with `business_data`, controls and feedback with `page_design`, and external exchange/recovery with `integration_design`. Never invent regulatory, financial, organizational, approval, pricing, or risk policy.

## Workflow

1. Find behavior for which two plausible implementations could differ.
2. Give the decision a short recognizable title.
3. Record the triggering condition or input information; leave it empty for an unconditional rule.
4. Write one deterministic outcome: what the product decides, calculates, allows, prevents, or does.
5. Split statements with multiple outcomes under different conditions.
6. Use notes only for a boundary, special case, or example; notes cannot hide a second outcome.
7. Check source evidence and neighboring rules for overlap or contradiction.
8. Preserve stable IDs and the complete order, validate, and repair every completion issue.

The condition/outcome pair supports validation, calculations, routing, automation, exceptions, and unconditional constraints without forcing an “if—then” classification.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Close-out evidence

Close only after material rules are persisted and reviewable, with every completion issue repaired. Use the saved conditions, outcomes and exceptions as evidence for the shared current-state assessment, rather than a fixed score increment. Report what is clear and what remains unresolved. Vague, overlapping, contradictory, or untestable rules do not improve clarity.

## Interaction gate

After producing a valid proposal, present the native panel and pause for user review and save. Do not self-confirm rules or rewrite a successful panel save.

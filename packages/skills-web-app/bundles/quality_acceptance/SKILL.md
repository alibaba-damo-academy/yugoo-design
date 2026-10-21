---
name: quality_acceptance
description: |-
  - **Capability**: define the small set of observable requirements that tell users and the delivery team when established product behavior and material quality are good enough to accept.
  - **Resolves**: T gaps where an important function, rule, flow, page, or integration has no concrete passing result, or a material quality expectation remains vague.
  - **Candidate when**: the user asks for acceptance criteria, quality requirements, non-functional requirements, or a clear definition of done for product behavior.
  - **Do not infer**: business rules, missing product behavior, test code, release governance, project plans, risk registers, or a generic enterprise NFR checklist do not belong here.
  - **Output**: `quality_acceptance` panel — one editable ordered list of acceptance requirements.
---

# Acceptance Criteria

## Core responsibility

Help a non-professional user answer one question:

> In what concrete situation, what observable result means this part of the product is acceptable?

This skill owns acceptance requirements. Each requirement has one user-facing name, one checking condition, one passing result, and an optional plain-language verification method. An optional free `group` label, such as “AI 能力”, can organize the list without changing what passes.

It reads established product behavior from functions, flows, business data, business rules, roles, pages, integrations, notifications, AI capabilities, GROUND, and explicit user decisions. Those sources remain authoritative for what the product does. This skill does not copy or redefine them. Use an AI design's actual actions, conditions, result adoption and exceptions when they matter to acceptance; do not require an AI Bundle for unrelated behavior or automatically write acceptance records from it.

## Ownership and tools

`quality_acceptance/quality_acceptance.json` is the only canonical state. The
foreground Producer uses project-scoped `list` and `read` to inspect that state,
GROUND, and the smallest relevant Design evidence. It uses `write` or `edit` to
maintain the complete acceptance design in its owned WorkingCopy. This
lightweight skill is completed directly by the Producer.

Before publication, the Producer runs
`design_validate({outcome:"complete"})`, repairs every completion issue, and
calls `design_publish({action:"complete"})` to atomically publish the canonical
state. A panel save already persists the user's edits; later runs read and
preserve them.

## Maintaining existing design

The saved `quality_acceptance` state is the authority for current acceptance requirements.

- Preserve unaffected requirement IDs, order, group labels, condition, pass criteria, and verification. Do not classify existing ungrouped requirements merely to fill the new optional field.
- Update an existing requirement when the same product promise changes; do not leave an obsolete parallel requirement.
- Split one requirement only when it contains independently passable promises.
- Remove a requirement when its source behavior was removed or it no longer affects acceptance.
- Maintain the complete updated state in the Producer's WorkingCopy for the first material design and every later addition, change, or removal. Include the complete `requirement_order` whenever membership or order changes; a removal drops the requirement from the state and from the order list. Panel saves already persist their own edits.

## Prerequisite evidence

This Bundle turns established goals from `smart_questions` and situations from `flow_design` into verifiable standards. Treat their persisted records as references and never copy them into a parallel goal or flow model. When either source is absent, keep only acceptance requirements grounded by the current request and visible design evidence; do not invent product behavior in order to test it. The user may explicitly authorize reasonable assumptions, but unsupported behavior remains an unresolved source decision rather than a passing criterion. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted acceptance requirements with the available `smart_questions` and `flow_design` evidence. Repair one deterministic issue owned by `quality_acceptance` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real acceptance or quality decision is required. If an upstream Bundle or record is missing, malformed, or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when users need to decide what “works”, “good enough”, “ready to accept”, or a quality statement such as “fast”, “stable”, or “secure” actually means.

Do not use it to discover product scope or invent behavior. If the source design does not say whether an order can be cancelled, do not create a cancellation acceptance requirement as a substitute for designing that rule first.

Do not mechanically cover every field, button, browser, security topic, or edge case. A useful result is the smallest set of requirements that proves the product's core value and its material boundaries.

## Evidence model

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Inputs and authority

Use evidence in this order:

1. Explicit user acceptance criteria and quality constraints.
2. Confirmed behavior in existing design state and artifacts.
3. Stable product context in GROUND.
4. Conservative defaults only when they follow directly from established behavior.

Never turn an implementation preference into product acceptance. “Use Redis”, “write unit tests”, and “deploy with Kubernetes” are activities or technical choices, not passing results.

## Workflow

### 1. Find promises worth accepting

Select requirements from:

- the smallest successful path that delivers the product's main value;
- important denial, validation, recovery, permission, or external-dependency boundaries already defined elsewhere;
- quality concerns whose failure would materially harm users or the product.

Prefer a few decisive requirements over a long checklist.

Use a short free group label only when it helps the user find related requirements. A group is not a product capability, source reference or separate acceptance model. An absent or blank label is valid; changing a label never requires changing an ID or the saved order.

For AI behavior, distinguish producing a response from adopting it into product state. Base conditions and passing results on the established timing of confirmation, write/save and overwrite, and on the actual partial-result or failure behavior. Missing AI behavior remains a source decision; this Bundle neither invents it nor edits the AI design. Read the shared contract for a synthetic example.

### 2. Write the checking condition

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

### 5. Review as one acceptance list

Before saving, verify:

- each item has one clear reason to pass or fail;
- core product value has at least one requirement with an observable passing result;
- measurable thresholds exist only for material quality concerns;
- wording is understandable without reading internal schemas;
- requirements do not contradict their source functions, rules, permissions, pages, or integrations.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Close-out

Close after the smallest useful acceptance list is persisted and every completion issue is repaired. Summarize the core behavior promises and material quality thresholds. Report source behavior that still cannot be accepted because its outcome is undefined; do not fill that gap inside this skill.

This primarily adds T evidence. After the evidence is persisted, report how concrete and observable the requirements became, not how many records were added. Use saved behavior promises and observable quality thresholds as evidence for the shared current-state assessment, without a fixed T/S increment; vague or invented requirements do not improve clarity.

## Interaction gate

This panel is editable but does not use `must_edit`. Acceptance can be refined without blocking an explicit PRD or development request.

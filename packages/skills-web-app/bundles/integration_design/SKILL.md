---
name: integration_design
description: |-
  - **Capability**: design each product-relevant external connection as a complete new Plugin, with concise product-side notes.
  - **Resolves**: S/T gaps around which external capability the product needs, how the Agent accesses and uses it, and what the product does when the connection succeeds or fails.
  - **Candidate when**: a product behavior depends on an external API, webhook, SDK, MCP tool, third-party component, device, or team-operated system.
  - **Do not infer**: never invent vendor behavior, URL, credential, endpoint, or field-level API contract.
  - **Output**: `integration_design` panel — one editable Plugin-style connection record plus product-side remarks for every external capability.
---

# Integration Design

## Design responsibility

This skill helps a non-professional user answer one question: **what external capability does the product need, and how should an Agent use that capability safely?**

It uniquely owns:

- the list and order of product-relevant system integrations;
- every integration authored as a new Plugin connection;
- the Plugin creation fields for that connection: Name, Description, URL, API Secrets, and Prompt;
- the optional product-side remarks stored in `business_rules`.

It reads but does not copy:

- `function_modules` for the user-facing capability that creates the external dependency;
- `flow_design` for the business moment where the product crosses a system boundary;
- `business_data` for the business information involved, without designing request or response schemas;
- `business_rules` for established product rules, without creating a parallel general-rule catalog;
- `role_access` and `page_design` for who initiates the behavior and where it appears, without owning permissions or page interaction.

Do not use this skill to design internal modules, database tables, deployment infrastructure, generic business rules, page fields, notifications, or reports. Plugin is the connection model inside this one capability; it is not a separate design skill or panel.

## Ownership and tools

`integration_design/integration_design.json` is the only canonical state. The
foreground Producer uses project-scoped `list` and `read` to inspect that state,
GROUND, relevant Design evidence, and verified external facts. It uses `write`
or `edit` to maintain the complete integration design in its owned WorkingCopy.
This lightweight skill is completed directly by the Producer.

Before publication, the Producer calls `design_validate`. It repairs every
schema or declarative validation diagnostic in the same WorkingCopy,
repeats until valid, then calls `design_publish({action:"complete"})`. A panel
save already persists the user's edits; later runs read and preserve them.

## Maintaining existing design

The saved `integration_design` state is authoritative. Maintain it instead of rebuilding it.

- Read the current state before changing an established integration whose URL, secrets, Prompt, remarks, ID, or order is not already visible in the current design context.
- Preserve unaffected integration IDs, credential requirement IDs, names, descriptions, and order.
- Keep one record while the external capability and product purpose remain the same. Split records when the product invokes independently useful capabilities with different access instructions or materially different success and failure behavior.
- Merge records only when they describe the same external capability and one Prompt can explain the complete use safely.
- For the first material integration design and for later additions, removals, renames, or field refinements, maintain the complete updated state in the Producer's WorkingCopy, preserving unaffected records and order. A removal drops the integration or secret from the state and from its order list. Panel saves already persist the user's edits; never repeat a panel save.

## Prerequisite evidence

This Bundle deepens external facts from `research` at product connection points established by `function_modules`. Treat their persisted records as references and never copy them into a parallel research or capability model. When either source is absent, keep only connections grounded by the current request and visible design evidence; do not invent a URL, endpoint, credential, or product justification. The user may explicitly authorize reasonable assumptions about product intent, but unknown external facts remain explicit gaps. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted connections with the available `research` and `function_modules` evidence. Repair one deterministic issue owned by `integration_design` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real product or connection decision is required. If an upstream Bundle, record, or verified external fact is missing or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when at least one product behavior cannot be completed inside the product itself. Typical signals include:

- reading or updating information owned by CRM, ERP, WMS, payment, mapping, messaging, identity, analytics, or another system;
- calling an external API, webhook, SDK, MCP tool, device, or third-party component;
- handing work to a team-operated system through a defined technical entry point.

Do not create an integration merely because another system is mentioned. A system used only as background context, a manual process with no executable entry point, or a future idea outside the product boundary is not yet a system-integration record.

## Inputs and authority

Start from GROUND, the active design evidence, and explicit external-system evidence. Use the following authority order:

1. A user-confirmed URL, credential name, or documentation reference.
2. User-supplied vendor documentation, API documentation, examples, or known external-system facts.
3. Existing confirmed functions, flows, business data, rules, roles, and pages that establish why the integration is needed.

Lower-authority evidence may explain product intent but cannot manufacture higher-authority technical facts. If a required URL, credential name, or usage detail is unknown, leave that field incomplete and report the gap. Do not insert a plausible placeholder merely to pass deliverables.

## Reasoning workflow

### 1. Find the real system boundary

Trace the established product behavior until responsibility leaves the product. State the boundary in one sentence:

```text
The product needs <external capability> from <external system> so that <product outcome> can occur.
```

Examples:

- “The product needs WMS shipment creation so an approved order can enter warehouse fulfilment.”
- “The product needs a payment-status query so a paid invoice can be marked settled.”

If the sentence describes only an internal calculation, screen, role action, database write, or notification, route that concern to its actual owner instead of creating an integration.

### 2. Choose one coherent integration record

Create one record for one independently understandable external capability. Name it with a short verb-object phrase such as “创建发货任务”, “同步客户资料”, or “查询支付状态”.

Do not create one giant “ERP 集成” record when ordering, inventory, invoicing, and payment have independent usage instructions or failure consequences. Do not split one capability by HTTP endpoint when the user experiences it as one coherent action.

### 3. Author each connection as a new Plugin

Every integration record is authored as a new Plugin connection from established evidence. There is no platform Plugin directory to reuse from: never claim a connection is a verified or pre-existing platform Plugin, and never persist a Plugin reference, snapshot, or identifier copied from another system.

### 4. Author the Plugin fields

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

### 8. Check the whole record as one design

Read the record from top to bottom as a user would:

- the Name identifies the capability;
- the Description explains its value;
- the URL points to a real access or documentation location;
- Secrets describe only evidenced authentication needs;
- the Prompt teaches the Agent to use the capability;
- when additional product-side consequences apply, the optional remarks explain success and failure behavior without duplicating established facts. Do not fabricate remarks merely to fill a form.

Resolve contradictions before persisting. For example, a Prompt must not say “automatically retry” when the remarks require manual recovery, and a payment-query Plugin must not be used to design payment creation unless its documentation supports both.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Close-out

Close only after the current integrations are persisted, every completion issue is repaired, and the quality gates have been checked. Summarise:

- which external capabilities were designed as new Plugin connections;
- which URLs, credentials, documentation, or usage facts remain unresolved.

Do not claim a connection is implementation-ready while a required fact is unknown. Do not create main-Agent suggestions or a fixed next-skill sequence from this body.

After the integration evidence is persisted, report what it clarified across U/S/T. Unresolved connection facts may leave clarity unchanged or reduce confidence.

## Interaction gate

This panel is editable but does not use `must_edit`. Missing facts remain visible as deliverable gaps. If the user explicitly requests PRD assembly or development, follow that intent and carry unresolved integration facts forward as explicit assumptions or risks rather than blocking the request.

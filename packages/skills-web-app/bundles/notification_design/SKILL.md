---
name: notification_design
description: |-
  - **Capability**: decide when an established business moment should proactively reach which people, through which human channel, with what useful message and next action.
  - **Resolves**: S/T gaps where a user could miss a material approval, deadline, exception, handoff, or completed result while not looking at the relevant page.
  - **Candidate when**: an established flow contains waiting, handoff, deadline, exception, or material status change and somebody must know or act without already being on that page.
  - **Do not infer**: every state change needs a notification; page feedback, dashboards, reports, exports, audit history, machine webhooks, and final marketing copy belong elsewhere.
  - **Output**: `notification_design` panel — an ordered, editable set of proactive notification moments.
---

# Notification Design

Use this skill to answer one product question:

> When should the product proactively remind somebody, who should receive it, and what should they understand or do?

The saved `notification_design` state is the authority for proactive human communication. It does not own the underlying event, business rule, recipient role, or destination page. It reads those facts from their owning designs and records only the decision to notify.

## Ownership and tools

`notification_design/notification_design.json` is the only canonical state. The
foreground Producer uses project-scoped `list` and `read` to inspect that state,
GROUND, and the smallest relevant Design evidence. It uses `write` or `edit` to
maintain the complete notification design in its owned WorkingCopy. This
lightweight skill is completed directly by the Producer.

Before publication, the Producer runs
`design_validate({outcome:"complete"})`, repairs every completion issue, and
calls `design_publish({action:"complete"})` to atomically publish the canonical
state. A panel save already persists the user's edits; later runs read and
preserve them.

## Maintaining existing design

Inspect the saved state before changing it. A later request normally updates an existing notification rather than creating a parallel message matrix.

- Preserve unaffected IDs, order, trigger, recipients, channels, message intent, and action target.
- Keep a notification ID stable when its title or wording changes.
- Maintain the complete updated state in the Producer's WorkingCopy for the first material notification design and every later change, preserving unaffected records. Include the complete `notification_order` whenever membership or order changes; a removal drops the notification from the state and from the order list. Panel saves already persist their own edits.
- Remove a notification when the underlying business event is removed or when the user can no longer miss anything important without it.

## Prerequisite evidence

This Bundle deepens established moments from `flow_design` using interaction expression from `design_style`. Treat those persisted records as references and never copy them into a parallel flow or visual model. When either source is absent, keep only notification decisions grounded by the current request and visible design evidence; do not invent events, recipients, channels, or visual behavior to fill the panel. The user may explicitly authorize reasonable assumptions, but unsupported decisions remain assumptions rather than facts attributed to another Bundle. This evidence relationship is not a fixed execution order.

## Post-write Design projection self-check

After every successful canonical write and before ending this skill, inspect the refreshed revision-pinned Design projection once. Compare the persisted notification moments with the available `flow_design` and `design_style` evidence. Repair one deterministic issue owned by `notification_design` with at most one focused follow-up write, then inspect the refreshed projection once more. Ask the user when a real recipient, timing, channel, or message decision is required. If an upstream Bundle or record is missing, malformed, or unresolved, report that non-blocking evidence gap without undoing the valid write, editing another Bundle, or retrying indefinitely. After the write enters the Design Project Git history, G/R/A owns ongoing cross-Bundle drift checks.

## When to use

Use this skill when proactive attention is itself a product behavior, for example:

- an approver receives a new task;
- a requester must learn that a request was rejected;
- a deadline is approaching and inaction has a consequence;
- an exception needs a responsible person;
- a handoff or material completion result could otherwise be missed.

Do not use this skill for:

- a success toast or validation message shown while the user is already on the page — that belongs to `page_design`;
- a dashboard, report, export, or printout that users choose to open — those begin as capabilities in `function_modules` and pages in `page_design`;
- an audit trail or activity history — that is persisted business information and page presentation;
- a machine callback, webhook, external API, or system-to-system event — that belongs to `integration_design`;
- speculative reminders for every possible status change.

## Inputs and authority

Read GROUND and only the relevant saved designs:

- `flow_design` for real handoffs, waiting points, exceptions, and outcomes;
- `business_data` for established business items and user-visible states;
- `business_rules` for the conditions under which a notification is allowed or required;
- `role_access` for established recipient roles and their scope;
- `page_design` for an established action destination.

Do not invent a role, business moment, or page merely to complete this panel. If the product evidence supports only a generic actor such as “申请人”, keep that natural description instead of fabricating a formal role.

## Design method

### 1. Find moments that can actually be missed

Review the established flow and keep only moments where proactive communication prevents missed work, missed risk, or important uncertainty. Ask:

- Is the person likely to be away from the relevant page when this happens?
- Do they need to act, or is this result important enough that silence would be harmful?
- Would the product still work clearly if this notification did not exist?

If the user already sees an immediate result on the current page, do not add a notification just to repeat it.

### 2. Answer “when” in one natural sentence

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

For a new design, choose the smallest necessary audience and prefer `in_app`
for ordinary product work. Add external delivery only when people need attention
outside the product. Remove convenience audiences and avoid noisy repetition.
These are design choices, not permission to change behavior during restoration.

### 6. Review the set as a whole

Before saving, remove duplicate or noisy moments and check whether multiple records notify the same audience about the same event. A notification set is better because every record has a reason to exist, not because it has more rows.

## State contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Close-out evidence

Close after the material notification moments are persisted and every completion issue is repaired. Summarize the important moments, recipients, and unresolved delivery dependency. Report any established event that still lacks a responsible recipient instead of inventing one.

Notification design mainly adds S/T evidence by making cross-time and cross-user communication observable. After the evidence is persisted, report what it clarified and what remains uncertain. Message count alone adds no clarity.

Typical guidance:

- Explain whether the saved notification moments make the event, recipient, channel, message and expected action clear under the shared S/T rubric; no fixed increment follows from producing a notification set.
- Duplicate, low-value, or ungrounded notifications do not improve clarity and may lower it.

## Interaction gate

This panel is editable but does not use `must_edit`. Notification details can be refined after core product behavior is established and must not block an explicit PRD or development request.

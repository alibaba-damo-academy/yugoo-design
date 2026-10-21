# From user tasks to a coherent page system

This method uses the existing Page map fields. It adds no schema, mandatory
story record, separate planning artifact or extra user gate. Examples below
illustrate reasoning, not facts to copy into a project.

## Synthesize before assigning pages

Start with what the user wants to accomplish in a concrete situation. For each
material task, identify its starting context, the object being worked on,
relevant state and permissions, action, observable outcome and continuation.
Use answered questions and current instructions for intent; functions for
capabilities; flows for sequence; objects for identity/context; rules and roles
for conditions. Read relevant records, not every Bundle by default. A KAG query
can locate uncertain relationships or change impacts; verify its source records.
Missing evidence stays an explicit assumption or a consequential user question.

Group work that shares context and supports one coherent task. Distinguish:
- Global destinations: stable, recurrent places users deliberately return to.
- Contextual pages: object detail or workspaces entered from a selected context.
- Views and actions: tabs, filters, dialogs or steps within an existing surface.

A capability name, database entity or flow step does not automatically earn a
page or a global menu item. Conversely, a long-lived task may warrant its own
workspace. Decide from task continuity, frequency, retained context and scope;
there is no fixed page/menu count or universally preferred hierarchy.

For example, an expense product might put recurring work under an expense list,
with review/export actions on a selected report. A dedicated auditor queue can
still be justified by a separate recurring task. Neither 'export is always a
page' nor 'export must never be a page' follows from the function name.

## Persist the decisions in existing fields

- `purpose`: explain the primary task and intended outcome in its context,
  rather than copying the function description or listing feature IDs.
- `audience`, `key_content`, `key_actions`: express priority, necessary context,
  task progression and important conditional behavior. Secondary actions need
  not compete with the primary task as equally prominent cards.
- `function_refs`, `evidence_refs`: cite actual source records. Distinguish a
  relevant constraint from an instruction to display all fields of that record.
- `parent_id`, `entry_page_ids`, `connections`: express organization, entry and
  meaningful transitions respectively. Connection labels can describe the
  carried context and outcome; hierarchy alone does not imply a jump.
- `common_spec.layout`, `navigation`, `shared_components`: capture the settled
  cross-page organization, actual global destinations and repeated patterns.
  Style supplies visual language; product navigation comes from task synthesis.

Trace representative tasks across the proposed map before the existing map
handoff. Check lost object context, duplicated responsibilities, dead ends,
feature-only menu entries and rules promoted to permanent UI clutter. Explain
the principal route and any material tradeoff briefly to the user. Preserve
confirmed structure on continuation; a newly discovered shared conflict goes
back to the executor, not into a Worker's private redesign.

## Page Worker brief

Use an ordinary task prompt, with these contents as needed:
1. Exact Page ID/path, primary task, starting condition and expected result.
2. Settled shared layout/navigation and relevant Style decisions; concrete
   token/asset locators for exact source reads, not copied validator payloads.
3. Relevant neighboring pages and incoming/outgoing transitions, including
   object context. Full unrelated page descriptions are unnecessary.
4. Relevant source excerpts with file and record/pointer locators, indicating
   checkpoint or current working-copy basis; assumptions clearly identified.
5. What this page owns, what it must preserve, and the file-backed validation
   contract. Include KAG pins only if actually supplied by the query result.

The Worker uses supplied evidence, reads gaps or exact assets as needed, and
implements the task with clear emphasis. It may improve local arrangement but
does not change shared navigation, business policy or sibling responsibilities.
Source contradictions and missing shared decisions are reported for integration.

## Review the integrated result

Mechanical checks validate files and bindings. The executor separately checks
that a user can recognize their task, identify the primary action, retain the
right object/state across pages and reach the outcome. Inspect the relevant
preview/content for this review; receipts and CSS token consistency alone are
insufficient. Check material alternate conditions without displaying every
exception permanently. Repair only affected pages. Report browser behavior as
unverified if only static inspection was possible.

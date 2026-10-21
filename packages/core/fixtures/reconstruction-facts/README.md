# Bounded reconstruction behavior exercise

`source/` is a small fictional materials input, not a new Bundle or runtime
validator. Use it to test semantic extraction independently from JSON checks.

## Run

For a full host run, start a new test project with
`/design reconstruct <absolute path to this source directory>`.
Let the Agent determine relevant coverage; do not demand every Bundle.
For a focused comparison, assign Smart Questions, Business Data, Business Rules,
Role Access, Notifications and Quality Acceptance using the same short brief:

> Restore Cedar Requests as a whole club expense-request product, for members
> and reviewers. Your slice is the selected Bundle; preserve common request
> identity and behavior across outputs. product.md, behavior.md and archive.md
> contain the available dated evidence; check their coverage and conflicts.
> No existing Design state or user-requested changes. Restore supported content
> and report limitations.

Use the actual `producerSystemPrompt` / `producerPrompt` builders and installed
Bundle resources, not copied prompts maintained here. A tool-limited isolated
exercise may write into a temporary output directory and run the installed
`validateSkillDesign`; it must not claim Host publication or product execution.
Keep this evaluation guide separate from the generating Agent's input.

## Review observable facts, not matching prose

- The overview describes the club expense product, members, reviewers and main
  journey, not a general workflow platform. Authentication is invitation-based
  sign-in; persistence is a server database. Prefill is not user confirmation.
- Current 500-yuan maximum and strictly-above-200 receipt requirement survive
  across data, rules and acceptance. 200/201 and 500/501 remain distinct.
  Archived 1,000-yuan/email proposals are not current behavior.
- Applicant identity distinguishes different people with the same display name.
  Conditional receipt/rejection reason and the four states are represented.
  No invented category, foreign-key schema or payment capability is added.
- Editing is limited to the applicant's draft. Reviewers cannot decide their
  own requests, even via the direct address. Refusal preserves the preexisting
  state, not a new guessed state. Approved withdrawal remains unknown.
- Notification goes to the applicant once a decision is saved, through in_app,
  with the correct request detail target. No new email integration is invented.
- Acceptance preserves source examples and labels derived cases as such. It
  does not invent an SLA or say that tests ran because specifications exist.
- Known administrator granting authority is retained, while unspecified
  administrator permissions/assignment remain a reported representation limit.
- Validate all generated states with the installed schema and completion rules,
  then compare the artifacts against source and one another. Format success
  alone is not a semantic pass; document omissions separately.

## Initial result (2026-09-09)

An independent isolated Agent received the six actual runtime prompts and
shared references, without this checklist. It wrote all six states under
`/tmp/reconstruction-facts-eval-SgQeSR/output`. Installed state/completion checks
passed. Main-agent inspection confirmed the boundaries, identity, self-review
prohibition, current-vs-archived behavior, notification and unknown handling
above. The administrator limitation was reported in role summary, not erased.

This is one bounded behavior observation, using one Agent across six outputs.
It is not a DSH multi-Producer/Qwen run, UI/pixel test, baseline improvement
measurement, statistical reliability claim or proof of all Bundle quality.
Temporary output is not a maintained golden answer. Repeat from source when
assessing a different model or a materially changed contract.

The exact prompt snapshots and raw generated JSON for this observation are
retained under `docs/experiments/reconstruction-facts-2026-09-09/` at repository
root. They are evaluation records, not runtime instructions or golden outputs.
cx-2 independently checked the source against all six JSON files and reran the
reconstruction contract smoke. This sample does not exercise broad grants,
all-administrator email audiences or a deployment-platform capability; those
boundary changes received instruction review, not behavioral proof here.

---
name: smart_questions
description: |-
  - **Capability**: maintain coherent product background and evolving context through editable questions and answers.
  - **Resolves**: understanding of users, needs, value, scenarios and boundaries, plus relevant context not owned by another design facet.
  - **Candidate when**: exploring requirements, reconstructing product background, or clarifying context necessary for the current result.
  - **Do not infer**: missing details or low scores require a questionnaire; do not replace an authorized deliverable with questions.
  - **Output**: the existing `smart_questions` panel, not a technical inventory or a personal profile.
---

# Smart Questions

## Purpose: product understanding that evolves

Maintain a coherent account of who the product serves, the problem in their
situation, the outcome it enables, and its scope. This overall product background
is a first-class responsibility of this Bundle, not information left over after
other Bundles run.

Continue maintaining context as the design develops: material constraints,
assumptions and user decisions that affect that understanding but do not have a
better home in another facet. Prefer revising the relevant existing card over
adding a new one for every discovery. These are two responsibilities within the
same question panel, not new record types, UI sections or workflow stages.

Detailed feature catalogs, flows, data definitions, permissions and testable
business rules belong to their respective Bundles. Their implications for the
product's audience, value or boundary can belong here; do not duplicate their
specifications. For example, how usage is charged is a business rule, while
whether the product serves occasional users or a paid professional workflow may
be important product background. A stray technical fact does not qualify merely
because no other Bundle has recorded it.

## Shared method for design and reconstruction

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Interaction: useful to this person now

Choose how to resolve uncertainty before turning it into a question:

- An observable fact: inspect the relevant available evidence, rather than ask
  the user to reconstruct it from memory. External research remains subject to
  its own scope and handoff; do not silently start another Bundle.
- A product decision the user can make now: explain the situation, the desired
  outcome and the consequential tradeoff. Ask about that coherent choice, not
  every setting that could eventually implement it.
- A choice that needs experience: identify what a concrete example or proposed
  prototype would help the user judge. For example, seeing a representative
  result can reveal whether its information is useful; asking for field counts
  cannot. Offer the smallest useful demonstration within the authorized work,
  or describe the next step without executing another Bundle here.
- A detail unnecessary for the current result: retain the uncertainty and
  proceed within the agreed scope; do not turn it into a prerequisite.

These are reasoning choices, not new question types or persisted statuses.
The question panel remains the interaction surface: put a concise proposal,
its useful context and the decision to make in the card's `prompt`, with
appropriate `choices` or free-text input. Do not put the proposed answer into
the user's `answer` or use `detail` as a substitute for visible question text.
In forward design, leave new `detail` empty unless it preserves an actual
user-supplied explanation or a faithful summary of explicit user evidence.
Put your proposed scope, rationale, examples and unresolved questions in
`prompt`, not in user-response fields. Your earlier proposal, a Producer brief,
and another Agent's summary do not establish that the user said or confirmed
something; trace prefilled answers to direct user input or saved user edits.
Do not replace the panel with a chat-only interview or a native Ask Question.
If judging a real prototype requires another Bundle, the card can offer that
next step or deferral; it does not generate or launch the prototype itself.
When showing a proposal, ask about its usefulness in the user's situation,
not just whether they like it. A hypothetical preference is not evidence of
successful use. Preserve an explicit "first a personal version" boundary;
future collaboration questions need not be settled to explore that version.

Use explicit Host-supplied collaboration preferences and the current brief to
calibrate terminology, explanation depth and answer format. A domain expert may
need technical tradeoffs explained; an exploratory user may need examples.
Treat inferred expertise or mood as tentative and adapt when corrected. The
collaborator is not necessarily the product's target user. Personal traits are
not product evidence: do not store them in Design Files or GROUND, build a user
profile, or access a host-specific preference file. Long-term preference storage
belongs to the Host under its existing authorization rules.

For explicit exploration, a focused two-to-five-question round is often useful.
For an already requested deliverable, prefer one to three necessary questions;
one is enough, and none is better if a safe reversible provisional choice serves
the request. These are interaction guidelines, not a cap on the total persisted
background or the number of source-backed reconstruction cards.

Explain the concrete consequence briefly, using product language rather than
internal IDs or implementation jargon. Each question should address one coherent
topic. Use single choice for one priority or mutually exclusive alternatives;
multi-select only for compatible choices, not as a substitute for ranking.
Recommend a minimal coherent proposal rather than every option. Use free text
when choices cannot usefully express the answer.

When the user wants a result, offer explicit reversible defaults rather than
forcing premature decisions. Do not record a recommendation as their answer.
Ask the smallest necessary question when a consequential decision has no safe
provisional option; explain why, or propose a narrower scope without silently
changing agreed scope. Never ask about Host-managed deployment, credentials,
hosting or infrastructure tuning. Technical decisions remain product questions
only when their user-visible consequences actually require user judgment.
Application-type choices must respect the supplied platform environment.

Offer "other", "not sure, advise me", or "simplify first; decide after the
prototype" where meaningful. Preserve the user's words through existing fields.
Deferral is a valid instruction about proceeding, not approval of unknown
details. Do not rephrase rejected/deferred questions after a mere round or
revision change. Revisit only when the user returns to the decision, material
new evidence changes its impact, or a newly requested result genuinely needs it;
explain what changed. Fixed login/storage defaults alone never justify a round.

## Eliciting a concrete situation without a story template

When the current result is hard for the user to judge, invite one recognizable
situation: what they were trying to achieve, what made it difficult, and what
would count as a useful result. These are possible angles, not a required
three-question interview. For example, “最近一次整理文献时，什么事情最费劲？
如果这个平台能帮上忙，你希望最后得到什么？” is a neutral expression prompt,
not a request to learn a user-story format or invent an ideal workflow.

First reuse concrete situations already in the conversation and saved answers.
Do not create a second card just to restate them. Ask only the uncertainty that
matters to the authorized design; do not ask again because functions have been
generated or optional details remain empty. A declined or deferred situation
question follows the existing revisit rules above.

An AI example belongs in the visible prompt and must be labelled hypothetical.
It is not an answer, confirmation, or evidence that the proposed function is
needed. Actual user expression can support subsequent function design and a
derived experience without creating a story entity here. A future optional
story Bundle may refer to these same answers; this question panel does not
claim ownership of formal story management or duplicate its records.

## Evidence: different sources, the same product questions

### Forward design

Use user statements and established Design evidence without asking again.
Update an existing relevant card when a user changes its answer. Do not create
a self-answered duplicate just to copy another artifact or log a chat statement.
Maintain shared product facts through the existing owning paths; the Producer
does not gain authority to write another Bundle or GROUND from this instruction.
Preserve existing answers, including the fixed cards' initialized values;
preserving a value does not newly confirm it. For a new unanswered dynamic
question, leave `answer` empty until the user supplies or adopts an answer.
A recommendation for the deliverable belongs in the question's proposal, not
in that empty answer. Follow the fixed-card initialization contract below when
creating a panel; do not clear its defaults because no new confirmation occurred.
In both cases, describe the actual basis of a value rather than equating a
non-empty answer with user approval.

### Reconstruction

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

## Persistence and close-out

The active Bundle executor (main Agent or Producer, selected by execution.mode) maintains
`smart_questions/smart_questions.json` through its existing project-scoped
`list`, `read_design_file`, `write` and `edit` tools. Preserve complete state, stable card IDs,
untouched answers/details, rejected records, attachments and fixed definitions.
Merge supporting context into its existing topic when appropriate, without
discarding user information. Add new dynamic cards only for new material topics;
explicitly assign their round and its independent introduction as described in
the shared output contract. The executor, not a presumed automatic write hook,
owns that assignment. Do not relabel every old card to reorder history
or impose a new questionnaire lifecycle. A panel save already persists edits;
do not rewrite unchanged answers merely to advance conversation.

For each new dynamic round, author nonempty `rounds["<round>"].title` and
`description` separately from every question's `prompt`. Use a short, specific
topic title (Chinese: preferably at most 12 characters; English: a short phrase),
not the first question, a numbered label or a paragraph. This is writing guidance,
not a hard length limit or permission to truncate saved text. Explain the round's
purpose and useful context in `description`; each card still carries the full
concrete question, proposal and decision context that makes it answerable.
Round introductions are neither answers nor user confirmation. Preserve existing
round metadata when revising answers. Old files without metadata remain readable;
do not derive or backfill round copy from their first question, rewrite historical
prompts, or create a round merely to populate these optional fields.

When presenting actual new questions awaiting input, validate with
`design_validate({outcome:"pause"})`, repair diagnostics and publish with
`design_publish({action:"handoff"})`. An unanswered panel awaits the user.
When saved answers or explicit deferral leave no current necessary question,
validate the final state and complete the engagement with
`design_publish({action:"complete"})`; do not reopen a gate just because a detail
remains unknown. Reconstruction validates and publishes with action complete
for unified user review, without an ordinary unanswered-panel pause. The main
Agent may continue only work already authorized; no new receipt authority follows.

Report actual clarification, not answer counts. Non-empty answers, source
prefill or "not sure" alone do not increase U/S/T or imply confirmation.
Material user answers can clarify U; concrete scope, workflow or observable
behavior can support S/T under the existing Host rubric. Explicit scope
reduction may add evidence while other details remain unknown.

## Fixed-card contract

Read [the shared output contract](reference/artifact-contract.md) for these field meanings, examples and checks; it is used by both ordinary design and reconstruction.

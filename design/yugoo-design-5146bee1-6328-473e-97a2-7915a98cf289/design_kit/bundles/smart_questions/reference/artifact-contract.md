# smart_questions output contract

## Record IDs

For new free questions prefer `Q-001`, `Q-002`, and so on. Keep numeric question rounds, fixed `const_*` question keys, choice values and attachment identities unchanged.

Existing IDs, including older formats, remain valid during ordinary edits and reconstruction. If the user explicitly requests business renumbering, revise actual record keys/IDs and current references/orders together through their existing owners; keep technical IDs and history unchanged. Names and titles remain readable content, separate from identity.

Shared by ordinary design and reconstruction. Canonical state is
`smart_questions/smart_questions.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

Restore coherent product background before incidental details, to the extent the source supports it. The shared method below governs organisation; ordinary interview choices and pauses remain in SKILL.md. Preserve actual user answers. Empty, inferred and user-confirmed are different even when all are schema-valid.

## Shared method for design and reconstruction

Read the current user request, existing cards, supplied product understanding,
GROUND and relevant Design evidence. In reconstruction, also verify focused
source paths. First connect the evidence into a compact product account:
who, in which situation, faces which need, seeks which result, through what
core interaction, within which boundaries. This is reasoning that shapes the
cards, not a required extra file, summary field or introductory questionnaire.

Use 5W1H as lenses rather than six mandatory cards: who participates; what
outcome matters; when and where the need arises; why the product is useful;
and how the user achieves the result. Do not substitute internal architecture
for the user's "how", or invent a motivation that the evidence cannot support.
Group related evidence around a meaningful product question; order a new
overview from purpose and users through the main scenario to scope. Source
directory order must not become question order.

An initial broad overview should make the product understandable before adding
incidental details. For an existing well-understood product or a narrow request,
reuse that overview and address the relevant gap; do not restart an interview.
Choose the method that serves the current request:

| Method | Purpose | Application |
| --- | --- | --- |
| Background study | Establish or revise the product's overall context. | Use the missing, meaningful 5W1H lenses to connect users, needs, outcomes, scenarios and boundaries; an exploratory interview can help the user discover them. |
| Content completion | Make a clear, bounded deliverable concrete. | Ask only necessary missing content, such as the name to display on a portfolio; do not reopen all product background. |
| Targeted follow-up | Incorporate a consequential discovery or unresolved decision. | Explain how it changes the established understanding; update its existing card or add a focused question if it is genuinely new. |

A useful card helps understand the product or make a meaningful current decision.
Before adding one, identify what in the current requested result would change
with the answer, and why existing evidence or an agreed boundary is insufficient.
If the only reason is that more features, fields or alternatives are possible,
omit it. This relevance test applies to question generation itself, not just
to the recommended option: adding "keep it simple" does not make an unnecessary
question necessary. Explicit exploration can surface new needs, but a request
to confirm remaining essentials is not an invitation to expand the product.
Check whether another facet already owns the topic.
Do not turn repository findings, every advisory candidate, or a catalog of
future possibilities into questions. Recheck advisory candidates against current
evidence and user intent; omit already resolved or currently unnecessary ones.
Do not manufacture a question or a no-op invocation to consume an action receipt.

### Reconstruction

An explicit reconstruction asks for the same product understanding, obtained
from implementation and documentation rather than a new interview. Build the
overview from representative entry points and user journeys, then include only
material supporting context. Do not ask the user how many Bundles to scan, or
replace the overview with component, SEO, billing or deployment inventories.

Put a concise source-supported answer in `answer`. For a free-text question,
keep source locations, observation versus supported inference and remaining
limits with that answer; leave `detail` empty. A choice question may use its
optional `detail` for those qualifications. Free text has no separate supplement
input or historical supplement display.
A supported interpretation may explain the overall product, but label it as
inferred, not stated user intent. Do not infer commercial positioning or target
audience merely from the presence of an admin route or a technical capability.
The visible answer should read as product understanding, not a source-code dump.
Reconstruction prefill is reviewable, not user confirmation; it is not a license
to guess answers during ordinary questioning.

If evidence supports part of the answer, retain that part and identify remaining
unknowns in the same answer (or `detail` for a choice). Split independent topics
rather than let one known fact mask a separate unknown. Leave genuinely
unsupported answers empty. Missing
information in one summary document is not proof of absence in the repository:
inspect a relevant source when the missing fact matters. Preserve user answers
and explain conflicting source evidence without replacing their decisions.

Before closing, read the cards as a whole: can a reader understand the product's
purpose, intended users, main scenario and scope to the extent the source permits?
Are later details supporting that account rather than displacing it? Check that
free-text `detail` is empty, choice `detail` does not contain a verified answer
missing from `answer`, unknowns remain honest, and each inference is supported.
This is an Agent self-check,
not a new validator or host gate.

## App basics and existing settings

For a new application's initial background overview, use one App basics group
with three independent questions. Reuse explicit user statements and established
Design facts; a known answer is reviewable context, not another interview.
A narrow content-completion request does not require adding this group or
invoking this Bundle. The group is a reusable starting point, not a completion
gate or a technical-stack selector.

| Stable ID | Question | Kind and values |
| --- | --- | --- |
| `const_identity_needs` | 使用时，需要知道是谁在操作吗？ / Does the app need to know who is using it? | `single`: `not_needed`, `needed`, `undecided` |
| `const_data_retention` | 下次打开时，需要保留上次的内容或操作进度吗？ / Should content or progress remain the next time the app opens? | `single`: `not_needed`, `needed`, `undecided` |
| `const_usage_devices` | 主要在哪些设备上使用？ / Which devices will people mainly use? | `multiple`: `computer`, `phone`, `tablet`, `other` |

Use the complete definitions in the example below; localize their prompts and
labels to the user's language on first creation without changing IDs or value
meanings. Keep the three entries together in that order. Each has its own
`answer` and optional `detail`; never combine them into one answer or a package
of architecture choices. Ordinary revision preserves existing wording and
choices unless the user requests a change.

Start with empty answers where the requirement is unknown. Do not select a
proposal, a recommended stack or `undecided` on the user's behalf. A user-selected
`undecided` records a deferral, not a settled requirement. Device choices are
compatible; an empty selection remains unknown, and `other` can be explained
in `detail`. Preserve useful constraints, source locators and uncertainty in
that existing detail rather than adding another evidence field. Do not add
`round` or `rejected` to these first-round entries; the Panel groups and protects
them through its existing declarations. No automatic Core seeding is assumed.

Interpret the answers as application needs:

- Identifying a user does not choose registration, an identity provider or a
  permission model. Follow up on actual access boundaries only when they affect
  the requested design; complete role/access rules remain with their owner.
- Retaining content does not choose a database, cloud service, synchronization
  or sharing. Establish those independent needs only when relevant.
- A device is not a delivery format. Preserve an explicit browser/native,
  distribution or offline requirement in the existing context; ask about an
  unresolved format only when its consequences matter. A local Agent Host does
  not imply a local-only application or an available managed backend service.

In reconstruction, verify these meanings against actual behavior and source
coverage. Preserve observed facts and limits; neither a missing file nor an
example default proves absence of identity or retention.

### Preserve existing login and storage settings

Existing projects may contain `const_auth_mode` and `const_storage_mode`.
Their saved IDs, prompts, choices, answers and details retain their original
meaning; do not replace their values with answers to the new questions:

| Existing ID | Values | Historical initialized value |
| --- | --- | --- |
| `const_auth_mode` | `anonymous` / `auth_required` | `anonymous` |
| `const_storage_mode` | `browser_temp` / `database_persistent` | `browser_temp` |

Carry these records unchanged on revision unless the user changes them. An old
initialized answer is not newly confirmed by being retained. Do not recreate
these old defaults for a new state, add the new group merely to update an
existing file, or rewrite a project's complete Kit definitions silently. The
Panel can display either generation using the same shared question controls;
existing supplementary text remains available. Preserve any existing `round`
metadata and question history rather than moving settings into a new round.
In reconstruction, verify the actual login and storage behavior; if neither
old choice fits, leave its answer empty and explain the observed scope in
`detail`. Durable files alone do not establish a database or cloud sync.

## State contract

`questions` is the complete set of cards rendered in the current FE panel. The
map key is the stable question ID; do not duplicate it inside the card. Do not
add hidden queues, answered/rejected ID lists, categories, priorities, 5W1H
labels, strategies, or any other planning metadata. The optional top-level
`rounds` map is solely independent display copy for existing question rounds;
it is not a planning queue, answer store or another lifecycle authority.

The complete payload is an object whose `questions` value is a map from
question ID to its question object, with optional `rounds` keyed by the saved
round's decimal string. This synthetic example is not a user requirement or
confirmation; the empty App basics answers below demonstrate an unanswered first panel:

```json
{
  "rounds": {
    "0": {
      "title": "AI 使用方式",
      "description": "合成示例：澄清 AI 如何帮助用户完成当前任务。选项是待讨论的提案，不是已确认需求。"
    }
  },
  "questions": {
    "const_identity_needs": {
      "prompt": "使用时，需要知道是谁在操作吗？",
      "kind": "single",
      "choices": [
        {"value": "not_needed", "label": "不需要区分使用者"},
        {"value": "needed", "label": "需要识别使用者"},
        {"value": "undecided", "label": "暂不确定"}
      ],
      "answer": "",
      "detail": ""
    },
    "const_data_retention": {
      "prompt": "下次打开时，需要保留上次的内容或操作进度吗？",
      "kind": "single",
      "choices": [
        {"value": "not_needed", "label": "不需要保留"},
        {"value": "needed", "label": "需要保留"},
        {"value": "undecided", "label": "暂不确定"}
      ],
      "answer": "",
      "detail": ""
    },
    "const_usage_devices": {
      "prompt": "主要在哪些设备上使用？（可多选）",
      "kind": "multiple",
      "choices": [
        {"value": "computer", "label": "电脑"},
        {"value": "phone", "label": "手机"},
        {"value": "tablet", "label": "平板"},
        {"value": "other", "label": "其他设备"}
      ],
      "answer": "",
      "detail": ""
    },
    "ai_interaction_method": {
      "prompt": "当前原型优先采用哪种方式让用户请求 AI 帮助？",
      "kind": "single",
      "choices": [
        {"value": "button_trigger", "label": "点击操作按钮发起请求", "recommended": true},
        {"value": "conversation_request", "label": "在对话中输入请求", "recommended": false}
      ],
      "answer": "",
      "detail": "",
      "multimodal_answer": [],
      "round": 0,
      "rejected": false
    }
  }
}
```

The first three entries are the new App basics definitions. The FE renders them at the bottom of
the first round only; add dynamic questions after them and the FE renders later
dynamic rounds without those fixed cards, newest first. When editing an
existing panel, carry the existing question definitions and prior user decisions
forward into the complete canonical state without adding them to the new round.

- `prompt` contains the question and the context or consequences needed to answer it. Put each complete option in `choices[].label` once; do not also enumerate those options in `prompt`.
  Before publishing, read the prompt together with each choice and check that every choice answers the same question about the same subject, scope and decision.
- `value` is the stable selection token. `label` is visible text. Answers always store `value`, never a label, recommendation suffix, or invented internal token.
- `single` stores one `value`; `multiple` stores comma-separated `value`s; `text` stores its complete free-text response in `answer`, has no choices and leaves `detail` empty. The answer, including useful qualifications, is read and edited in one place.
- `recommended` is the only recommendation mechanism. Do not add a question-level `suggest` field or append `(推荐)` to stored labels.
- Dynamic-card `round` controls the FE's round grouping; the latest round renders
  first. Assign a nonnegative integer explicitly: use 0 for the first dynamic
  round; when genuinely new topics need a later round, use one greater than the
  greatest existing dynamic grouping value (normalize legacy values as below
  for this calculation only). Do not rely on automatic write-time allocation.
  Missing legacy round values group as 0; the existing view clamps negative
  values to 0 and truncates fractions for grouping only. Preserve those saved
  values on unrelated edits rather than silently renumbering history. Fixed
  cards do not participate in round-number allocation.
- For a choice question, `detail` records the user's optional explanation,
  constraints or source/provenance notes in reconstruction; it supplements rather
  than duplicates the selection. It is not a second field for free-text questions.
  Preserve unrelated saved data without automatic answer conversion. When the user answers
  a choice question with wording that does not match a rendered option, keep
  `answer` empty and preserve the exact wording in `detail`; never replace it
  with a recommended option. On dynamic cards, `rejected` means the user
  rejected this question; it remains a visible design record. A truly deleted
  dynamic question is removed from the map. Fixed cards cannot be rejected.
- `multimodal_answer` stores up to five unrestricted local-file references.
  New references use `type: "file"` (`"image"` remains valid for legacy
  references), a 32-character hexadecimal `file_md5`, a path-free filename,
  a normalized `mime_type` (falling back to `application/octet-stream`), and a
  positive `size_bytes` value no larger than 10 MiB. Design Panel uploads are
  persisted locally as Bundle-owned Design Files under
  the relative `artifact_file` under `smart_questions/attachments/` in the same
  atomic checkpoint as this JSON. New files use a SHA-256 filename while
  `file_md5` remains the stable compatibility digest. Never store base64, a
  temporary upload token, an OSS URL, or an absolute host path in canonical
  state.
- The UI derives response presence from non-empty `answer` or
  `multimodal_answer`; supplementary `detail` alone does not answer the question.
  Do not persist a duplicate `is_answer` flag. Response
  presence does not establish user confirmation or resolve an unknown.

### Independent round introductions

For each new dynamic round, author `rounds["<round>"].title` and `description`
as nonempty strings. The key is the actual saved round number's base-10 string
(e.g. saved `round: 7` uses `rounds["7"]`, even when displayed as “第2轮”),
not the consecutive display label, question ID or insertion index. The schema
requires both string fields on a present entry; their usefulness/nonemptiness
and matching the questions are executor checks, not a title-length validator.

Use a short topic title: Chinese preferably no more than 12 characters, English
a short phrase. Do not hard-truncate user text. Describe the round's purpose,
context and current decision in `description`, without inferring user approval
or inventing product facts. A title must not be the first question's prompt or
a generated extract from it. Each question still has its own complete `prompt`,
including the proposal, useful context and concrete decision when needed;
round-level copy does not excuse an incomplete or ambiguous question.

Only question membership determines round order, current round, answered counts
and history protection. Metadata alone cannot create a pending round, force an
interview or count as an answer. Preserve all unrelated introductions, question
IDs, prompts, answers, details, rejections and attachment references during a
complete-state revision. Deleting or revising the first question must not derive
or overwrite the round's introduction. Do not automatically delete unrelated
metadata while editing a card.

Existing files without `rounds`, or with no entry for an old round, remain
readable. Show a generic localized round label in that case; do not reconstruct
copy from the first question or mutate canonical state merely to render it.
If an authorized revision adds metadata for a legacy fractional/negative round,
use the existing view's normalized grouping key without changing its cards.
New rounds use integer values. Both ordinary design and reconstruction follow
these preservation and evidence boundaries; introductions are display context,
not user answers or source-supported evidence by themselves.

Choice questions require at least two choices whose `value` and `label` are
non-empty. Integration validation requires every answered choice to resolve to
an option currently rendered by the FE. An invalid value is a failed write,
not a successful answer.

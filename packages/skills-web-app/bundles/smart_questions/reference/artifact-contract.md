# smart_questions output contract

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

Put a concise source-supported answer in `answer`; use `detail` for exact
source locations, observation versus supported inference, and remaining limits.
A supported interpretation may explain the overall product, but label it as
inferred, not stated user intent. Do not infer commercial positioning or target
audience merely from the presence of an admin route or a technical capability.
The visible answer should read as product understanding, not a source-code dump.
Reconstruction prefill is reviewable, not user confirmation; it is not a license
to guess answers during ordinary questioning.

If evidence supports part of the answer, retain that part and identify remaining
unknowns in `detail`. Split independent topics rather than let one known fact
mask a separate unknown. Leave genuinely unsupported answers empty. Missing
information in one summary document is not proof of absence in the repository:
inspect a relevant source when the missing fact matters. Preserve user answers
and explain conflicting source evidence without replacing their decisions.

Before closing, read the cards as a whole: can a reader understand the product's
purpose, intended users, main scenario and scope to the extent the source permits?
Are later details supporting that account rather than displacing it? Check that
`detail` does not contain a verified answer missing from `answer`, that unknowns
remain honest, and that each inference is supported. This is an Agent self-check,
not a new validator or host gate.

## Fixed-card contract

The executor carries these stable definitions and initialized defaults into a
new complete state, and preserves them on revision. Do not presume automatic
Core seeding: schema checks shape, and the declared Panel policy protects the
fixed cards' interactions. Keep both existing cards; never rename, replace or
modify their prompts/options. They are first-round configuration, not a reason
to repeat an interview.

| ID | Question | Values | Default |
| --- | --- | --- | --- |
| `const_auth_mode` | 是否需要注册登录？ | `anonymous` / `auth_required` | `anonymous` |
| `const_storage_mode` | 应用数据如何保存？ | `browser_temp` / `database_persistent` | `browser_temp` |

Their recommended choices match the initial defaults. Never attach `round` or
`rejected` to fixed cards or offer rejection. Preserve actual user answers and
details. In reconstruction, verify login and persistence instead of treating
defaults as evidence. If neither choice faithfully describes the implementation,
leave the answer empty and explain its actual scope in `detail`; durable files
do not imply cloud sync or a database. In ordinary authorized defaulting, retain
defaults unless the requirement establishes another choice.

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
confirmation; the fixed answers below demonstrate initialization only:

```json
{
  "rounds": {
    "0": {
      "title": "AI 使用方式",
      "description": "合成示例：澄清 AI 如何帮助用户完成当前任务。选项是待讨论的提案，不是已确认需求。"
    }
  },
  "questions": {
    "const_auth_mode": {
      "prompt": "是否需要注册登录？",
      "kind": "single",
      "choices": [
        {"value": "anonymous", "label": "不需要，直接使用", "recommended": true},
        {"value": "auth_required", "label": "需要，支持注册登录", "recommended": false}
      ],
      "answer": "anonymous",
      "detail": ""
    },
    "const_storage_mode": {
      "prompt": "应用数据如何保存？",
      "kind": "single",
      "choices": [
        {"value": "browser_temp", "label": "仅当前浏览器临时保存", "recommended": true},
        {"value": "database_persistent", "label": "持久保存，可跨设备继续使用", "recommended": false}
      ],
      "answer": "browser_temp",
      "detail": ""
    },
    "ai_interaction_method": {
      "prompt": "用户如何与 AI 交互？",
      "kind": "single",
      "choices": [
        {"value": "button_trigger", "label": "点击按钮触发分析", "recommended": true},
        {"value": "dashboard_widget", "label": "在报表页展示 AI 洞察卡片", "recommended": false}
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

The first two entries are fixed in state. The FE renders them at the bottom of
the first round only; add dynamic questions after them and the FE renders later
dynamic rounds without those fixed cards, newest first. When editing an
existing panel, carry the fixed-card definition and prior user decisions
forward into the complete canonical state without adding them to the new round.

- `value` is the stable selection token. `label` is visible text. Answers always store `value`, never a label, recommendation suffix, or invented internal token.
- `single` stores one `value`; `multiple` stores comma-separated `value`s; `text` stores its substantive free-text response in `answer` and has no choices. A known answer must not exist only in `detail`; the answer should remain understandable without opening the supplementary explanation.
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
- `detail` records the user's optional explanation, constraints, or source/provenance notes in reconstruction; it supplements rather than duplicates the answer. Preserve older detail-only records without automatically promoting uncertainty or provenance into an answer. When the user answers
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

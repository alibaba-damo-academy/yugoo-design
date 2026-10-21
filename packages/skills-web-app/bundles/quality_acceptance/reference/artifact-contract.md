# quality_acceptance output contract

Shared by ordinary design and reconstruction. Canonical state is
`quality_acceptance/quality_acceptance.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

Acceptance records describe observable promises, not new product behavior. During restoration distinguish documented requirements, implemented checks and supported implications in the existing wording. Do not convert a test fixture size or timeout into a product SLA, or claim a check has run because its code exists.

## Evidence model

Every item is one `AcceptanceRequirement`:

- `title`: a short promise a user can recognize, such as “订单提交成功” or “订单详情及时打开”.
- `group`: an optional free label for organizing requirements, such as “业务流程” or “AI 能力”. It is not a category catalog, source reference or passing result. Absent or blank labels are valid; preserve existing labels and ungrouped records without assigning categories during restoration or unrelated edits.
- `condition`: the concrete situation plus the user action or product event being checked.
- `pass_criteria`: the observable result or measurable threshold that means the requirement passes.
- `verification`: optional plain-language checking method when the pass criteria are not self-evident.

Correct product behavior and material experience quality use the same natural model. Classification is not a prerequisite; optional group labels only help navigation. Infer from the content whether passing requires an observable outcome, a measurable threshold, or both. A label edit preserves the record ID and `requirement_order`.

### 2. Write the checking condition

Combine the relevant starting situation and trigger into one natural sentence. Include only facts needed to understand the check.

Good:

- “用户已填写完整订单并点击提交”
- “没有订单编辑权限的成员直接打开订单编辑地址”
- “用户在普通网络下打开包含 100 条明细的订单”

Avoid background explanations, copied field lists, internal IDs, or several unrelated actions in one item.

Read each condition/pass-criteria pair independently, without borrowing a
previous example's state. Try a different starting state still allowed by the
condition: if it invalidates the claimed result, specify the relevant evidenced
starting state or assert preservation of the pre-action state instead. Apply
the same check to outcome strength: a bound on successful attempts is not a
guarantee that one succeeds. Preserve the source's quantifiers and unknown
retry behavior; do not add premises merely to make a stronger promise pass.

### 3. Write what passing means

For correct behavior, state only observable outcomes: what the user sees, what state is retained, what action is blocked, or what externally visible record exists.

For experience or quality, use a measurable threshold or a directly demonstrable standard. Name the relevant population or operating situation when needed. Avoid vague phrases such as “响应很快”, “系统稳定”, or “安全可靠”.

The pass criteria must not introduce a new rule. If the expected outcome is not supported by source evidence, identify the missing source decision instead of silently adding it here.

### 4. Add verification only when useful

Leave `verification` empty when a person can directly confirm the result from the condition and pass criteria. Add it when data setup, measurement, inspection, or a special demonstration is necessary.

Write the checking method in plain language, not test code, tool commands, staffing assignments, or a release plan.

Apply the same evidence and starting-condition checks to verification examples:
an illustrative follow-up must not promise more than the requirement itself.
Before closing, trace the source's material boundaries and failure cases to the
requirements. Explain any deliberate omission; do not substitute a happy-path
example for a separately stated concurrency, ownership or time-boundary promise.

### AI behavior as acceptance evidence

Use the existing AI product design's actual actions, trigger conditions, result
adoption and exceptions. A generated answer is not evidence that the product has
applied or saved it. Preserve source-backed confirmation, overwrite, partial
result and failure behavior; unknown behavior is a missing source decision, not
permission to promise automatic protection or success. These requirements remain
ordinary acceptance records. Do not edit the AI Bundle or automatically transfer
its records, and do not require AI design for unrelated acceptance work.

Synthetic example (not a user fact or a test that has run): if the source product
explicitly says an AI proposal stays in a draft until a person confirms it, a
requirement may say: condition “AI 已返回草稿建议，用户尚未确认采用”; pass criteria
“原有正式内容保持不变，建议仅在草稿中展示”. This promise is inappropriate for
a product that already writes before confirmation. Only source evidence or an
authorized product decision can establish that different behavior.

## State contract

Write `QualityAcceptanceState` with `requirements` and `requirement_order`. The generated JSON Schema is authoritative for exact types.

```json
{
  "schema_version": 4,
  "requirements": {
    "submit-valid-order": {
      "id": "submit-valid-order",
      "title": "订单提交成功",
      "condition": "用户已填写完整订单并点击提交",
      "pass_criteria": "生成订单号，状态显示为待处理，并提示提交成功",
      "verification": ""
    },
    "order-open-speed": {
      "id": "order-open-speed",
      "title": "订单详情及时打开",
      "condition": "用户在普通网络下打开包含 100 条明细的订单",
      "pass_criteria": "主要内容在 2 秒内可阅读",
      "verification": "使用典型订单数据记录主要内容出现的时间"
    }
  },
  "requirement_order": ["submit-valid-order", "order-open-speed"]
}
```

Do not persist separate scenario and quality-target catalogs, evidence status, priority, failure result, implementation tasks, risks, owners, release gates, assumptions, open questions, or test code.

## Quality gates

- At least one acceptance requirement proves an established core behavior.
- Every requirement has a clear title, concrete condition, and observable or measurable pass criteria.
- Any requirement about experience or quality is material and avoids a vague adjective-only target.
- Optional verification explains how to demonstrate the result without prescribing test code.
- One item does not bundle unrelated actions or independently passable promises.
- No requirement invents missing product behavior or duplicates a business rule.
- IDs are stable, mapping keys match item IDs, and `requirement_order` contains the intended complete display order.

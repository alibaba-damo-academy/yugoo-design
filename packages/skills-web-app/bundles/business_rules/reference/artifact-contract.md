# business_rules output contract

Shared by ordinary design and reconstruction. Canonical state is
`business_rules/business_rules.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

One rule expresses one independently checkable decision. A condition identifies the relevant situation or inputs; empty means unconditional, not unknown. Notes clarify a boundary or example without hiding another outcome. Preserve evidenced thresholds and exceptions instead of designing replacements.

Check the condition/outcome pair against a counterexample permitted by its
source: an upper bound limits what may happen; it does not promise that any
attempt succeeds. Preserve quantifiers, inclusivity and failure conditions in
the outcome, not only the title. If the outcome needs an additional premise,
use an established premise or retain the weaker guarantee; do not invent one.
Keep a role's grant or record-ownership restriction in Role Access rather than
copying it into an independent rule. A lifecycle or eligibility constraint can
refer to that established permission without defining a second permission policy.

## State contract

Write `schema_version: 4`, `rules` keyed by stable rule ID, and `rule_order` containing every key exactly once. Every rule has `id`, `title`, optional `condition`, required `outcome`, and optional `notes`. Empty optional values are `""`. Map keys equal nested IDs.

Do not add acceptance status, classification, scope, parameters, structured examples, failure branches, assumptions, or references.

```json
{
  "schema_version": 4,
  "rules": {
    "large-order-approval": {
      "id": "large-order-approval",
      "title": "大额订单需要经理审批",
      "condition": "订单含税总额超过 100,000 元",
      "outcome": "订单进入经理审批，审批通过后才能继续",
      "notes": "金额等于 100,000 元时不进入经理审批。"
    }
  },
  "rule_order": ["large-order-approval"]
}
```

## Quality gates

Every rule expresses one independent decision, has a recognizable title and deterministic outcome, and includes a condition only when behavior depends on a situation, trigger, threshold, or input. Calculations identify inputs and formula/result. Notes clarify rather than add hidden branches. Similar rules do not overlap or contradict. IDs remain stable and the order is complete and duplicate-free.

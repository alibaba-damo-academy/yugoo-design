# integration_design output contract

Shared by ordinary design and reconstruction. Canonical state is
`integration_design/integration_design.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

One record represents an independently useful external capability. The Plugin-style fields describe that connection; they do not establish that the source product uses an Agent or that a Plugin has been implemented. Reconstruct actual access and success/failure behavior. Never copy credential values from source files into Design Files. An unavailable URL or authentication fact stays an explicit limit, not an invented connection.

### 4. Author the Plugin fields

For every integration, complete the visible Plugin creation form from established evidence:

- **Name (`title`)**: a short user-recognisable capability name, not a vendor-only label such as “WMS API”.
- **Description (`description`)**: one sentence stating what the connection does and the useful result it returns to the product.
- **URL (`url`)**: the confirmed service entry or documentation URL. Do not guess a host, path, protocol, or environment.
- **API Secrets (`secrets`)**: only credentials the documented connection actually requires.
- **Prompt (`prompt_content`)**: natural-language instructions describing the established consumer's usage of the connection.

A useful Description follows this pattern:

```text
<action in the external system> and <result made available to the product>
```

Good: `向 WMS 创建发货任务，并返回任务编号和创建状态。`

Weak: `连接 WMS。`

### 5. Record credential requirements safely

Create a credential requirement row only when authentication evidence requires it. Design Files and session events are durable product-design records, not a secret store.

- Give each row a stable ID and preserve it across edits.
- `name` is the credential name established by documentation or the user, such as `WMS_API_KEY`.
- `description` explains what the credential authorises and what the user must configure through the host credential service.
- Never request, accept, or persist a credential value in this Bundle. A value supplied in chat remains outside Design Files and must not be copied into state.
- Never invent a credential name from convention alone. If the documentation only says “authentication required”, leave the credential detail unresolved.
- Keep `secret_order` complete, unique, and aligned with the `secrets` mapping.

### 6. Write a usable Prompt

`prompt_content` expresses usage for this panel's integration consumer, not a marketing description or API schema. When restoring a non-Agent integration, translate its existing caller, trigger, task and result into this field; do not introduce an Agent into the source product. It should answer the applicable parts of four questions:

1. **When** does the established consumer use this connection?
2. **What** business task should it complete?
3. **Which established business context** does it need conceptually?
4. **What useful result** should it return or preserve?

Example:

```text
订单审核通过后，使用 WMS 创建发货任务；提交当前订单、收货信息和商品明细，并返回发货任务编号和创建状态。
```

Do not place credentials, invented request/response fields, retry policy, or broad product workflow prose in the Prompt. Technical field-level contracts belong to verified Plugin documentation or later implementation, not this general design state.

### 7. Fill the panel's “备注”

The FE shows the optional `business_rules` field as **备注**. It may be absent or empty when no additional integration-specific note is needed; neither save nor completion requires filler text. When applicable, it records the product-side consequences that the connection must respect. Use short Markdown bullets and include only applicable decisions:

- the business trigger or timing;
- what product state or evidence changes after success;
- what remains unchanged and what the user sees after failure;
- duplicate prevention, retry, reconciliation, or manual recovery when materially important.

Keep the remarks concise. Do not repeat the Description, Prompt, URL, secret instructions, or API fields. If an established general rule already exists in the `business_rules` Skill, keep that Skill authoritative and mention only the integration-specific consequence here.

Example:

```text
- 订单审核通过后执行
- 成功后保存发货任务编号，并将订单更新为等待出库
- 失败时保留订单当前状态并提示重试；同一订单不得重复创建发货任务
```

## State contract

Write `IntegrationDesignState` exactly. The Bundle schema and its validator are authoritative. The current locked contract is `schema_version: 8`; do not add presentation fields, request/response schemas, AI Quick Fill content, provider questionnaires, platform Plugin references, or hidden completion metadata.

```json
{
  "schema_version": 8,
  "integrations": {
    "create-shipment": {
      "id": "create-shipment",
      "title": "创建发货任务",
      "description": "向 WMS 创建发货任务，并返回任务编号和创建状态。",
      "url": "https://wms.example.com/shipments",
      "secrets": {
        "wms-api-key": {
          "id": "wms-api-key",
          "name": "WMS_API_KEY",
          "description": "用于创建和查询 WMS 发货任务"
        }
      },
      "secret_order": ["wms-api-key"],
      "prompt_content": "订单审核通过后，使用 WMS 创建发货任务；提交当前订单、收货信息和商品明细，并返回发货任务编号和创建状态。",
      "business_rules": "- 订单审核通过后执行\n- 成功后保存发货任务编号，并将订单更新为等待出库\n- 失败时保留订单当前状态并提示重试；同一订单不得重复创建发货任务"
    }
  },
  "integration_order": ["create-shipment"]
}
```

The mapping key and `id` must match. `integration_order` must contain every integration ID exactly once. Every secret mapping key must equal its `id`, and `secret_order` must contain every secret ID exactly once.

## Quality gates

Before returning, verify all of the following:

- Every record represents a product-relevant external capability with a clear boundary and outcome.
- Records are split by independently meaningful capability, not mechanically by system or endpoint.
- Every record has a complete Name, Description, confirmed URL, and Prompt. “备注” is optional, not a completion prerequisite.
- Every record carries no platform Plugin reference and is not described as complete while one of those required facts is unresolved.
- Every credential requirement is evidenced, named, explained, stably identified, and ordered. Credential values never enter Design Files or session events.
- Every Prompt explains the connection's established trigger, task, consumer and useful result without inventing a new caller.
- Any provided “备注” explains applicable product-side trigger, success, failure, and recovery behavior without duplicating the Prompt or API syntax. Do not invent consequences merely to populate it.
- No request/response field editor, AI Quick Fill field, provider questionnaire, page design, role permission, or general business-rule catalog has been added.
- Every mapping and order array is exact, with no missing, duplicate, or dangling IDs.
- Unknown technical facts remain explicit deliverable gaps rather than plausible inventions.

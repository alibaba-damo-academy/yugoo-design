# notification_design output contract

Shared by ordinary design and reconstruction. Canonical state is
`notification_design/notification_design.json`; the installed schema and validation remain
authoritative. This reference describes representation and semantic checks,
not permission to invent facts, choose new policy or trigger user review.
Examples and design recommendations below are not source evidence. In
reconstruction, preserve observed behavior and supported uncertainty; report
required facts that cannot be represented rather than fabricating a value.

Notifications are proactive human communication, not on-page feedback, audit records or machine callbacks. During restoration preserve evidenced channels, audiences and timing; do not replace an external channel with a recommended in_app default. A desired channel is not proof of an implemented delivery integration.

### 2. Answer “when” in one natural sentence

`trigger` combines the established business moment, any necessary condition, and the actual timing in one answer. Write only the detail needed to know when the notification occurs.

Good: “订单进入待审批且审批任务创建成功后立即提醒；2 小时仍未处理时再提醒一次.”

Too vague: “及时提醒.”

Too fragmented: copying the whole workflow, approval rule, or implementation schedule into this field.

If repetition matters, include the limited reminder behavior in the same sentence. Do not create separate event, condition, timing, or anti-noise fields for the user to reconcile.

### Recipients

Each `recipients` entry names one person type or established role in the actual audience.

Use precise natural expressions such as “订单创建人” or “有权审批该订单的销售经理”. If the evidence says “所有管理员”, preserve that audience rather than silently narrowing it.

### 4. Separate built-in notification from external delivery

Use the reserved channel value `in_app` for the product's built-in application notification. The product can own its content, unread state, and action entry.

Any other `channels` value is a natural-language external human delivery method, such as “企业邮箱”, “短信”, or “企业微信机器人”. External methods express the intended reach but do not prove that the product can send them. They require an established Plugin, API, or third-party service owned by `integration_design`.

If the necessary integration is not established, keep the evidenced method understandable and report the integration dependency; do not invent provider support, credentials, or implementation details. Machine callbacks and webhooks are integrations, not notification channels in this skill.

### 5. Write useful message intent and action

`message` describes the information the recipient must understand, not polished final copy. It should normally make clear:

- what changed;
- which business item is affected;
- why it matters;
- what the recipient should do, when action is required.

Use `action_target` only when the user can open a known page or task. Name the destination and relevant area in product language, such as “订单详情的审批区域”. Do not invent URLs or page IDs.

## State contract

Write exactly one `NotificationDesignState`. The generated schema is authoritative for exact types and rejects unknown fields.

```json
{
  "schema_version": 3,
  "notifications": {
    "order-rejected": {
      "id": "order-rejected",
      "title": "订单被驳回",
      "trigger": "订单被驳回且驳回原因保存后立即提醒，同一次驳回只提醒一次",
      "recipients": ["订单创建人"],
      "channels": ["in_app", "企业邮箱"],
      "message": "说明订单已被驳回、驳回原因和需要修改的内容",
      "action_target": "订单详情的修改区域"
    }
  },
  "notification_order": ["order-rejected"]
}
```

Contract rules:

- `schema_version` is always `3`.
- Every key in `notifications` equals that record's `id`.
- `notification_order` contains every notification ID exactly once and no unknown ID.
- A persisted notification has no evidence-review `status`; it is the current notification fact and may be edited by a later save.
- Recipients are non-empty, unique user or role names.
- `in_app` is the only reserved built-in channel value. Other values are non-empty, unique natural-language external delivery names and require corresponding integration evidence.
- Do not add top-level title or summary, message templates, HTML, machine endpoints, dashboards, reports, metrics, exports, audit logs, or implementation-only delivery settings.

## Quality gates

Before close-out, verify all of the following:

- Every notification traces to an established business event.
- Recipients preserve the evidenced audience and its conditions.
- Every record has at least one recipient, one human channel, and useful message intent.
- The trigger clearly answers when the notification is sent without duplicating the whole workflow or business rule.
- Channels and repetition preserve the evidenced delivery behavior.
- Every external channel has established integration evidence or is reported as an unresolved integration dependency; it is never presented as built-in support.
- Action targets refer to established product destinations.
- On-page feedback, reports, dashboards, audit history, and machine integrations are not disguised as notifications.

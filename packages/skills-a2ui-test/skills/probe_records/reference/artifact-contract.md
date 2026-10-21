# probe_records 输出契约

唯一 canonical 状态是 `probe_records/probe_records.json`。根对象只含 `schema_version: 1` 与 `functions`。`functions` 是以稳定 ID 索引的 map，字段形态借鉴 Web App 的 `function_modules`：`function_id`、`function_name`、`function_description`、`function_epic` 是字符串，`priority` 为 `High | Medium | Low`，`rejected` 是布尔值。此测试 Bundle 不共享 Web App 的真实状态，也没有附件或跨 Bundle 引用。

运行时用当前 `schema.yaml` 与 `validation.yaml` 校验；本说明供 Agent 从 Bundle 资源接口阅读。Panel 中可编辑记录字段，保存写回同一 Design JSON。记录 ID 的新增和删除仅在用户要求下由执行者修订 canonical，不因重新生成面板而变化。[示例](state-example.json)是虚构场景，不能作为已确认事实。

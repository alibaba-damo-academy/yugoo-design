---
name: probe_records
description: |-
  - **Capability**: 用无预定义面板的 Bundle 维护一组可编辑记录。
  - **Resolves**: 验证 A2UI 能从普通 map-of-records schema 推导记录表单，而非只会呈现问答。
  - **Candidate when**: 用户要测试记录型自动面板。
  - **Do not infer**: 示例记录不是当前用户事实，也不代表产品功能规划。
  - **Output**: `probe_records/probe_records.json`。
---

# 记录型自动面板测试

## 输入与输出入口

仅拥有 `probe_records/probe_records.json`。先完整读取 [输出契约](reference/artifact-contract.md)；[合法示例](reference/state-example.json)只供测试，不是用户事实。DSH 通过 `read_skill_resource({path:"reference/artifact-contract.md"})` 读取；其他宿主使用 prepare 返回的资源根。

## 方法

根据用户给出的一个小场景创建一至两张功能卡，说明功能名称、描述、分组、优先级与是否被拒绝。数据形态借鉴 Web App 的功能模块，但此测试 Bundle 不替代正式 `function_modules`。未知内容先向用户确认，不把示例或推荐值当作答案。首次创建用稳定 ID；修订时读取已保存状态与 Panel save diff，只改本次相关记录，保留其余 ID 和字段，不重放刚保存的修改。

## 校验与交接

使用当前宿主的 Bundle 校验入口验证 schema 与 completion 规则。面板完全由系统根据 schema 和 Design JSON 派生；不写 `panel.yaml`、生成缓存或其他 Bundle。保存后交给用户检查记录，说明哪些字段仍待确认。DSH 的 must_edit 流程按当前 design_validate/design_publish 入口执行，native 宿主使用当前 adapter 的等价操作。

---
name: probe_report
description: |-
  - **Capability**: 维护嵌套报告状态及同 Bundle 的文本产物。
  - **Resolves**: 验证 A2UI 能同时阅读结构化 Design JSON 与实际 artifact，不依赖问答 schema。
  - **Candidate when**: 用户要测试结构化数据加文件产物的自动面板。
  - **Do not infer**: 不将示例报告、产物内容或生成布局视为用户确认的事实。
  - **Output**: `probe_report/probe_report.json` 和条件性的 `probe_report/report.md`。
---

# 结构与产物自动面板测试

## 输入与输出入口

先完整读取 [输出契约](reference/artifact-contract.md)。仅拥有 `probe_report/probe_report.json` 与 `probe_report/report.md`；[合法示例](reference/state-example.json)和[示例产物](reference/report-example.md)均为虚构测试材料。DSH 使用绑定 Bundle 的 `read_skill_resource({path:"reference/artifact-contract.md"})`，native 宿主按 prepare 返回的资源根读取。

## 方法

从用户给出的一个简短主题建立标题、摘要、状态与发现列表。报告 Markdown 是展开说明，不是第二份 canonical 状态；仅在用户要求具体报告或状态足以支持报告时生成。报告内容必须对应当前 JSON，不补造结论。首次生成使用已确认事实；修订时先核对 Panel save diff，保留未受影响的发现，相关事实变化时同步修订报告，不重放已保存的 UI 修改。

## 校验与交接

用当前宿主的 Bundle 校验入口验证 JSON；如写了 Markdown，另检查文件真实存在且其陈述与 JSON 相符。面板由系统根据 schema、Design JSON 和同 Bundle artifact 派生，不写 `panel.yaml` 或生成缓存。报告用户当前状态、真实产物和未确认项；must_edit 时交给用户在面板检查，GRA 不作前置条件。

---
name: probe_questions
description: |-
  - **Capability**: 生成并修订用于 A2UI 面板测试的小型问题清单。
  - **Resolves**: 验证没有预定义 Panel 的 Bundle 是否仍能提供可编辑、可保存的 UI。
  - **Candidate when**: 用户明确要测试此独立 Kit 的生成式面板。
  - **Do not infer**: 不把推荐选项、示例答案或生成 UI 当成用户确认的事实。
  - **Output**: `probe_questions/probe_questions.json`；A2UI 视图由系统派生，不是本 Bundle 的 canonical 文件。
---

# 自动面板测试问题

## 输入与输出入口

唯一 canonical 文件是 Design Files 下的 `probe_questions/probe_questions.json`。新建或修订前读取 [输出契约](reference/artifact-contract.md)；其中的 [合法示例](reference/state-example.json) 是虚构测试情境，不是当前用户的答案。DSH 使用 `read_skill_resource({path:"reference/artifact-contract.md"})`，分页读到结束；native 宿主按 prepare 返回的 resources 根读取，不猜开发机路径。

## 方法

请用户给出一个足够小的真实测试场景。提取 2–3 个会影响该场景理解的具体问题：至少一个文本问题，可选一个单选问题以检验控件。问题本身与推荐选择不是已确认事实，未回答时 `answer` 必须是空字符串。已有用户陈述可按原意写入答案，但要说明来源。不要加入登录、支付等无关固定卡，也不要强迫走完整访谈。

首次创建时使用稳定、可读的 question key；保存继续时以已持久化 diff 为准，不重复写用户刚保存的答案。新增、改题、删题只处理用户本次授权范围，保留不相关 key。Design File 变化会使当前生成面板失效，须等待系统重新生成后再编辑；生成失败时报告只读回退，不能手写 `panel.yaml` 假装成功。

## 校验与交接

写入状态后用当前宿主的 Bundle 校验入口检查结构和 completion 规则。此 Bundle 的 `must_edit` handoff 要求先交给用户在面板里回答；DSH 可用 `design_validate({outcome:"pause"})` 后 `design_publish({action:"handoff"})`，native 宿主用当前 adapter 的等价流程。不要直接修改生成缓存或其他 Bundle。报告实际保存的文件、已确认答案与尚待用户回答的问题；GRA 是独立后台工作，不是前台等待门槛。

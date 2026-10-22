---
name: design-kit-creator
description: 创建或修订 Design System Kit，编写领域 Mindset、组合独立 Bundle 并接入目录；组合 design-bundle-creator 与 design-skill-creator。不用于开启已有 Kit 的设计会话。
---

# Design Kit Creator

Kit 可以理解为一位领域专家的工作方式与工具箱：Mindset 描述专家的人格与表达风格、思考模式和特殊考虑，Bundle 提供可调用的专业能力。按用户能独立理解、修改和持续维护的信息切片划分 Bundle；原系统的 skill 数、菜单数、技术步骤数都不直接决定 Bundle 数。

## 开始与组合

读取 [kit-checklist.md](references/kit-checklist.md)。确认新建/迁移/修订的范围；迁移先读原产品真实主流程、对客视图、数据与生成路径，不能只根据项目简介拆目录。

必须读取并使用 [design-bundle-creator](../design-bundle-creator/SKILL.md)，由它进一步使用 design-skill-creator。每个新增或实质修订 Bundle 都走该契约；现有未改 Bundle 只核对依赖兼容，不重新生成。技能缺失时说明而不伪造组合完成。

## Kit 层工作

1. 明确受众、决策/设计目标、最小有价值闭环和不做的事情。说明每个 Bundle 的独有事实、交互视图、上下游证据，不以工作流阶段充当切片。
2. 编写或整理 `mindset.md` 时读取 [Mindset 写作规范](references/mindset-authoring.md)：明确领域专家的职责与协作方式，补充影响判断的领域知识、跨 Bundle 关系与特殊约定。自动挂载目录已有普通能力入口，不逐项复述，不替代 Bundle 操作手册；修订先列原内容保留映射。
3. 调用 Bundle 层完成信息切片，在 Kit 内校验命名、目录/catalog 和引用一致。使用现有 discovery/装载规则，不在 Host 写死新 Kit 名。
4. 复用系统 GRA、KAG、场景体验和发布能力；领域语义属于 Kit，系统调度/图数据库/宿主身份不归 Kit。可选求解器/外部数据等依赖必须不被误写成通用安装前提。
5. 用一个跨 Bundle 小场景串联实际事实和引用，再测一次中途修改影响；允许用户直接进入相关切片，不强迫完整访谈或跑完全部 Bundle。

## 交付标准

Kit 介绍和使用说明遵循[面向读者的文档原则](../design-skill-creator/references/standards.md#面向读者的文档reader-focused)：先讲适用任务、入口与结果，维护和验证记录单独组织，不将作者的测试步骤变成日常使用流程。

逐 Bundle 汇总下层验证证据；Kit loader 的动态发现/加载和跨切片语义自洽分别验证。用户测试说明给出现有入口与一个最小请求，区分源码、安装包、真实宿主已测范围。不得为“创建完成”自动安装插件、修改用户项目或宣称所有宿主已验证。

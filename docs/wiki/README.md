# 语构设计系统（Yugoo Design）Wiki

简体中文 · [English](README.en.md)

本 Wiki 是完整项目手册：从在已有智能体宿主（Agent Host）中开始设计，到项目与 Git 历史、能力原理、Kit 和 Studio、内容创作及源码开发。你可以先走最短使用路径，需要细节时再查对应章节；安装和运行范围以所选版本与宿主指南为准。

[项目首页](../../README.md) · [English README](../../README.en.md) · [文档总览](../README.md) · [开始使用](getting-started.md) · [全部命令](commands.md) · [反馈](support.md)

## 从哪里读起

- **完成自己的设计：**[安装并开始](getting-started.md) → [客户项目交付教程](web-app-demo.md) → [日常使用](usage.md)。按[套件用户指南](official-kits.md)选择当前需要的设计活动。
- **理解系统及全部能力：** 先看[产品理念](../product-vision.md)、[核心概念](concepts.md)和[运行机制导览](architecture.md)，再按下面的能力表查 U/S/T、KAG、GRA、保存与交接；[完整命令](commands.md)说明 `/yugoo` 参数。
- **把专业方法做成工具：**[最小定制](custom-kit-tutorial.md) → [创作规则](extending.md) → [Studio](usage.md#6-studio查看定制和检验套件) → [分享给接收者](kit-sharing.md)。
- **参与源码开发：**[开发指南](development.md) → [架构基线](../system-design-baseline.md)与所属包 README → [贡献、测试与发布](../../CONTRIBUTING.md)。

## 第一次使用

| 想做什么 | 阅读入口与结果 |
| --- | --- |
| 准备宿主、配置模型并安装或更新 | [开始使用](getting-started.md)、[宿主兼容](hosts.md)：找到当前宿主入口并完成启用 |
| 创建项目并请求一个结果 | [客户项目交付教程](web-app-demo.md)：从目标进入具体面板，人的反馈改变设计 |
| 了解可用领域能力 | [官方套件用户指南](official-kits.md)、[获取清单](kit-sharing.md#official-kits)：区分默认随装 Kit 与可独立获取的公开示例 |
| 理解界面中的名称 | [核心概念](concepts.md)、[术语](terminology.md)：区分 Project、Kit、Mindset、Bundle、Panel、Studio |
| 查看实际版本和运行限制 | [宿主范围](hosts.md)、[预览状态](preview-status.md)：了解所选版本的可用能力与限制 |

## 日常操作与完整命令

| 任务 | 在哪里查 | 正常结果与边界 |
| --- | --- | --- |
| 创建、打开、列出、切换或关闭项目；选择 Kit | [完整命令与参数](commands.md)、[项目选择](usage.md#1-选择项目与目标) | 明确当前项目及其 Kit 内容；自然语言与可用宿主命令共用服务 |
| 查看、编辑、保存、重开面板 | [面板操作](usage.md#2-查看并修改-panel) | 保存的设计成为后续依据；页面打开和保存完成是不同结果 |
| 读建议并决定是否采纳 | [处理建议](usage.md#3-处理建议) | 接受后选择修订、澄清或研究；需要改设计时通过所属 Bundle，建议处置本身不改变设计 |
| 查看 Git 历史、迁移旧项目或移除登记 | [管理与恢复](usage.md#4-管理与恢复)、[参数参考](commands.md) | 版本历史支持追溯；`migrate` 新建适配后的项目，移除登记保留文件 |
| 从既有材料或软件重建设计 | [材料重建](usage.md#5-从既有材料重建设计) | 保留观察依据和未决项，通过所属 Bundle 形成设计文件 |
| 整合 PRD 或准备开发任务 | [套件用户指南](official-kits.md)、[开发交接](../design-development-handoff.md) | 保留源设计，交接按当前任务及代码库已有 spec 组织 |

## 能力与原理

| 能力 | 用途与操作入口 | 进一步说明 |
| --- | --- | --- |
| 可交互成果与缺口驱动循环 | AI 根据当前目标、证据和人的反馈选择有意义的行动；按需打开问答、图表或原型 | [三个核心机制](concepts.md#三个核心机制)、[产品理念](../product-vision.md) |
| Project、Kit、Mindset 与 Bundle | 项目保存成果与版本；Kit 组织领域专家的方法和工具箱，Bundle 提供聚焦能力 | [名称与职责](concepts.md#名称与职责)、[套件用户指南](official-kits.md) |
| 清晰度评估（U/S/T） | 结合证据理解本轮还缺什么，追问判断依据和下一步 | [核心概念](concepts.md#清晰度评估与下一步建议)、[评分解释](../ust-score-explanations.md)、[日常操作](usage.md) |
| 知识图谱（KAG） | 关联独立设计来源，辅助查找改动影响及依据 | [概念与使用](concepts.md#知识关联与审查)、[知识来源策略](../design-knowledge-source-policy.md)、[日常操作](usage.md) |
| 主动审查（GRA） | 从一致性、知识疑点和意图三个视角提出建议；按宿主选择后台、同步或手动 | [处理建议](usage.md#3-处理建议)、[宿主限制](hosts.md#后台能力与评审降级)、[建议阅读](../advisory-reading.md) |
| 文件保存与 Git 版本历史 | 保存后继续、追溯修改并迁移旧项目；Git 运行库随包提供 | [项目管理](usage.md#4-管理与恢复)、[项目文件及备份](project-files.md)、[项目参数](commands.md) |
| 设计到开发 | 将任务所需设计依据交给编码 Agent，并把新发现的问题送回所属设计维度 | [交接指南](../design-development-handoff.md)、[教程](web-app-demo.md) |
| 共享基础与宿主适配 | Core 保持项目/执行语义；Panel/Studio 共用表达，宿主提供会话、模型和原生接入 | [运行机制导览](architecture.md)、[系统架构](../system-design-baseline.md)、[接入入口](../../packages/companion/HOSTS.md) |

## 体验与扩展

| 想做什么 | 阅读入口 |
| --- | --- |
| 设计 Web App 的功能、流程、数据、权限、页面及 AI 能力 | [套件用户指南](official-kits.md)、[客户项目交付案例](web-app-demo.md) |
| 看软件页面以外的表达 | [非 Web 示例](non-web-kit-demo.md)、[社区工坊配送](../../examples/community-workshop-delivery/README.md)、[现场作业](../../examples/field-operations-shared/README.md) |
| 在 Studio 查看 Mindset、挂载与 Bundle，检查样例预览 | [Studio 操作](usage.md#6-studio查看定制和检验套件)：编辑当前内容，按需复制独立身份；区分源码保存、样例预览与真实试运行 |
| 创作 Kit、Mindset、Bundle 和 Panel | [最小定制](custom-kit-tutorial.md)、[扩展开发](extending.md)、[Panel DSL](../dsl-spec.md)、[共享 UIUX](../panel-uiux-standard.md) |
| 分享、加载、更新或恢复内容 | [Kit 分享与恢复](kit-sharing.md)、[项目内容维护](../project-content-upgrade.md)：内容库原地保存，已有项目保留自己的完整 Kit 文件 |

## 开发与参与

- [开发指南](development.md)：环境、源码分层、相关构建和验证入口。
- [贡献指南](../../CONTRIBUTING.md)：代码、领域方法、文档、翻译与例子，以及维护者发行流程。
- [文档总览](../README.md)：定位架构、Bundle、DSL、模型接入与组件等稳定技术参考。
- [命名规范](terminology.md)、[AGENTS.md](../../AGENTS.md)：术语、工作方式与验证范围。
- [问题反馈](support.md)、[安全报告](../../SECURITY.md)：普通问题与敏感问题的不同渠道，启用状态按各页说明。
- [公共文档同步](../public-document-sync.md)：单一维护源、分类和固定源码导出；源码同步与 npm 发布分别操作。

## 运行边界与排障

宿主提供模型、凭据、工具和原生 Agent。各宿主的面板呈现、后台审查和安装更新机制可以不同；详细配置及限制查[宿主指南](hosts.md)。本地知识计算和模型准备查[安装细节](getting-started.md#环境与安装细节)。

遇到入口、连接、生成、保存或继续设计的问题时，查[故障排查](troubleshooting.md)。需要确认某项功能在当前版本是否可用，查[预览状态](preview-status.md)。

## 契约与参考

- [产品理念](../product-vision.md)
- [系统架构基线](../system-design-baseline.md)
- [Bundle contract](../bundle-contract.md)
- [Panel DSL](../dsl-spec.md)
- [宿主与模型接入契约](../system-design-baseline.md#agent-host-and-user-interface-integration)与[宿主接入入口](../../packages/companion/HOSTS.md)
- [知识关联与审查契约](../system-design-baseline.md#grounding-reflection-and-alignment)
- [贡献者与 coding-agent 规范](../../AGENTS.md)

## 文档与版本

教程中的界面和操作可能随宿主、插件及套件版本变化。Studio 当前内容编辑与项目内 `design_kit` 文件说明对应 `0.2.3` 发行版，具体步骤见[Kit 分享指南](kit-sharing.md)；Studio 完整创作流程的验证仍在进行。开始前可查[宿主兼容](hosts.md)；示例附有拍摄或使用时的版本与范围，当前发行、实测范围与已知问题见[预览状态](preview-status.md)。

希望改进文档、翻译或例子，可阅读[贡献指南](../../CONTRIBUTING.md)与[命名规范](terminology.md)。[英文 README](../../README.en.md)提供对应的项目介绍；问题和建议见[反馈入口](support.md)，文档维护与公开同步规则见[公共文档同步](../public-document-sync.md)。

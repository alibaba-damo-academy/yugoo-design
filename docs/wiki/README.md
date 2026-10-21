# 语构设计系统（Yugoo Design）Wiki

在已有智能体宿主（Agent Host）中，与 AI 一起澄清、查看、修改并继续设计。如果方案需要符合你的习惯、业务情况或判断，这里介绍如何把这些信息带进设计，并在后续讨论中保留下来。本 Wiki 是开发仓和公开源码共用的文档入口；安装与使用以所选候选版本及宿主指南为准。

[项目首页](../../README.md) · [开始使用](getting-started.md) · [宿主兼容](hosts.md) · [使用指南](usage.md) · [反馈](support.md)

## 从哪里读起

- **用现成套件完成自己的设计：**先[安装并开始一次协作](getting-started.md)，按[官方 Kit 用户指南](official-kits.md)选择设计活动，再沿[工作室项目交付教程](web-app-demo.md)体验面板、反馈、关联审查与整合；日常操作查[使用指南](usage.md)。[官方套件清单](kit-sharing.md#official-kits)集中说明版本和获取方式。
- **把自己的专业方法做成工具：**先做[最小定制教程](custom-kit-tutorial.md)，再从[扩展开发](extending.md#一个最小创作闭环)查 Kit、Bundle 与交互表达的规则，借助[Studio](usage.md#6-studio查看定制和检验套件)检查效果，按[分享指南](kit-sharing.md)交给接收者验证。
- **理解系统为什么这样工作：**先看[产品理念](../product-vision.md)，再看[三个核心机制](concepts.md#三个核心机制)与[名称职责](concepts.md#名称与职责)。可交互展开、缺口驱动推进、结构化整合与校准，共同服务于“理解、思考、表达、对齐”。

## 第一次使用

| 想做什么 | 阅读入口 |
| --- | --- |
| 选择宿主并安装插件 | [开始使用](getting-started.md)、[宿主兼容](hosts.md) |
| 使用默认 Web App 套件或获取其他官方套件 | [官方设计套件清单与 Agent 获取指引](kit-sharing.md#official-kits) |
| 了解各套件能做什么、在面板里判断什么 | [官方 Kit 用户指南](official-kits.md) |
| 跟着一个案例完成协作 | [工作室项目交付教程](web-app-demo.md) |
| 创建项目、请求设计、保存后继续 | [使用指南](usage.md) |
| 查看、复制方法或检验一个面板 | [Studio 操作](usage.md#6-studio查看定制和检验套件) |
| 理解 Kit、Bundle、Panel 和设计文件 | [核心概念](concepts.md) |
| 定位安装、连接、模型和保存问题 | [故障排查](troubleshooting.md) |
| 查看当前交付范围 | [预览状态与验证范围](preview-status.md) |

## 体验与扩展

- [Web App 协作教程](web-app-demo.md)：工作室的范围、修改与交期如何逐步变成设计；页末保留社区活动原型的历史实测与截图。
- [非 Web Kit 演示](non-web-kit-demo.md)：样例记录编辑和 Agent 生成决策澄清的不同路径。
- [最小定制教程](custom-kit-tutorial.md)：创建独立 Kit，复用完整 Bundle，调整方法引导、面板文案和样例。
- [扩展开发](extending.md)：领域方法、Bundle 声明、Panel 组件及验证。
- [Kit 分享与恢复](kit-sharing.md)：官方套件清单与获取指引、内容副本、版本选择、冲突和原件恢复。
- [社区工作坊 Kit](../../examples/community-workshop-delivery/README.md)与[现场作业 Kit](../../examples/field-operations-shared/README.md)：可检查的合成示例。
- [设计到开发交接](../design-development-handoff.md)：按具体任务组织设计依据和反馈。

## 开发与参与

- [开发指南](development.md)：源码分层、环境、验证和改动流程。
- [命名与术语翻译](terminology.md)：产品名称、中文（英文）对照及技术标识边界。
- [贡献指南](../../CONTRIBUTING.md)：贡献代码、专业方法、文档和例子。
- [问题反馈](support.md)：准备复现信息；公开 Issues 和模板仍待配置。
- [安全报告](../../SECURITY.md)：敏感问题的私密报告路径及启用状态。
- [公共文档同步规范](../public-document-sync.md)：单一维护源、分类及固定提交同步。

## 契约与参考

- [产品理念](../product-vision.md)
- [系统架构基线](../system-design-baseline.md)
- [Bundle contract](../bundle-contract.md)
- [Panel DSL](../dsl-spec.md)
- [宿主与模型接入契约](../system-design-baseline.md#agent-host-and-user-interface-integration)与[宿主接入入口](../../packages/companion/HOSTS.md)
- [知识关联与审查契约](../system-design-baseline.md#grounding-reflection-and-alignment)
- [贡献者与 coding-agent 规范](../../AGENTS.md)

## 文档与版本

使用教程描述实际入口和操作，示例页面保留当时版本的验证记录。源码能力、已安装候选和正式发行分别记录；查看[预览状态](preview-status.md)及[宿主兼容](hosts.md)，不要由一张截图或一次通过推断其他环境。

维护时同时核对方法、实际源文件与对应验证。中文术语遵循[命名规范](terminology.md)，README 保持[完整中英对应](../../README.en.md)；公开版本从固定开发提交同步，渠道待办见[反馈入口](support.md#待补齐的渠道)。

# 语构设计系统（Yugoo Design）文档

按你现在想完成的事情选择入口。使用指南、创作教程与技术参考各有用途，下面的链接指向各自维护的原文。

[项目首页](../README.md) · [English README](../README.en.md) · [用户 Wiki](wiki/README.md) · [贡献指南](../CONTRIBUTING.md)

## 安装与使用

| 想做什么 | 阅读入口 |
| --- | --- |
| 安装插件、选择宿主 | [开始使用](wiki/getting-started.md)、[宿主兼容](wiki/hosts.md) |
| 理解项目、套件和面板 | [核心概念](wiki/concepts.md) |
| 查项目目录、文件作用与备份迁移边界 | [项目文件管理](wiki/project-files.md) |
| 跟着一个案例开始设计 | [Web App 协作教程](wiki/web-app-demo.md)、[官方套件用户指南](wiki/official-kits.md) |
| 创建项目、修改面板、保存后继续 | [使用指南](wiki/usage.md) |
| 查阅全部 `/yugoo` 命令与参数 | [完整命令参考](wiki/commands.md) |
| 使用清晰度、知识关联、主动审查及版本恢复 | [项目手册能力索引](wiki/README.md#能力与原理)、[日常使用](wiki/usage.md) |
| 查看版本与可用范围 | [预览状态](wiki/preview-status.md)、[套件清单与获取](wiki/kit-sharing.md#official-kits) |
| 排查问题或反馈建议 | [故障排查](wiki/troubleshooting.md)、[问题反馈](wiki/support.md) |

## 创作套件与面板

| 想做什么 | 阅读入口 |
| --- | --- |
| 第一次定制设计套件（Kit） | [最小定制教程](wiki/custom-kit-tutorial.md) |
| 组合领域方法、设计技能包（Bundle）与交互面板 | [扩展开发](wiki/extending.md) |
| 用 Studio 查看和修改内容 | [Studio 操作](wiki/usage.md#6-studio查看定制和检验套件) |
| 分享、导入或恢复套件 | [套件分享与恢复](wiki/kit-sharing.md) |
| 参考其他领域的表达 | [非 Web Kit 示例](wiki/non-web-kit-demo.md)、[社区工作坊示例](../examples/community-workshop-delivery/README.md) |

创作技能入口：[Kit Creator](../.agents/skills/design-kit-creator/SKILL.md)、[Bundle Creator](../.agents/skills/design-bundle-creator/SKILL.md)、[Skill Creator](../.agents/skills/design-skill-creator/SKILL.md)。

## 理念与架构

| 主题 | 阅读入口 |
| --- | --- |
| 为什么要帮助人理解、思考、表达并与 AI 对齐 | [产品理念](product-vision.md) |
| 模块职责、事实来源与宿主边界 | [可读运行机制导览](wiki/architecture.md)、[系统架构基线](system-design-baseline.md) |
| 哪些设计内容进入知识关联 | [独立设计知识来源](design-knowledge-source-policy.md) |
| 怎样将设计交给开发任务 | [设计到开发交接](design-development-handoff.md) |
| 宿主适配与后续演进 | [独立框架演进说明](standalone-roadmap.md) |
| 清晰度评估和独立审查怎样辅助判断 | [U/S/T 解释](ust-score-explanations.md)、[建议阅读](advisory-reading.md)、[宿主范围](wiki/hosts.md) |

## 技术参考

| 主题 | 阅读入口 |
| --- | --- |
| Bundle 文件、所有权与执行契约 | [Bundle contract](bundle-contract.md) |
| 面板组件、字段和绑定 | [Panel DSL](dsl-spec.md)、[组件目录契约](a2ui-component-catalog-contract.md) |
| 共享交互、排版与信息组织 | [Panel UIUX 规范](panel-uiux-standard.md)、[面板创作指南](../.agents/skills/design-bundle-creator/references/panel-authoring.md) |
| 项目入口与套件启用 | [设计命令入口](design-command-agent-entry.md) |
| 建议阅读、未读状态与评估解释 | [建议阅读](advisory-reading.md)、[面板未读状态](panel-unread.md)、[U/S/T 解释](ust-score-explanations.md) |
| 已有项目的内容版本更新 | [项目内容升级](project-content-upgrade.md) |

## 开发与维护

从[开发指南](wiki/development.md)准备源码工作区，按 [AGENTS.md](../AGENTS.md) 和[贡献指南](../CONTRIBUTING.md)确定修改位置与验证范围。宿主接入细节由[各宿主入口](../packages/companion/HOSTS.md)及对应包的 README 维护。

文档用词遵循[命名与术语规范](wiki/terminology.md)，公开内容按[文档同步规范](public-document-sync.md)从固定源码提交导出。敏感信息按[安全报告方式](../SECURITY.md)处理。

## 目录约定

- `docs/wiki/`：面向使用者和套件作者的教程、操作指南、概念及排障入口。
- `docs/` 下的技术文档：架构说明与可直接引用的契约，保留各自的稳定路径；从本目录按主题进入。
- `packages/*/README.md` 与创作技能：所属模块的开发说明及可执行的创作方法。
- `examples/` 与 `docs/images/`：教程样例和界面演示资源，与正文一起维护。

内部开发现场笔记和历史检查记录不作为公共使用指南。维护新文档时，将它接入对应阅读入口，避免形成没有导航的独立文件；同一内容保留一个维护源。

# 语构设计系统（Yugoo Design）

简体中文 · [English](README.en.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-3964FE)](docs/wiki/hosts.md#deepseek-harness)
[![Codex CLI](https://img.shields.io/badge/Codex_CLI-0D0D0D)](docs/wiki/hosts.md#codex-cli)
[![Claude Code CLI](https://img.shields.io/badge/Claude_Code_CLI-D97757)](docs/wiki/hosts.md#claude-code-cli)
[![Qoder CLI](https://img.shields.io/badge/Qoder_CLI-6AD86C)](docs/wiki/hosts.md#qoder-cli)
[![千问办公 QwenWork](https://img.shields.io/badge/%E5%8D%83%E9%97%AE%E5%8A%9E%E5%85%AC_QwenWork-39D377)](docs/wiki/hosts.md#千问办公-qwenwork)
[![WorkBuddy](https://img.shields.io/badge/WorkBuddy-00C29A)](docs/wiki/hosts.md#workbuddy)
[![Companion release](https://img.shields.io/badge/Companion_release-2088FF?logo=githubactions&logoColor=white)](https://github.com/alibaba-damo-academy/yugoo-design/actions/workflows/publish-companion.yml)

**让构思看得见，让细节有把握。**

语构设计系统（Yugoo Design）是一款兼容主流 AI 智能体（Agent）应用的开源插件，为专业技能配上可交互的设计面板（Design Panel）。AI 帮你展开方案，你在图、表、卡片与原型中看清细节、表达判断；保存后的设计成为继续讨论和完善的共同依据。

![语构设计系统（Yugoo Design）产品概念：从零散想法出发，通过可交互设计面板、缺口驱动协作与 KAG/GRA 整合，形成可持续反馈和修订的系统化设计成果](docs/images/yugoo-design-concept.webp)

你可以先用默认随插件交付的 **Web App Kit** 设计完整的软件应用，也可以定制套件与面板，用于推敲游戏规则、设计排班优化模型等任务。已提供的套件与独立 Kit 的接入方式见[套件清单与获取指引](docs/wiki/kit-sharing.md#official-kits)。

[快速开始](#快速开始) · [为什么需要它](#为什么需要它) · [核心能力](#核心能力) · [协作示例](#一次完整的协作) · [扩展套件](#从应用设计开始按需扩展) · [Wiki](docs/wiki/README.md) · [贡献与反馈](#参与与反馈)

## 快速开始

准备好 **Node.js `>=22.19.0 <23`**，以及一个已配置模型的智能体宿主（Agent Host）。插件沿用宿主已有的模型、会话与工具；安装环境见[开始使用](docs/wiki/getting-started.md)。

1. **安装插件。** 把[通用安装提示词](packages/companion/HOSTS.md#default-prompt-any-supported-host)复制给当前宿主的智能体（Agent），按它的提示完成授权、导入或启用，以及必要的重启或新建会话。

   目前支持 DeepSeek Harness（DSH）、Codex CLI、Claude Code CLI、Qoder CLI、千问办公（QwenWork）和 WorkBuddy。DSH 提供完整功能与一体化交互体验，将对话、设计面板和设计工作室（Studio）放在同一工作区。其他宿主的功能支持与交互方式各有不同，详见[宿主指南](docs/wiki/hosts.md)。

2. **创建设计项目。** 调用已安装的 `yugoo` 入口，直接请求：

   ```text
   新建一个名为 design-team-delivery 的设计项目，使用 Web App 设计套件。
   ```

   DeepSeek Harness 也可以使用 `/yugoo new design-team-delivery` 和 `/yugoo kit web_app`；完整命令与参数见[命令参考](docs/wiki/commands.md)。
3. **说出这轮目标。** 例如：

   ```text
   我们是六人的设计工作室，客户需求和修改意见都在聊天里。
   想做一个项目交付平台，让 AI 帮忙整理反馈、提示影响，
   关键承诺由我们决定。先一起想清楚客户提出修改后应该怎样处理。
   ```

4. **在面板里表达判断，再继续。** AI 根据当前需要展开提问或设计面板。你可以修改内容并保存，再说：“按我刚保存的处理规则继续，说明它会影响哪些设计。”也可以在对话中提出修改。跟着[协作教程](docs/wiki/web-app-demo.md)练习，日常操作查[使用指南](docs/wiki/usage.md)。

## 为什么需要它

Vibe Coding 让把想法变成软件越来越容易。与此同时，想清楚真正需要什么、让各项功能组成完整的系统，并在后续迭代中保持一致，变得更加重要。**把功能实现出来，并不意味着做出了真正需要的产品。**

例如，你想给团队做一套内部报销工具。报销单要填哪些信息、提交后能否修改、审批人如何确定，都要符合团队自己的规则。以后审批方式变了，原有的表单、权限和流程也需要配合调整。AI 可以提出方案，但这些实际情况和取舍，需要你参与表达和判断。

Yugoo Design 帮助你与 AI 一起把这些问题想清楚：通过具体面板理解方案、推敲细节，再把分散的设计组织成一致的整体。需求变化时，你们可以继续讨论、检查和修订，让共同的设计持续成为开发、迭代与维护的依据。

软件应用设计是一个起点。这套框架希望支持、探索更普遍的**人与 AI 的互动协作（Human-in-the-loop，HITL）**：**帮助人理解问题、思考选择、表达诉求，并让 AI 持续与人的意图对齐。** 配合不同领域的方法与面板，这套协作方式也可以用于活动策划、游戏机制设计、运筹建模等任务。更多背景见[产品理念](docs/product-vision.md)。

## 核心能力

### 可交互的设计成果：从 Skill 到 Bundle

语构设计系统将智能体技能（Agent Skill）扩展为**设计技能包（Bundle）**，为专业方法加上交互面板（支持声明式面板定义和 A2UI）、结构化数据校验和执行控制。每个 Bundle 聚焦一部分设计，例如应用的功能、流程、规则、数据或页面，把技能产出变成可查看、可讨论、可修改的成果。

你可以在图中查看关系，在表单中修改属性，或通过原型体验页面。面板与 Agent 使用同一份设计数据；经过校验和保存的修改，会成为后续构思的依据。Bundle 还可以声明由主 Agent 或子智能体（Subagent）运行，以及何时交还给用户补充、修改或确认，让专业方法按适合的方式参与协作。

### 缺口驱动的持续构思：Gap-driven Agent Loop

AI 结合你的目标、已有设计和反馈，判断当前还缺什么：是需要了解实际情况、推敲一个方案，还是请你作出取舍？这些缺口会转化为具体行动——展开智能提问（Smart Questions）面板、建议进一步调研，或打开相应的设计面板。随着信息补充、方案修改和人的反馈，AI 重新判断下一步，让构思持续深入。

**设计套件（Kit）** 将一组 Bundle 与**领域主提示词（Mindset）** 组织在一起，为这个循环提供专业方法、判断依据和可用工具。你可以决定先深入哪里，也可以让 AI 在目标明确的部分自主推进；整个过程随着设计逐渐清晰而调整，无须遵循固定流程。

**清晰度评估（U/S/T）** 从理解度（Understanding）、结构化（Structure）与可验证性（Testability）提供有依据的判断线索，帮助解释当前还缺什么。评估需要结合具体证据和本轮范围理解，用来讨论下一步，不作为客观完成率、固定流程门槛或跨套件排名。操作与解释见[使用指南](docs/wiki/usage.md)和[评估说明](docs/ust-score-explanations.md)。

### 从局部到整体：KAG 与 GRA

改了一条流程，权限、通知和页面可能都要随之调整。**知识图谱（KAG）** 随设计文件更新，关联不同部分的内容与依据。**主动审查（GRA）** 从三个视角检查设计并提出建议：

- **一致性审查（Grounding）**：检查各部分设计是否相互矛盾或遗漏了约定。
- **知识反思（Reflection）**：发现需要进一步研究、查证的疑点。
- **意图对齐（Alignment）**：提出需要你补充背景或作出判断的问题。

自动 GRA 需要能保持主对话可用的后台执行。后台不可用或评审会占用主对话时，你可以选择关闭自动 GRA，或明确选择本次同步评审；关闭自动 GRA 后仍可手动请求审查。具体宿主的当前支持与限制统一见[宿主兼容](docs/wiki/hosts.md#后台能力与评审降级)，U/S/T 评估与 KAG 各自独立运行。

结合具体场景查看流程、规则和原型，可以继续推敲这些决定能否配合。需要交接时，再把分散的设计整合成产品需求文档（PRD）等成果，并保留原始设计依据。

### 可以继续的设计项目

**设计项目（Design Project）** 保存设计文件、相关产物和版本记录。一次讨论结束后，重新打开项目即可和 AI 接着已有成果推进；可以请求“查看最近一次修改，解释流程和规则改了什么”，通过 Git 历史追溯方案如何形成。版本管理运行库随插件提供，正常设计操作无需另装 Git。日常历史查看、旧项目迁移与材料重建见[使用指南](docs/wiki/usage.md#4-管理与恢复)。共同设计能够持续积累，不只存在于某次对话里。

### 定制套件与交互面板：让工具适合你的领域

你可以复用、组合或定制 Kit 与 Bundle，调整专业方法、成果结构和交互方式，为自己的领域构建设计工具。面板可以通过**声明式 UI** 预先配置，也可以在支持的宿主中由 AI 通过 **A2UI** 从组件目录生成。两种方式共用组件与渲染能力；需要专门的表达时，还可以扩展 UI 组件或接入专业编辑器。

**Studio** 提供查看、管理与定制入口，让方法和面板可以持续完善、重复使用。如何开始见[套件扩展](#从应用设计开始按需扩展)。

## 一次完整的协作

沿用快速开始中的六人工作室：把客户修改请求的处理约定，转成项目交付平台的流程、规则、权限与页面。在 DeepSeek Harness 中，你可以在左侧与 AI 讨论，在右侧对照设计面板修改；定制套件时再打开 Studio。

示例使用虚构的业务数据。你可以从[快速开始](#快速开始)的目标重新构思，也可以复制[完整示例项目](examples/design-team-delivery/README.md)，按说明迁移后，对照[协作教程](docs/wiki/web-app-demo.md)继续修改。下面展示一次讨论如何推进，不要求每次都按相同顺序使用所有面板。

### 1. 在面板中确认关键背景

你提出快速开始中的工作室想法后，AI 可以打开 **Smart Questions 面板**，把影响当前方案的问题呈现为可作答的卡片。你补充实际分工：**设计师可以与客户讨论，项目负责人确认新增范围和交期。**

保存后，你可以展开 **U/S/T 评估**，查看 AI 对当前设计的判断和依据：背景是否清楚、各部分能否配合、哪些行为还缺少可验证的约定。比起追求更高的分数，这些理由更适合用来讨论“接下来先想清楚什么”。

例如，分工已经明确，AI 可以建议：“先把客户提出修改到安排执行的过程画出来，看看谁记录意见、谁判断范围、谁作出承诺。”

![在对话旁回答智能提问，再展开 U/S/T 评估，近看判断依据与下一项缺口](docs/images/readme-smart-questions.gif)

### 2. 看见流程，再补充真实情况

AI 展开**业务流程面板**，用纵向泳道区分客户、设计师、负责人和系统，从上往下呈现反馈记录、范围对照、影响评估和确认安排。

先看完整流程，再放大关键分支：哪些小改可以直接处理，哪些请求需要确认范围或交期，信息不足时又退回给谁补充？你可以补充：“已有范围内、又不影响已承诺节点的布局调整，设计师可以直接处理。”对照图中的条件和去向修改并保存，让实际工作方式进入设计。

![先查看同一客户修改流程的完整纵向泳道，再放大直接处理、负责人确认和退回补充的分支](docs/images/readme-flow.gif)

### 3. 保存判断，让 AI 继续推敲

保存后，你可以说：“按我刚保存的规则继续，看看其他设计是否也表达了这个意思。”AI 以这些修改为依据推进，**主动审查（GRA）** 则帮助发现不同部分之间尚未对齐的地方。

这个项目中的一条一致性建议指出：

> 问答已经要求检查修改对交付节点的影响，但“范围内修改”的业务规则只检查是否新增页面或能力，没有写入交期条件。

你可以据此明确：“范围和交期分开判断；只要影响已承诺节点，就交负责人重新确认安排。”请 AI 修订相应规则，再对照同一流程检查；建议不会自动替你决定或改写设计。

想进一步查看这些设计如何关联，可以打开底部的**关联图谱（KAG）**，选择流程或页面对象，沿关系查看来源，再回到相应面板核对。图谱提供查找线索，具体判断仍以设计内容为依据。

![阅读当前项目的真实设计建议，对照同一流程与规则，再在 KAG 中查看相关对象及其来源](docs/images/readme-design-advice.gif)

这就是协作循环：**提出目标 → 在面板中看清并修改 → 保存后让 AI 继续 → 带着新的问题再讨论。** 下一轮从最需要理解或决定的地方开始。

### 你还可以继续展开……

**页面地图、UI 设计与调研。** 先从页面地图梳理客户提交反馈、设计师判断影响、负责人确认安排之间的跳转，再展开具体页面的 UI 与交互原型。有需要查证的问题时，转到调研面板，整理问题、来源与结论，为下一项设计决定补充依据。

**场景体验。** 选择“客户临时追加一个页面”这样的情境，把流程、规则和界面放在一起试走。发现某一步不清楚，点击“在主对话讨论当前内容”，把问题带回设计；体验中的操作用于演示，不会直接改写设计文件。

**PRD 与开发交接。** 把当前设计整合为 PRD 草案，按章节检查方案，保留来源与未决问题。进入开发时，再结合具体任务准备 spec，关联相应设计依据。

![按顺序浏览同一项目的页面地图、UI 设计、调研面板、场景体验和 PRD 草案](docs/images/readme-design-exploration.gif)

还需要深入时，你们可以设计反馈、交付物和变更的数据关系，细化权限与业务规则，或通过 **AI 能力面板**明确应用中的 AI 如何整理反馈、需要哪些 Skills 和工具，以及哪些承诺仍由人决定。

这些是可以按需深入的维度，不是每轮必须完成的清单。

完整操作和数据、规则、PRD 界面见[协作教程](docs/wiki/web-app-demo.md)；U/S/T、KAG 和场景体验的入口见[使用指南](docs/wiki/usage.md#查看和更新-ust)。[界面概览](docs/wiki/usage.md#7-界面概览)另展示科研协作工具的流程与页面设计；其他领域见[非 Web Kit 演示](docs/wiki/non-web-kit-demo.md)，开发交接见[设计到开发交接](docs/design-development-handoff.md)。

## 从应用设计开始，按需扩展

官方提供开箱即用的 **Web App Kit**，覆盖需求澄清、调研、功能规划，以及业务流程、规则、数据、权限、页面和验收等设计。它也支持规划应用中的 **AI 能力**：AI 承担什么职责、怎样与人交互，以及需要哪些提示词、Skills 和工具。具体方法见 [Mindset](packages/skills-web-app/kits/web_app/mindset.md) 与 [Bundle 挂载清单](packages/skills-web-app/kits/web_app/kit.yaml)。

共享框架中的交互面板、反馈与设计整合能力，可以配合不同领域的方法继续扩展。例如，把游戏里的行动、资源和胜负规则做成可推敲的设计；或把排班所需的人手、夜班限制和公平取舍整理成运筹优化模型。这些是你可以定制的方向，不是默认附带的套件；当前可用套件与获取方式见[官方套件清单](docs/wiki/kit-sharing.md#official-kits)。

你可以先复用一项熟悉的专业方法，为它定义结构化成果和交互面板，用小样例验证后，再与相关 Bundle、领域 Mindset 组合成 Kit。面板可以使用问题卡片、表格、图、原型、白板，也可以通过扩展接入专业编辑器和 UI 组件。使用 **Studio** 查看方法与源文件，在工作副本中定制和预览，再按[分享指南](docs/wiki/kit-sharing.md#作者与接收者的最小验证)检查并交付套件。具体操作和宿主支持见 [Studio 指南](docs/wiki/usage.md#6-studio查看定制和检验套件)。

![在完整 Studio 页面中阅读 Web App Mindset，并浏览挂载的 Bundle 目录](docs/images/readme-studio.gif)

| 想做什么 | 从这里开始 |
| --- | --- |
| 组织领域方法与套件 | [Kit Creator](.agents/skills/design-kit-creator/SKILL.md) · [扩展指南](docs/wiki/extending.md) |
| 创建 Bundle、编写专业方法 | [Bundle Creator](.agents/skills/design-bundle-creator/SKILL.md) · [Skill Creator](.agents/skills/design-skill-creator/SKILL.md) · [Bundle 契约](docs/bundle-contract.md) |
| 配置或扩展交互面板 | [Panel 创作指南](.agents/skills/design-bundle-creator/references/panel-authoring.md) · [Panel DSL](docs/dsl-spec.md) |
| 试用与分享 | [Kit 分享与恢复](docs/wiki/kit-sharing.md) · [社区工作坊示例](examples/community-workshop-delivery/README.md) |

## 文档与开发

| 入口 | 内容 |
| --- | --- |
| [文档总览](docs/README.md) | 按安装使用、套件创作、架构与技术参考选择入口 |
| [Wiki](docs/wiki/README.md) | 安装、使用、宿主兼容与排障 |
| [核心概念](docs/wiki/concepts.md) · [术语规范](docs/wiki/terminology.md) | 项目、套件、技能包、面板及中英文命名 |
| [产品理念](docs/product-vision.md) | 专业方法、人机对齐与交互原则 |
| [开发指南](docs/wiki/development.md) · [架构基线](docs/system-design-baseline.md) | 源码环境、分层职责与验证流程 |
| [预览状态](docs/wiki/preview-status.md) | 版本、支持范围与已知限制 |

修改项目前，请阅读 [AGENTS.md](AGENTS.md) 与[贡献指南](CONTRIBUTING.md)。

## 参与与反馈

欢迎贡献代码、专业方法、套件、文档、翻译和实例，也欢迎分享你所在领域的构思任务。参与方式见[贡献指南](CONTRIBUTING.md)。

反馈问题时，请提供使用版本、操作步骤、预期与实际结果，见[反馈指南](docs/wiki/support.md)。联系邮箱：[yangjianfeng.yjf@alibaba-inc.com](mailto:yangjianfeng.yjf@alibaba-inc.com)。涉及敏感信息或安全问题，请按[安全报告政策](SECURITY.md)处理。

## 许可证与作者

本项目由 **YugooDesign Team** 维护。项目自有代码和文档采用 [Apache-2.0](LICENSE)，署名见 [NOTICE](NOTICE)。第三方组件保留各自的许可证和必要声明，见[第三方说明](THIRD_PARTY_NOTICES.md)。

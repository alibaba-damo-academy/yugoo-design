# 开始使用

先准备一个已配置模型的智能体宿主（Agent Host），让其中的智能体（Agent）安装语构设计系统（Yugoo Design），再创建你自己的设计项目。你会经历：**安装并启用 → 创建项目 → 展开一个结果 → 修改保存 → 沿着已有设计继续**。

当前 npm 预览版需要 **Node.js `>=22.19.0 <23`**。插件使用宿主已有的对话模型、搜索和工具，所需服务由用户配置。宿主范围见[兼容指南](hosts.md)，首次本地模型准备见本页后面的[环境与安装细节](#环境与安装细节)。默认随主插件提供 Web App Kit。

## 1. 复制通用提示词

把[通用安装提示词](../../packages/companion/HOSTS.md#default-prompt-any-supported-host)复制到当前宿主的 Agent 输入框。首次安装和更新使用同一入口，Agent 按真实宿主上下文选择安装方式；你不需要判断内部应安装 DSH 还是 Companion，也不会一次安装本机所有宿主。

需要指定宿主或查看具体步骤时，再使用下列入口：

| 当前宿主 | 安装或更新入口 | 你将使用的界面 |
| --- | --- | --- |
| DeepSeek Harness | [操作指引](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness) | 官方 DSH profile 中的对话、设计面板与 Studio |
| Codex CLI | [操作指引](../../packages/companion/HOSTS.md#install-or-update-codex-cli) | CLI 对话，浏览器中的设计面板 |
| Claude Code CLI | [操作指引](../../packages/companion/HOSTS.md#install-or-update-claude-code-cli) | CLI 对话，浏览器中的设计面板 |
| Qoder CLI | [操作指引](../../packages/companion/HOSTS.md#install-or-update-qoder-cli) | CLI 对话，浏览器中的设计面板 |
| 千问办公（QwenWork） | [操作指引](../../packages/companion/HOSTS.md#install-or-update-qwenwork) | 在宿主中导入专家套件及连接器后使用 |
| WorkBuddy | [操作指引](../../packages/companion/HOSTS.md#install-or-update-workbuddy) | 在宿主中导入插件来源并按提示刷新或更新 |

Codex 与 Claude Code 当前仅测试了 CLI 接入，桌面端尚未测试。完整安装参数、配置及恢复步骤见[宿主接入入口](../../packages/companion/HOSTS.md)。

## 2. 让宿主 Agent 安装或更新

Agent 会获取所选 `beta` 渠道的精确版本，阅读随包指南，再完成宿主注册或准备导入材料。需要授权、原生界面导入、重启或新会话时，按它的提示操作；千问办公和 WorkBuddy 的材料准备后还要完成宿主要求的界面确认。

结束时，你应知道实际启用的版本、进入项目的方法，以及尚需手动完成的步骤。Agent 分别说明包获取、宿主登记或导入、激活和实际可用状态。只取得新包、或页面出现新文案，不代表宿主已经加载新版本；保留安装目录与回执，按原入口更新和恢复。

如果 Agent 无法执行命令或访问宿主设置，它会说明未完成的步骤；按[对应指南](../../packages/companion/HOSTS.md#owning-entries)手动完成即可。失败时先查看回执和[故障排查](troubleshooting.md)，避免重复安装或覆盖已有配置。可安装版本与兼容信息见[预览状态](preview-status.md)。

暂时不用或需要移除插件时，按[停用、卸载与文件保留](../../packages/companion/HOSTS.md#disable-uninstall-and-retained-files)走对应宿主入口。卸载登记与删除设计项目是两件事；不要先删仍被其他宿主引用的 runtime 或项目目录。

## 3. 创建设计项目

通过已安装的 `yugoo` 入口发出一个明确请求：

```text
新建一个名为 studio-delivery 的设计项目，使用 Web App 设计套件。
```

DeepSeek Harness 的当前命令入口是：

```text
/yugoo new studio-delivery
/yugoo kit web_app
```

Companion 宿主使用已安装的 `yugoo` 技能；例如 Claude Code CLI 的持久登记入口为 `/yugoo-design:yugoo`。Agent 应告诉你当前项目与所选设计套件（Kit），随后在这个项目中继续工作。已有项目保留其固定套件引用。

完整项目操作和 `/yugoo` 参数见[命令参考](commands.md)；旧安装版按随包帮助使用对应入口，当前规范子命令为 `kit`。

## 4. 请求一个具体结果

```text
我们是六人的设计工作室，客户需求和修改意见散落在聊天里。
想设计一个项目交付平台，让 AI 帮忙整理反馈、提示影响，关键承诺由我们决定。
先把客户提出修改后的处理方式展开为可以讨论的流程，
需要我判断的地方请结合具体情境说明。本轮先不做合同收费和财务管理。
```

Agent 按 Kit 的方法澄清背景，或直接展开可讨论的结果。设计面板（Design Panel）可能使用图、卡片、表格或原型。已有明确指令时可以直接请求相应成果，不必先走完问卷。

在面板里指出一处与你的想法不符的内容，例如“已有范围内的布局调整由设计师直接处理，新增范围交负责人确认”。可以直接修改可编辑内容并保存，再请求：

```text
按我刚保存的范围规则继续，解释它会影响哪些流程、权限和页面。
先说明当前最值得处理的一处问题，让我决定下一步。
```

保存后的设计是你和 Agent 继续讨论的依据。重开面板时可以继续查看原值；原会话应围绕新内容推进。若保存或接续异常，记录发生在哪一步并查[故障排查](troubleshooting.md)。跟着[工作室教程](web-app-demo.md)完成这一轮，按[官方 Kit 用户指南](official-kits.md)查其他设计活动。

## 第一次协作后如何继续

| 现在想做什么 | 可以怎么说或操作 | 详细说明 |
| --- | --- | --- |
| 深入一个设计维度 | 请求一个具体功能、流程、数据、页面或当前 Kit 支持的成果 | [套件用户指南](official-kits.md) |
| 判断下一步 | “结合目标和已保存设计，解释最值得处理的缺口及依据。” | [清晰度与核心机制](concepts.md) |
| 查看关联或主动审查 | “这项流程变化会影响哪些规则？请对照已有设计检查。” | [使用指南](usage.md#3-处理建议) |
| 继续已有项目、查看修改或迁移旧项目 | 从已安装入口打开项目；迁移旧项目时说明原件和目标范围 | [项目管理与恢复](usage.md#4-管理与恢复)、[全部命令](commands.md) |
| 交给开发 | 指定这轮开发任务和代码工作区，准备有来源的交接说明 | [设计到开发交接](../design-development-handoff.md) |
| 调整今后项目的方法或面板 | 在 Studio 查看内容，再定制独立副本 | [Studio](usage.md#6-studio查看定制和检验套件)、[最小定制](custom-kit-tutorial.md) |

## 环境与安装细节

这些说明用于安装准备和排查，宿主的具体命令仍以[统一安装入口](../../packages/companion/HOSTS.md#agent-led-installation-and-updates)为准。

- **版本管理：** 运行库随包提供，正常设计操作无需另装 Git。当前随包平台为 Windows x64/MSVC 和 Linux x64/GNU；其他平台与宿主范围见[预览状态](preview-status.md)。DSH 使用官方 profile 和同一产品安装器选择原生集成，无需额外运行 Companion 服务或逐个补装内部模块；Ladybug 是固定版本的第三方运行时依赖。
- **本地向量化（Embedding）：** KAG 使用 CPU，无需 GPU。首次通过 npm/npx 获取包前，按统一入口为安装进程设置 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`，跳过 CUDA 下载并保留依赖所需的正常安装脚本。已经取得的包不能替先前的获取进程补设环境；GPU 加速不在首发支持范围内。
- **本地模型文件：** 使用该版本要求的完整缓存，或在支持的入口显式允许下载固定模型。模型名称、缓存位置与各宿主的下载限制见[本地向量模型准备](../../packages/companion/README.md#local-embedding-model-preparation)。跳过 CUDA 不等于无需模型；宿主的对话模型也不能替代本地向量模型。
- **宿主模型与搜索：** 用户在宿主侧配置，插件不提供共享密钥或额度。跳过搜索配置不代表调研能力已验证；安装了某个 CLI 也不能证明当前会话正在该宿主中运行。
- **版本与更新：** 可安装版本见[预览状态](preview-status.md)。安装器负责获取该版本需要的组件，无需按旧记录手工补装。无法取得所需版本时，请保留错误信息，不用其他包或源码构建替代。

## 发布前候选预检

本地 tarball 用于发布前验证所提供的精确候选，不是正式安装的主教程。核对随包名称、版本与完整性后，在独立、可长期保留的测试目录安装；`RECEIVED_EXACT_TARBALL` 表示本次收到并验证的文件，不能猜测文件名。以下为 POSIX shell 示例；Windows PowerShell 与 Agent 安装方式见[统一安装入口](../../packages/companion/HOSTS.md#agent-led-installation-and-updates)：

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact /absolute/path/to/RECEIVED_EXACT_TARBALL.tgz
npx --no-install design-system --help
```

CLI 宿主按 [Companion 指南](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary)验证登记与运行；DSH 按收到的完整候选依赖清单及随包指南预检，[旧版官方宿主工作区路线](../../packages/dsh/README.md#unpublished-release-official-local-workspace-route)保留其对应制品的历史记录，不代表新候选的包数或验收。桌面候选按对应宿主材料与实际版本验证。旧候选的结果不会自动成为当前 npm 发行的验收结果。

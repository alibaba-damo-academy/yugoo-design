# 宿主兼容与安装入口

语构设计系统（Yugoo Design）以插件形式接入已有智能体（Agent）应用。宿主提供模型、凭据、工具和原生 Agent；共享设计运行时与 UI 负责设计项目和面板。安装前请核对当前版本在你的宿主中支持哪些功能。

[开始使用](getting-started.md) · [预览状态](preview-status.md) · [故障排查](troubleshooting.md)

安装和更新步骤见 [Host integration entry points](../../packages/companion/HOSTS.md)。下文按宿主说明界面、入口和已测试的版本；同名 CLI 与桌面应用的支持范围可能不同。

停用或卸载时，使用[对应宿主的移除入口](../../packages/companion/HOSTS.md#disable-uninstall-and-retained-files)，区分原生登记、单独 MCP 连接器、共享 runtime 和用户项目；没有全宿主通用的卸载命令。

默认主路径是复制[同一段通用安装提示词](../../packages/companion/HOSTS.md#default-prompt-any-supported-host)，让当前宿主的 Agent 选择安装路径；需要时可显式指定宿主。已有符合所需精确版本、适配器和运行条件的安装可以复用，无需为刷新宿主重复取同一包。需要新版本时，再从 npm 获取到独立长期目录。

2026-10-21 的官方 npm 仓库查询确认 Companion `0.1.0-beta.19` 已发布，当时 `beta` 指向 beta.19，`latest` 仍为 beta.10；安装前重新解析所选渠道并固定版本。历史发行、候选与宿主实测见[预览状态](preview-status.md#current-release-and-use)。取得新包后，仍需在宿主中完成登记或导入、启用和重载，再核对实际版本与面板保存是否可用。

日常入口随宿主不同：DSH 使用 `/yugoo` 子命令，Codex 使用 `$yugoo` 或技能选择器，Claude Code/Qoder 使用已安装插件的 `/yugoo-design:yugoo`。千问办公和 WorkBuddy 在原生技能入口选择 `yugoo`，再向 Agent 用自然语言提出项目操作；不要把 DSH 的整套斜杠参数当作所有宿主都能直接解析的命令。

## DeepSeek Harness

- 呈现方式：宿主内嵌 Design Panel 与 Studio。桌面端目前只有 DSH 能承载完整功能与一体化交互体验；其他桌面宿主的支持范围分别说明，不以桌面应用名称推断同等能力。
- 安装入口：[DSH 专用提示词](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness)与[DSH 安装指南](../../packages/dsh/README.md#candidate-npm-installer-dsh-route-and-recovery-limits)。本地工作区路线用于发布前预检。
- 现有公开指南记录官方 DSH `0.1.2-rc.1` 的本地候选安装路线；开发仓的 submodule pin 是另一组开发输入。
- 模型、搜索和用户配置由 DSH 管理。插件通过公开扩展点接入。

安装候选与具体功能的验证范围见 [DSH 指南](../../packages/dsh/README.md)和[预览状态](preview-status.md)。

## Codex CLI

- 呈现方式：绑定原生会话的 Companion UI。
- 安装入口：[Companion 指南](../../packages/companion/README.md)，按其中的 Codex 插件/注册路线选择。
- 原生会话识别、执行和消息返回依赖实际 Codex 版本，不能套用其他宿主的注册命令。
- 当前测试范围为 Codex CLI；ChatGPT 桌面应用（Codex 模式）的接入列入第二轮开发目标，尚未完成。当前官方桌面入口和模式见[OpenAI 使用说明](https://learn.chatgpt.com/docs/use-chatgpt)，CLI 验收不代替桌面验收。

安装后按[首次协作步骤](getting-started.md#3-创建设计项目)创建项目、请求结果并检查保存与继续；原生接线和执行限制以本候选的 [Companion 指南](../../packages/companion/README.md)为准。

## Claude Code CLI

- 呈现方式：绑定原生会话的 Companion UI。
- 安装入口：[Companion 持久注册指南](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary)。
- 使用指南中的 `design-system install --host claude-code` 路线注册所提供的候选；正常启动宿主后使用已安装的 Design skill。
- 当前测试范围为 Claude Code CLI；桌面端接入尚未测试。

正常启动并确认已安装入口后，按[首次协作步骤](getting-started.md#3-创建设计项目)检查项目、面板保存和原会话继续。持久注册、已有进程及执行限制仍按上述候选指南核对。

## Qoder CLI

- 呈现方式：绑定原生会话的 Companion UI，沿用 Qoder 的模型和原生 Hooks。
- 安装入口：[Companion 持久注册指南](../../packages/companion/README.md#claude-code-and-qoder-cli-persistent-native-registration)。从所提供候选的 npm 安装目录，按指南使用 `design-system install --host qoder` 完成原生注册。
- 注册后正常启动 Qoder CLI，在会话中使用 `/yugoo-design:yugoo`；已运行的宿主需要重启以加载注册。源码构建的临时插件目录路线另见 [Qoder CLI 预览指南](../../packages/companion/README.md#qoder-cli-preview)。
- 已记录的原生进程绑定与 Hook 验证范围是 Linux/WSL、Qoder CLI `1.1.48`。其他平台、版本与后台能力按候选分别核实。

## 千问办公 QwenWork

- 呈现方式：在系统浏览器中打开完整 Companion，连接千问办公的原生会话。
- 安装入口：[千问办公专用提示词](../../packages/companion/HOSTS.md#install-or-update-qwenwork)。从已获取的精确 npm 包准备专家套件，按[桌面准备指南](../../packages/companion/README.md#desktop-npm-package-preparation)在原生界面导入并启用。默认 ZIP 已含 MCP 连接器；独立 JSON 是组织策略允许时的替代入口，只启用一份 `design-system` 连接器。启用 Skill 不代表工具已连接。
- 预览运行时与所需 Node 环境按随包指南准备。桌面输入依赖特定版本的宿主设置；普通 Hook 模式下可能需要回到原会话继续，不应将两种模式混用。
- 历史验证范围：千问办公 `1.2.5` 系列、Yugoo Design 套件 `0.2.0` 的 Windows 本地预览；对应版本的首次会话身份、工具连接、系统浏览器打开及消息往返已有实际验证。
- 历史边界：2026-10-11 的记录仍有发送确认与历史回显延迟，以及保存后继续、KAG 和完整设计执行待验收项；这些结果不能代替后续 `1.3.2` 的逐项验收。后续前台 GRA 的用户确认和本地 beta.18 细项记录见下方[评审降级](#后台能力与评审降级)。千问办公接入不使用 WorkBuddy 的内嵌面板路径。

安装材料中的 `hosts/qwenwork/README.md` 记录具体准备步骤与版本限制。界面和回答保留“千问办公（QwenWork）”的宿主身份，插件名称为 **Yugoo Design**。

## WorkBuddy

- 呈现方式：通过宿主的 `present_files` 自动打开内嵌面板预览，也可以在系统浏览器打开完整 Companion。
- 安装入口：[WorkBuddy 专用提示词](../../packages/companion/HOSTS.md#install-or-update-workbuddy)。从已获取的精确 npm 包准备稳定 market，再按[桌面准备指南](../../packages/companion/README.md#desktop-npm-package-preparation)导入并启用。升级先 Refresh 市场、确认目录版本，再 Update 已安装套件；按提示正常重载宿主或开启新会话，核对实际加载版本和工具。
- 历史验证范围：WorkBuddy `5.7.x` 系列、Yugoo Design 插件 `0.3.20` 的 Windows 本地预览。对应预览迭代已有工具与身份绑定、主会话及串行原生 Producer、面板自动打开与回传、保存后原会话读取、历史及 KAG 的实际验证记录。
- 后续 WorkBuddy `5.8.3` 的用户反馈确认前台手动 GRA 可用，仍未获得主对话不被占用的后台体验，详见下方[评审降级](#后台能力与评审降级)。嵌套 Worker 尚不可用。内嵌预览的工具栏与地址栏由宿主控制，不能据此承诺打开带地址栏的独立内置浏览器标签页。

安装材料中的 `hosts/workbuddy/README.md` 记录具体安装及验证范围。页面可见、会话已连接和保存内容被 Agent 读取是不同状态；遇到问题按[故障排查](troubleshooting.md)分别检查。

升级与重新打开：取得新 npm 运行时后，仍需更新宿主安装材料并让宿主重载；材料准备成功不代表正在运行的会话已换版本。保留旧运行时和回执，按适配器使用更高套件版本及上一成功回执；不要用重复安装掩盖旧会话或旧市场目录。重开后核对 `yugoo`、工具、原设计项目、面板保存与原会话读取。

## 后台能力与评审降级

在已检查的 Windows 千问办公 `1.3.2-26101704` 中，桌面集成关闭了后台 Agent，未发现受支持的用户开关。普通重启或修改系统环境、`.env` 不能作为恢复它的方法，也不应修改宿主程序绕过限制。技术原因见[千问办公接入指南](../../packages/companion/hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy)。

WorkBuddy `5.8.3` 的已测异步评审则会让普通消息排队，直到 GRA 结束。它与千问办公的原因不同，但在这两条已测路径中，评审会占用主对话。可以选择：

- **关闭自动 GRA**：使用 `off` 策略停止自动调度，仍可手动请求评审。
- **本次在主对话中评审**：确认会占用对话后，由主 Agent 按 Grounding、Reflection、Alignment 三个视角完成本次评审，不需要强制启动同步子 Agent，也不会开启永久自动同步策略。

未选择时不改策略、不启动评审。宿主能够在不占用主对话的情况下后台运行时，手动评审仍使用异步方式；否则，手动请求也需要先确认本次同步执行。

2026-10-21，用户分别完成了千问办公和 WorkBuddy 的前台手动评审。具体版本与结果见[评审记录](preview-status.md#foreground-review-record-2026-10-21)；请按当前安装版的指南确认是否提供该入口。完成评审后，是否接受建议、是否修订设计仍由用户决定。

U/S/T 清晰度评估由主 Agent 报告，KAG 通过自己的投影与维护流程管理；两者都不依赖 GRA 的后台能力，遇到问题时应分别检查。

## 其他宿主

更多宿主适配的版本、配置和限制以 [Companion 指南](../../packages/companion/README.md)为准。未列出的宿主或版本，请先确认其指南中的执行方式、保存后继续和后台能力。

## 如何阅读兼容说明

兼容性需同时说明插件候选、宿主版本、平台、呈现方式和实际功能。前台 Bundle、嵌套 Worker、后台 GRA 及 KAG 可能有不同支持状态。

macOS 的原生宿主功能与性能尚未完成实机测试。Node.js 能在某个平台运行，并不意味着插件已支持该平台；请同时核对运行库、宿主接入和界面功能。各版本的安装与功能检查结果见[预览状态](preview-status.md)。

首页的宿主徽章链接到本页的对应入口。

宿主接入结构、适配代码与验证边界另见[宿主接入入口](../../packages/companion/HOSTS.md)。

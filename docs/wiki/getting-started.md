# 开始使用

先准备已安装、已配置模型的智能体宿主（Agent Host），再让宿主中的智能体（Agent）安装语构设计系统（Yugoo Design）。默认路径是：**粘贴同一段提示词 → Agent 从 npm 获取精确版本并按当前宿主安装或更新 → 正常加载插件并验证功能**。不需要用户先判断内部应安装 DSH 还是 Companion，也不是一次安装本机所有宿主。

最近登记的历史发行检查（2026-10-17 UTC）包含 `@yugoo-design/companion@0.1.0-beta.3` 和 11 个 DSH 相关 `0.1.0-beta.2` 包；其中包括后来改为仅内部验证的 Decision Modeling 内容包，不等于当前源码的默认安装清单。当前默认范围、历史归档及后续本地候选分别见[预览状态](preview-status.md)。安装时解析所选 `beta` 渠道、记录精确版本和完整性，再按该版本随包说明操作；不要用默认 `latest`、源码修正或本地候选冒充实际发行。所需包无法获取时报告实际状态，不改用其他包。发布前测试使用文末的候选预检路线。

安装前也可直接阅读[六宿主接入入口](../../packages/companion/HOSTS.md)。它索引宿主各自的登记方式与规范指南；无需先安装插件。后续安装/更新指令沿用该入口，不在 Wiki 维护另一套安装器流程。

## 1. 复制通用提示词

把[通用安装提示词](../../packages/companion/HOSTS.md#default-prompt-any-supported-host)复制到当前宿主的 Agent 输入框。首次安装和更新使用同一入口，Agent 按自己的真实宿主上下文选择适配器；不能因为机器上装有某个 CLI，就认定当前正在使用它。只有上下文不足时才询问宿主，或由你显式指定。

以下入口用于你主动指定宿主或查看其细节，不是必须先做的选择。宿主机制可以不同，默认提示词和完整安装目标保持一致。

| 宿主 | 复制给该宿主 Agent 的提示词 | 操作方式 |
| --- | --- | --- |
| DeepSeek Harness | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness) | 产品安装器按所选发行的完整依赖清单安装；使用已有官方 DSH profile |
| Codex CLI | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-codex-cli) | 本版支持的原生注册协议、计划及回执 |
| Claude Code CLI | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-claude-code-cli) | 用户级持久注册及拥有的更新/恢复流程 |
| Qoder CLI | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-qoder-cli) | 原生插件登记；不同版本按指南卸载后重新登记 |
| 千问办公（QwenWork） | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-qwenwork) | Agent 准备专家套件及连接器，必要时在原生界面确认导入 |
| WorkBuddy | [安装或更新](../../packages/companion/HOSTS.md#install-or-update-workbuddy) | Agent 准备稳定 market，按宿主入口导入或刷新/更新 |

安装前核对[宿主兼容](hosts.md)。对话、设计生成和审查使用宿主已有的生成模型与搜索能力，不提供共享密钥或额度，所需服务须由用户配置；跳过某次搜索配置不代表 Research 已验证。各宿主的原生登记方式不同。Codex 与 Claude Code 当前仅测试 CLI 接入，桌面端尚未测试。

## 2. 让宿主 Agent 安装或更新

当前 npm 预览版需要 Node.js `>=22.19.0 <23`，以及该版本支持的宿主环境。版本管理运行库随包提供，正常设计操作无需另装 Git；当前随包平台为 Windows x64/MSVC 和 Linux x64/GNU，其他平台及宿主的验证范围见[预览状态](preview-status.md)。Agent 阅读所获版本随包的 README 和 `design-system --help`，检查真实宿主能力和已有登记，再按该宿主指南操作。你无需逐个安装内部模块；DSH 由同一产品安装器选择原生集成，不额外运行 Companion 服务。

KAG 的本地文本向量化（Embedding）使用 CPU，无需 GPU。首次通过 npm/npx 获取包前，按[统一安装入口](../../packages/companion/HOSTS.md#agent-led-installation-and-updates)为安装进程设置 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`，跳过额外的 CUDA 下载，同时保留依赖所需的正常安装脚本。已经取得的包不能替此前的获取进程补设环境。

这只处理运行依赖的安装；使用本地向量化前还需准备该版本要求的模型文件。按随包指南使用完整缓存，或显式允许下载固定模型。跳过 CUDA 不代表无需下载模型，宿主的对话模型也不能替代这份本地模型缓存。GPU 加速不在首发支持范围内。

默认随主插件提供 Web App Kit，无需另装；已有项目保留其固定套件引用。

当前源码的 DSH 默认交付清单包含九个系统模块和一个原生 Git 辅助包，共十个 Yugoo 物理包；Ladybug 是单独固定版本的第三方运行时依赖，不计入其中。原生辅助包不新增 Loader 注册，也无需单独安装。历史归档不会因源码调整而改变；实际安装仍以所选精确发行的完整依赖清单为准，不按旧包数手动补装内部套件。

Agent 会先核对 registry 中的精确版本，将包获取到长期保留的独立版本目录，再完成宿主注册或准备导入材料。安装、更新、恢复的命令与回执以[对应指南](../../packages/companion/HOSTS.md#owning-entries)为准。千问办公与 WorkBuddy 的材料准备不等于已经导入；宿主要求的界面确认由用户完成。

安装或更新后，按该宿主要求正常重启或新建会话，确认实际加载的插件版本、技能和工具，再检查下面的使用流程。Agent 分别报告包已取得、原生登记/导入、激活及实际可用的状态。保留原安装目录与回执；只在 npm 中获得新包，或只在页面看到新版文案，都不能证明宿主已经使用新版本。

如果 Agent 缺少执行命令或访问宿主设置的能力，它应明确说明无法自动完成的步骤，并给出该宿主的最小操作。人工方式仍保留在[对应宿主指南](../../packages/companion/HOSTS.md#owning-entries)，不是默认主流程。不确定的失败先检查原回执，不能盲目重复安装或覆盖已有配置。

## 3. 创建设计项目

新版 DSH 对话入口（旧安装候选按随包指南使用对应入口）：

```text
/yugoo new my-project
```

Companion 宿主通过已安装的 `yugoo` 技能进入；例如 Claude Code CLI 持久登记后的入口是 `/yugoo-design:yugoo`。按该宿主指南新建或选择设计项目（Design Project），再描述本轮要设计什么。

## 4. 请求一个具体结果

```text
我们是六人的设计工作室，客户需求和修改意见散落在聊天里。
想设计一个项目交付平台，让 AI 帮忙整理反馈、提示影响，关键承诺由我们决定。
先把客户提出修改后的处理方式展开为可以讨论的流程，
需要我判断的地方请结合具体情境说明。本轮先不做合同收费和财务管理。
```

Agent 会按所选设计套件的方法，帮助澄清或展开一个可讨论的结果。打开设计面板（Design Panel），指出一处与你的想法不符的内容，例如“已有范围内的布局调整由设计师直接处理，新增范围交负责人确认”；修改可编辑内容并保存，再请 Agent 解释这次变化以及后续需要核对的地方。已有明确指令时可以直接请求相应结果，不必先走完问卷。

重新打开面板，确认保存值保留；再查看原会话是否基于这项修改继续。这样可以检查从人的判断到共同设计的连接。继续照着练习见[工作室协作教程](web-app-demo.md)，各套件的用途与成果见[官方 Kit 用户指南](official-kits.md)，日常操作参考[使用指南](usage.md)。

首次使用至少确认四件事：宿主能发现已安装 Skill/工具，页面连接到当前会话，正常 Design Panel 保存后能重开读回，以及原生 Agent 确实读取了这些修改。安装成功或页面打开只能证明其中一个步骤。

## 发布前候选预检

本地 tarball 用于发布前验证所提供的精确候选，不是正式安装的主教程。核对随包名称、版本与完整性后，在独立、可长期保留的测试目录安装；`RECEIVED_EXACT_TARBALL` 表示本次收到并验证的文件，不能猜测文件名。以下为 POSIX shell 示例；Windows PowerShell 与 Agent 安装方式见[统一安装入口](../../packages/companion/HOSTS.md#agent-led-installation-and-updates)：

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact /absolute/path/to/RECEIVED_EXACT_TARBALL.tgz
npx --no-install design-system --help
```

CLI 宿主按 [Companion 指南](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary)验证登记与运行；DSH 按收到的完整候选依赖清单及随包指南预检，[旧版官方宿主工作区路线](../../packages/dsh/README.md#unpublished-release-official-local-workspace-route)保留其对应制品的历史记录，不代表新候选的包数或验收。桌面候选按对应宿主材料与实际版本验证。旧候选的结果不会自动成为当前 npm 发行的验收结果。

## 第一次协作后如何继续

- 已有明确结果：继续请求具体的功能、流程、数据、页面或所选 Kit 支持的其他成果。
- 还不清楚下一步：请 Agent 结合当前目标和已保存设计说明最值得处理的缺口，再选择建议。
- 希望调整方法或面板：到 [Studio](usage.md#6-studio查看定制和检验套件)查看，再按[扩展开发](extending.md)维护独立副本。
- 入口、生成或保存异常：按[故障排查](troubleshooting.md)记录实际失败阶段。

这些步骤共用宿主已有的会话和安装入口；具体版本的已验范围见[预览状态](preview-status.md)，不由本教程推定全平台验收完成。

# Agent-accessible Design Project commands

The user command and Agent tool share `runDesignProjectCommand`; neither shell
inspection nor a second project registry substitutes for project selection.

## Entry points

- DSH: `/yugoo` and `design_command({action, argument?})` share
  `DesignService.executeProjectCommand`. The existing user-command continuation
  is retained; a tool invocation only returns its result and never synthesizes a
  user message. Child sessions are rejected by the service before any mutation.
- Companion hosts (Codex CLI, Claude Code CLI, Qoder CLI, QwenWork and WorkBuddy): MCP
  `design_command({host, threadId, action, argument?})` shares
  `runCompanionCommand` with `design.mjs command`. It needs no Panel connection,
  so creation and discovery work before `serve`.

Actions are `help`, `list`, `status`, `new`, `open`, `kit`, `close`, `migrate`,
`reconstruct`, `delete`, and `compose_spec`. Project files remain preserved by `delete`, which
removes registry membership. Mutating commands still require user intent;
explicit authorization is required for removal. `migrate` replaces the former
project recovery command without an alias; it stages existing Design Files in a
new project, preserving the source. It does not change `reconstruct` or unrelated
interrupted-operation recovery APIs. Full arguments and examples are in the
[command reference](wiki/commands.md).

All actions also accept natural-language intent through the main Agent: users
need not type a slash command. The Agent selects the matching `design_command`
action and literal argument, clarifying only a genuinely ambiguous target.
For example, “assemble these designs into a development spec” routes to
`compose_spec`; “show my projects” routes to `list`.

`/yugoo compose_spec [brief]` prepares the selected project's exact root, Kit
pin and published checkpoint plus execution guidance. The main Agent then
creates/updates specs in the authorized coding workspace, following its existing
Spec Kit/OpenSpec/Kiro convention (Spec Kit when none exists). It links relevant
Design Files/artifacts rather than duplicating the whole project. The command
receipt is not generated files: report completion only after the Agent actually
writes and checks them. It changes neither project selection nor Design Files,
requires no Panel restart, and does not authorize implementation.

## Session and presentation boundaries

Native selection remains isolated by exact `[host, threadId]`. The MCP caller
must use the main identity from its native host, not a guessed or latest session.
Like the existing CLI, this local MCP project-management entry accepts an
explicit identity; MCP requests themselves do not attest which native child
issued a call. Thus DSH has a service-enforced child rejection, while native CLI
child tool exposure/authorization remains a host responsibility. Do not describe
the explicit identity parameter as cryptographic caller authentication.

Selection-changing Companion results return `panelRestartRequired`. They do
not silently repoint a running project-bound server: the main Agent restarts
only its own Panel with the returned project root and the same native identity.
The old Panel must not be mistaken for the new selection. `conversationPrompt`
is continuation guidance, not evidence of new user authorization.

## Verification

- Core test: shared creation/Kit-selection path, invalid commands, child rejection,
  and no synthesized user message.
- MCP test: no connection prerequisite, the host/session cases exercised by the focused test, creation,
  Kit selection, close/reopen, missing argument errors, and session isolation.
- Packaged stdio MCP test: project commands and component discovery work without
  a Panel connection; project-bound operations retain connection validation.

These are automated adapter checks, not real-model runs in all native clients.

## Reconstruction execution notes

The following method details complement the user steps in the Wiki. They do not
add a loader, migration framework, or permission to change the source material.

重建材料须使用绝对路径，例如 `/yugoo reconstruct /data/product.md`
或 `/yugoo reconstruct /data/product-materials`。目录可混合文档、截图和代码，
不要求 Git；单文件输入仅针对该文件。材料保持只读，生成结果写入新设计项目。
材料能否被理解取决于宿主提供的读取能力；不支持的 PDF、视频等格式会提示转换，
不会自动安装解析器。截图不证明后台规则，文档中的计划不自动视为已实现功能。
既有设计项目材料的适配使用 `/yugoo migrate`；它不是支持所有旧格式的版本迁移保证。

`migrate` 不读取或重放旧 Session。它保留来源目录不变，将目标 Kit 能识别的 Bundle 文件暂存到一个新的当前格式项目；Agent 随后使用各 Bundle 现有 validator，验证通过则直接发布，失败则按当前 Skill Body 与诊断做最小适配。

`reconstruct` 面向原始材料而不是旧 Design Files。它创建并打开一个空项目，然后由主 Agent 对指定材料做有边界的只读扫描，选择合适的设计套件（Kit）并加载其领域主提示词（Mindset），再判断哪些 Bundle 对还原产品设计真正相关。Agent 可以检查全部 Bundle 的说明，但不会机械运行全部 Bundle；选中的 Bundle 继续使用各自原有的 Schema、validator、文件写入与 Git 发布流程。不会整仓复制或建立额外源码索引；必要的原始图片可以原样复用到所属 Bundle 的 Design Files。

重建 Producer 执行的是事实抽取与产物转换，不是正向设计 Skill Body：把已有内容填入相同的可交互结构，保留真实界面和素材，而不是另选风格或另造页面。格式/脚本用法来自 Bundle 的共享产物参考。未知可使用现有字段表达；若材料不足以满足必填契约，会明确报告限制，不把默认值冒充事实。完成后这些仍是普通设计文件，可在面板保存修改并继续设计。

素材由主 Agent 使用现有宿主文件操作，在所属 Producer 启动前准备，并检查源/目标实际路径边界；不与 Producer 并发写入，不覆盖不同内容，也不经模型转抄 base64。Producer 使用现有图片字段引用，再走普通校验与发布。若宿主缺少可靠复制能力，应报告限制，不把重新绘制的 Logo 当作忠实还原。此流程没有新增素材工具或自动导入服务。

Style/Page 预览共用现有二进制文件接口，将 HTML 中相对 `img src` 引用的 PNG/JPEG/WebP 装配为沙箱可显示的图片，不改原 HTML 或放宽 CSP。图片更新、出现或删除沿用公共轮询的文件哈希刷新。它不是任意源站资源加载器：CSS 背景、字体与响应式 picture 集合不在这次支持范围内，相关还原限制需要说明。

重建先识别用户入口和实际行为，再组织功能、流程、页面等相关维度；跳过普通设计的中途 `must_edit` / `user_continue` 确认，完整产出后统一交给用户审阅。真实失败与输入障碍仍会报告，不会被当成完成。Agent 在结束前核对覆盖范围与跨 Bundle 矛盾，说明推断、未知和跳过的维度。

主 Agent 先在对话中整理精简的共同理解：产品边界、实际入口与操作、关键流程与数据、源码位置及未知项，再通过现有 `brief` 向每个相关 Bundle 传入其所需证据与已保存的引用 ID。后续发现会修正这份理解；不是先完整建图才能工作，也不会把所有源码搬进上下文。

Ladybug 可用时，主 Agent 可按实际需要通过 `design_reconstruction_knowledge` 记录或查询带源码路径、短引用和文件内容哈希的理解关系；包括未提交的源码改动。不会自动向每个 Producer 灌入整份图谱。图记录只是 AI 提出的理解，Producer 必须回查源码，文件变化会标为证据已变更。图不可用不会阻止重建，也不改变 Design Files 的事实地位。

重建收尾由主 Agent 按提示调用一次原生只读子代理，核对当前源码、实际设计文件、跨 Bundle 引用含义和产物可读性。审查输入提供材料、范围和开放问题，不预设“某项差异合理”等答案。源码能够证明的还原错误，经主 Agent 核验后交回对应 Bundle 修复；错误的共享定义先修正，再检查消费者，不能让页面迁就错误的视觉规范。未知事实和产品选择留给用户。它不是自动接受 GRA 建议，也不是新增的后台完成门禁。独立审查不可用时由主 Agent 自查并说明限制；这是 agentic 工作约定，不是运行时强制保证。收尾分别说明机械校验、源材料对照、未做的浏览器验证及尚存偏差，不将格式通过等同于忠实还原。

Web App 重建会把已有视觉语言还原为 Design Style，再生成对应的具体页面 HTML；宿主提供主题不等于可以跳过视觉证据，页面地图也不等于页面重建完成。Smart Questions 可承接源码支持的产品背景和未决意图，预填内容会区分事实、推断与未知，不冒充用户作答。完成前核对真实落盘文件、引用及覆盖情况，无法还原的部分明确报告原因。

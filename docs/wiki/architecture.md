# 架构与运行机制

语构设计系统（Yugoo Design）由两层共同提供能力：**共享底层负责设计数据、规则和交互；宿主适配负责把这些能力接入真实 Agent 会话**。只完成其中一层，不能称为该宿主已可用。

这份技术导览解释当前实现的主要流程和源码职责。具体使用见[使用指南](usage.md)，文件字段见[项目文件与版本管理](project-files.md)，安装版和实测边界见[宿主兼容](hosts.md)。更详细的约束在[架构基线](../system-design-baseline.md)；基线中的规划不代替实际实现或发行状态。

## 共享底层与宿主适配

| 层与源码目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `packages/core` | 项目注册、内容解析、校验、执行语义、Git 发布、Journal、知识与评估公共契约 | 不持有各宿主模型账号，不硬编码某个 Bundle 的业务规则 |
| `packages/panel` | 共享面板、声明式解释器、组件、样式及用户编辑交互 | 不另建一份设计事实，不自行决定业务结论 |
| `packages/skills-*` | Kit 的领域方法，以及 Bundle 的数据、校验、面板与摘要声明 | 不接管原生会话和通用保存服务 |
| `packages/provider-*` | 明确信任的原生或可执行贡献，如专用渲染与运行能力 | 不使任意内容包自动获得执行信任 |
| `packages/companion` | 将共享能力接到 CLI/桌面 Agent，提供本地服务、MCP、页面与续作通道；各宿主适配分区维护 | 不另接模型 Client 来模拟宿主执行 |
| `packages/dsh`、`packages/studio-dsh` | DeepSeek Harness（DSH）的插件与 Studio 接线 | 不复制另一套项目和设计规则 |
| `packages/studio`、`packages/studio-ui` | 套件浏览、工作副本、预览、归档等公共创作领域与 UI | 不把预览保存当作用户项目的正式发布 |

生成模型、凭据、原生工具及任务生命周期由宿主负责。Host adapter 将会话身份、执行能力、消息送达和页面展示转成共享服务可用的接口。WorkBuddy、千问办公（QwenWork）、Codex、Claude Code、Qoder 等不能因参数相似就混用适配规则；接入点与能力矩阵集中在 [Companion HOSTS](../../packages/companion/HOSTS.md)。

## 从需求到设计文件

```text
用户请求 → 创建或打开项目 → 选择 Kit → 选择相关 Bundle
         → 执行者读取方法及必要证据 → 写入所属设计文件
         → 校验并发布 Git 版本 → Panel 展示 → 用户修改并保存 → 原会话继续
```

1. **项目选择**：共享命令解析并维护项目注册；宿主保存当前会话的选择。切换 Companion 项目需要使用新选择重新打开其项目绑定服务，不能把旧连接悄悄指向另一项目。
2. **方法选择**：Kit 提供领域主提示词（Mindset），Bundle 清单让主 Agent 按目标选方法。不是先运行全部 Bundle，也不把全部方法全文反复塞入每次工具回包。
3. **生成与修改**：执行者读取所选 Bundle 的方法、输出契约和必要资源，只修改本次拥有的范围。规范 JSON 与 HTML、BPMN、图片等产物一起形成设计文件。
4. **校验与发布**：对应 schema、validator 和路径/产物检查通过后，公共流程发布明确文件并返回 Git 版本。文件出现、模型自述、工具受理与完成是不同事实。
5. **继续协作**：Panel 读取这些文件；用户保存后的差异回到宿主会话，Agent 据此调整后续设计，而不是重复写入刚保存的内容。

项目命令本身不替用户完成设计。例如 `migrate` 创建新迁移目标并准备已有文件，后续适配仍由 Agent 完成；`compose_spec` 返回交接指引，实际规格文件仍须写入获准的开发工作区。见[完整命令参考](commands.md)。

## Agent 如何获得方法与职责

宿主基础指令、共享设计协作约定、当前 Kit Mindset、项目上下文和所选 Bundle 方法各有不同作用。共享指令说明如何保存、评估和协作；Mindset 提供领域判断；Bundle 方法解释具体证据、产物和失败处理。摘要和路径用于发现，不能代替必要的方法阅读。

Bundle 的执行声明决定由主会话（main）还是原生子代理（subagent）担任 Producer。主 Agent 协调范围、用户选择与跨 Bundle 补充，不因子代理启动失败就擅自换执行位置。Worker 只承担被授权的子任务，不自动取得其他 Bundle 的写入权或最终发布权。宿主不支持嵌套 Worker 时，可用路径须遵循该 Bundle 的执行契约，不能伪造成功。

完整子代理接线见[Companion 执行参考](../../packages/companion/plugin/design-system/skills/design-panel/native-execution.md)和各宿主安装技能。迁移、材料还原与普通正向设计使用同一数据与发布基础，但证据方法不同：材料还原必须区分观察到的事实、推断和未知，不用新的产品设想冒充原系统行为。

## Panel 保存与会话继续是两步

Panel 的表单和图形编辑共享规范数据。保存时检查字段、产物和基线变化，再通过项目写入与 Git 流程发布；并发修改不能被旧页面盲目覆盖。

**保存成功后，文件已持久化；通知 Agent 是后续传输。** Companion 通过当前宿主适配的通道发送保存上下文。控件被关闭、宿主忙碌或会话失联可能导致“已保存，未发送”，不应把它显示成文件丢失，也不应自动重写或无限重发。

送达状态不明确时先核对原会话；服务停止则使用当前会话重新打开，读取真实文件继续。连接路径由打开操作返回，不扫描全局“最新连接”，也不复制其中的 token。生命周期、页面访问与绑定边界见[Companion 接入契约](../../packages/companion/HOSTS.md#connection-page-presentation-and-access)。

WorkBuddy 当前服务接线的空闲超时为一小时，最长生命周期为四小时；活动时间由已认证请求更新。这不是所有宿主统一的进程存活保证，宿主退出、进程停止或错误仍可中断服务。具体诊断和恢复见[连接排查](troubleshooting.md#会话或浏览器连接失效)。

## UST KAG GRA 如何共享底层

| 能力 | 输入和职责 | 持久化结果与运行边界 |
| --- | --- | --- |
| 清晰度评估（U/S/T） | 主 Agent 根据当前目标、Kit 与已保存设计给出分数和理由；DSH 原生评估接线使用相同契约 | 报告工具写 `design_records/clarity.json` 并记录版本；面板读取该文件，不靠反查宿主日志确认主调用 |
| 知识关联（KAG） | 从独立设计源和产物建立可查询的结构与语义关联，辅助发现证据 | 项目保存中立知识归档，本机数据库/索引用于查询；派生图谱不能覆盖设计文件的事实地位 |
| 主动审查（GRA） | Grounding、Reflection、Alignment 等配置视角读取设计证据，提出建议或问题 | 结果及用户处理决定进入项目记录；建议不自动改写设计，原生任务绑定留在本机 |

三者不是串行的完成门禁：没有评估可标待评，KAG 过期可回到设计文件，GRA 无后台可选择降级，均不应令已授权的设计主流程失效。分数不是完成率，图谱不是设计权威，建议不是已接受事实。

### 评估与版本

`design_main_context` 给出评估所需的当前输入，`report_design_clarity` 接收结构化评分和理由。基础输入校验保留，但不要求为了写一次分数提供原生回合证明或后台探针。成功后保存新记录；失败时保留已有结果并显示是否需要更新。具体字段见[UST 文件](project-files.md#ust-具体记在哪里)。

Git 提交是设计版本依据。评分和审查自己的辅助记录提交，不应导致它们因自身写入而立即过期；实际设计内容或 Kit 依据变化才影响相应的当前性判断。

### 知识索引与维护

KAG 跟踪独立设计源和实际产物；PRD、Spec 和模型侧摘要是派生汇总，不再次充当独立事实源。查询结果用于定位证据，结论需回查文件。Ladybug Provider 提供本地知识存储；语义层还需要对应运行库及模型资源。

Companion 的普通状态查询不启动索引。已保存设计的正式发布可准入维护；用户也可明确请求刷新。`due` 表示需要更新，不等于任务已经运行；`queued`、`running`、`current` 和 `failed` 各有独立含义。失败时保留上一个完整版本并报告新鲜度，不把缓存旧图冒充当前图谱。

项目归档与可重建缓存分开保存，开库时按归档恢复并核对缓存，防止旧机器状态变成另一份事实。归档数据结构见[知识记录实现](../../packages/core/src/design-knowledge-records.ts)，生命周期调度见[项目知识服务](../../packages/core/src/design-project-knowledge-lifecycle.ts)。

### 审查与宿主降级

真实后台审查应不阻碍主对话；仅有异步任务 ID 并不能证明用户还能正常交流。宿主适配同时需要识别执行能力和实际交互限制。

后台不可用或仍占用对话时，向用户提供统一选择：关闭自动 GRA、保留手动检查；或明确同意在本次主对话同步评审。未选择时不改策略、不自动同步运行。一次同步授权不是以后每次自动同步的授权。各宿主实测限制见[后台能力与评审降级](hosts.md#后台能力与评审降级)。

每项审查记录其依据 checkpoint。评审者按需读取该版本的文件，避免在用户持续修改时混用前后内容；不需要先加载全部源码、历史或图谱。接受建议后，主 Agent 根据建议选择后续动作：需要修改设计文件时由所属 Bundle 正常修订、校验和发布；澄清或研究也可使用宿主的提问、搜索能力，或说明无需追加动作。只读审查者不能直接改设计，接受建议本身也不授予跨 Bundle 写入权限。

## 内容版本、扩展与 Studio

Kit 挂载精确 Bundle 身份与版本；Bundle 定义 schema、方法、面板、校验及可选摘要。声明式面板交给共享解释器，原生专用能力由已注册 Provider 提供；所有 Kit 的普通控件和布局基础都由共享 Panel 维护。详细结构见[Bundle 契约](../bundle-contract.md)、[DSL](../dsl-spec.md)和[扩展开发](extending.md)。

Studio 面向内容作者：浏览原件、维护独立工作副本、预览样例、准备/采用归档，并在宿主接线可用时试运行。保存草稿、样例交互、真实项目发布是不同操作；本地副本不会自动覆盖安装原件或项目精确引用。流程见[Studio 使用](usage.md#6-studio查看定制和检验套件)。

## 开发者从哪里读代码

| 问题 | 入口 |
| --- | --- |
| 项目命令与宿主选择 | [共享命令](../../packages/core/src/design-project-adapter.ts)、[Companion 项目接线](../../packages/companion/src/project-commands.mjs) |
| 项目文件与 Git 发布 | [项目管理](../../packages/core/src/design-project.ts)、[Git 服务](../../packages/core/src/git.ts)、[系统记录发布](../../packages/core/src/design-project-records.ts) |
| DSH 运行与工具 | [DesignService](../../packages/core/src/design-service.ts)、[服务工具](../../packages/core/src/service-tools.ts) |
| Companion 工具与服务 | [MCP](../../packages/companion/src/mcp.mjs)、[本地服务](../../packages/companion/src/server.mjs) |
| 共享 UI、内容创作 | [Panel](../../packages/panel/README.md)、[Studio domain](../../packages/studio/README.md)、[Studio UI](../../packages/studio-ui/README.md) |
| 构建、测试与贡献 | [开发指南](development.md)、[贡献指南](../../CONTRIBUTING.md) |

新增宿主应实现适配接口并验证真实会话、保存接续和执行行为；不能靠另一宿主的夹具证明兼容。修改共享层先运行相关单元/集成检查，再按影响补实际 UI 或原生宿主验证。源码合并、公开源码同步、npm 打包和发布是不同操作，参见[公共文档与源码同步](../public-document-sync.md)。

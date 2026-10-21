# 标准的来源与边界

以下路径均相对 `dsh-design-system` 仓库根目录。基于当前实现提炼，不把历史文件中的每句话视为标准。

## Web App 对照与选择

当前 `packages/skills-web-app/bundles/` 的 15 个 Bundle：smart_questions、research、function_modules、flow_design、design_style、business_data、business_rules、role_access、integration_design、notification_design、quality_acceptance、page_design、web_app_prd_assembly、whiteboard、ai_agent_capabilities。以实际目录与加载结果为准；它们不是必须完成的阶段。

| 方法类型 | 需读的成熟参考（该目录内 SKILL.md + reference/artifact-contract.md） | 提炼内容，不照搬业务 |
| --- | --- | --- |
| 问题清单 | `packages/skills-web-app/bundles/smart_questions` | 有意义的提问、answer 与选项/建议区分、允许未知、交还面板 |
| 可编辑设计记录 | `packages/skills-web-app/bundles/function_modules`；数据语义可补 `business_data` | canonical 所有权、完整状态修订、稳定引用、输出字段契约 |
| 计划后展开/多产物 | `packages/skills-web-app/bundles/research` | 计划与报告分离、按当前请求交接、证据来源、Worker 精确产物 |
| 可视化产物 | `packages/skills-web-app/bundles/page_design`；流程可补 `flow_design` | JSON 与产物分离、真实文件引用、脚本校验与视觉判断分离 |
| 简洁方法 | `packages/skills-web-app/bundles/whiteboard` | 不必统一正文长度/标题，仍需明确输出、修订、质量检查 |
| 视觉体系 | `packages/skills-web-app/bundles/design_style` | 共享设计来源和一致性；不要把品牌字段当通用要求 |

## 每个方法必须回答的问题

正文以可读的一级标题开始（例如 `# Business Objects`），不要把 `business_data`
这样的内部标识直接当标题；技术名称仍保留在 frontmatter `name`、路径和契约引用中。
仅清理标题时只改标题行，其余方法、原则、协议及 frontmatter 必须逐字保留。
提交前运行 `pnpm test:skill-titles`，检查当前内容、示例和作者技能；历史实验快照不改写。

以下是内容覆盖要求，不是强制章节模板。允许合并、交叉引用 Bundle 内可达资源，保留本领域合适的结构和篇幅；不要求每个方法都有独立的正向/还原两章。

1. **选择**：能力、输出、当前请求为何适用、哪些邻近职责不属于它。frontmatter 的 Capability / Resolves / Candidate when / Do not infer / Output 是好用的写法，不是五段业务流程。
2. **事实**：canonical 文件与直接输入在哪里、字段含义和 ID/引用如何解释。落盘设计是事实；问题类按真实答案字段判断，不能把所有选项或默认示例当回答。不得凭空加入草稿/审批系统。
3. **操作**：领域方法如何把输入变成用户可理解、可修改的内容；区分首次生成、局部修订、缺证据与不支持的能力。
4. **输出**：Agent 能获取的合法字段/类型/枚举、必要引用、示例及 artifact 规则。schema 是形状权威，可读契约是 Agent 的工作入口；二者必须测试一致。
5. **执行**：executor 拥有完整 canonical 集成，Worker 仅拥有已绑定产物。`execution.mode` 与 handoff、fanout 独立，不能写死“一律独立 Producer”。
6. **收尾**：实际校验/修复/保存/交接，明确已做与未做。文件已写不等于发布成功，脚本通过不等于设计优质，运行结束不等于用户已理解。

## 领域证据与设计、还原、修订的差异

方法必须解释证据如何支持本领域判断，不只是列文件名。按当前请求选择必要证据，不要求所有来源同时齐备：

| 工作情境 | 证据与判断边界 |
| --- | --- |
| 首次设计 | 从用户目标、场景、明确约束和直接输入提出本领域方案；外部案例只是参考，示例与建议不是用户已确认事实。未知项按影响提问或明确假设，不强制补齐所有字段。 |
| 还原已有产品 | 从真实界面、运行行为、源代码/配置及已有产物恢复有证据的语义；区分观察、推断和未知。文件/组件目录不等于用户能力，缺少实现细节不授权重新设计、精简范围或添加最佳实践。 |
| 局部修订或保存继续 | 以用户当前指令、权威已保存 diff 与 canonical 为依据；保持未改事实、稳定 ID、用户字段和来源，沿实际依赖更新获准产物。旧来源不覆盖较新的明确用户决定。 |

例如功能拆分看用户结果与完整旅程，而非源码目录数量；权限看实际动作、资源归属与获得角色的证据，而非猜职位；流程看触发、分支与实际异常，而非只把页面排成线。每个 Bundle 应给自己的实质判断，不把这些例子变成统一字段或强制工作流。

同一输出契约可服务不同情境，但契约合法不代表专业判断正确。正向方法解释如何提出和权衡方案；还原契约保留如何忠实表达来源与不确定性的关键约束，不要求执行正向设计流程。只有获准的新设计/修订才改变既有产品行为。

## 保留原则、方法与运行协议

对现有方法重组、抽取或压缩前，建立审查用保留映射，不新增运行状态或 Bundle 数据字段：

| 原内容定位 | 原则/方法/协议及含义 | 保留位置与入口 | 验证证据或未测范围 |
| --- | --- | --- | --- |
| 文件与段落/行号 | 保留其语义，不能只记录标题 | 原位，或 Bundle 可达资源；共享协议可指向既有注入入口 | 实际读取/注入与适用模式，或明确仍未验证 |

- 原则、领域推理、互动技巧、例外与失败处理不得删减或统一成机械模板。输出契约、示例和摘要不能代替完整方法。
- 设计与还原共用的关键约束必须随 Bundle 可达。仓库规范不是已安装 Bundle 的运行输入；正向正文也不是还原调用的保证输入。
- 共享运行协议移出正文前，验证实际系统提示/工具注入覆盖目标宿主与执行模式、阶段。仅存在于源码、另一文档或示例中不算覆盖；没有验证则保持原协议原位。
- 明确移出的是重复运行协议，不是本领域原则。映射应能逐条追溯，交付 diff 也需检查删行；不得用“正文更短”或测试通过代替语义保留。
- 文档修订可做静态保留与链接检查，但不得因此声称已验证宿主注入、真实 Agent、面板持久化或安装包。
- 保留不是让冲突的历史指令继续同时生效。发现固定评分增量、旧协议或其他指令与当前 owning contract 冲突时，列出原句、当前权威和具体冲突，向负责人明确提出处置；按已授权范围修正或标明被取代，不静默删除，也不把冲突指令复制到新模板。保留映射记录原意、替代规则、授权与检查，未解决时明确报告，不宣称规范已无冲突。

## 资源寻址：必须以实际通道验证

当前 `packages/core/src/kit-loader.ts` 将 SKILL.md、skill.yaml、schema.yaml、validation.yaml、panel.yaml 等固定槽位吸入 metadata，并从 `kit.resources` 排除；旧 renderer.md 仅作为遗留摘要来源读取。新摘要使用可选的 skill.yaml.summary；缺省不阻断设计流程，不要求另写摘要文件。`packages/core/src/dsh-design-execution-plugin.ts` 的资源 port 从这个 resources 集合读。

因此当前 DSH 的 `read_skill_resource({path:"reference/artifact-contract.md"})` 可用，`schema.yaml` 不因存在于磁盘就可用。资源工具已经绑定 Bundle，路径不得再加 Bundle 名前缀；分页须读完所选契约。普通项目文件读取不能当作安装资源入口。Native 宿主可按 prepare 返回的实际 resources 根读取同一相对文件；不得猜 `~/dev/.../kits`。

源码对照：`packages/core/src/dsh-producer-design-tools.ts` 定义 read_skill_resource、design_validate、design_publish；native 宿主以其当前 adapter 指令为准，不捏造同名工具。若接口日后变化，复验而非永久维护上述限制的副本。

显式还原入口的实际对照是 `packages/core/src/dsh-design-execution-plugin.ts` 中 `producerSystemPrompt` 的 `reconstruct` 分支与 `packages/core/src/reconstruction-prompt.ts` 中 `reconstructionContractPrompt`：不注入 `skill.content`，而提示读取现有 `reference/artifact-contract.md`。普通设计注入方法正文，正文再链接所需资源。核对两种 prompt 中的入口及资源读取，不以“向正向正文加了一段还原说明”宣称还原已生效；已存在的共享方法（如 Smart Questions 的 5W1H）先读全再判断缺口，不重复添加。

## 条件性内容

- 有跨 Bundle 事实对齐或补充需求时遵循 [协作方法文件规范](../../design-bundle-creator/references/cooperation-authoring.md)，在 `reference/cooperation-guide.md` 说明实际 owner、触发条件、证据和回交边界，并从方法与输出契约链接。规范定义按需内容位置，不要求补齐固定模板或运行全部切片；不扩张 executor 的写入范围。
- 有画布时遵循 [画布方法文件与内容规范](../../design-bundle-creator/references/canvas-authoring.md)，将 `reference/canvas-guide.md` 作为 Bundle 内统一入口。共享规范约束表达责任、事实来源与检查方式；领域图形种类、生成方法和已有专项资料仍由 Bundle 持有，不强制同一种画布。
- 有 artifact 才定义文件格式、存在性、输入版本和刷新关系；不要求每个 Bundle 生成 HTML。
- 可独立的产物才用 Worker；没有 worker 也需正确交付。
- 外部调研、求解器、BPMN 布局、重建、视觉验收按任务需要；不把可选能力变成 Kit 安装前提。
- GRA/KAG 与场景体验复用系统能力。KAG 用于定位证据，不是新的事实所有者；GRA 不应成为前台等待门槛。

## 不采用的历史表述

`docs/bundle-contract.md` 的 execution placement 与当前 loader/tool 是实际对照。`docs/system-design-baseline.md` 等文档仍有“一律 isolated Producer/方法只进入子代理”等历史描述；旧方法也可能写死 clarity 增量或特定 Close-out 标题。不要复制这些成为新规范。缺少被文档引用的 `skill.template.yaml` 时不编造路径，直接查看实际 manifest parser 和已加载实例。

Web App 的登录/存储固定卡、Page Map 分阶段、Style→Page 输入关系、研究报告章节要求是具体 Bundle 的契约，不是所有 Kit 的要求。

# Bundle 固定槽位和验收参考

仓库相对依据：`docs/bundle-contract.md`、`packages/core/src/kit-loader.ts`、`packages/core/src/panel-dsl.ts`。运行机制以当前实现为准，历史差异见下层技能的 standards.md。

| 文件/资源 | 必须表达什么 |
| --- | --- |
| `skill.yaml` | 独立 catalog identity 与运行时 name 分开，配合精确 version、可读 title/label、presentation；execution.mode(main/subagent) 与 handoff 分开选择，不添加自造调度字段 |
| `SKILL.md` | 调用 design-skill-creator 产出可执行方法；frontmatter name 与 manifest 的运行时 name 一致。独立目录使用 identity，不强迫运行时名称随目录改动 |
| `schema.yaml` | canonical 结构、类型/枚举、扩展策略；问答真实答案、记录集合、跨文件引用/metadata 使用已有知识标注能力 |
| `validation.yaml` | 工作中与 completion 的真实消费者约束，不以长度、图表数、风格偏好充当有效性 |
| `panel.yaml` | declarative profile 必需；先核对 `packages/core/src/panel-dsl.ts` 的 `CONTROL_KINDS` / `COMPONENT_KINDS`，不用猜测的控件名。字段与 schema 对齐，引用选项来自实际记录，交互能落回本 Bundle 状态 |
| `skill.yaml.summary` | 可选模型摘要声明；缺省不阻断加载、执行、面板和保存。`fields` 和集合记录字段仅支持 scalar；数组/嵌套对象不可直接塞入 fields。旧 renderer.md 迁移时保留说明为注释，禁止双源 |
| 可读契约/例子 | 方法内联完整形状，或链接 Bundle 内的实际资源；不假设 schema 固定槽位能从资源工具读 |
| `reference/canvas-guide.md` | 含画布时的统一方法入口；按 [画布创作规范](canvas-authoring.md) 说明本领域表达、生成、布局责任及验收，索引而非替换已有专项资料。不是新增 loader 必需槽位 |
| `reference/cooperation-guide.md` | 有跨 Bundle 对齐/补充需求时按 [协作方法规范](cooperation-authoring.md) 填写真实 owner、证据与回交边界；方法和输出契约双入口可达。按需内容位置，不是 loader 必需槽位或强制协作流程 |
| scripts/artifact refs | 仅在必要时提供；领域代码归 Bundle，参数/文件范围/返回状态明确，不能借另一个 Bundle 的私有脚本 |

## 可选 profile

- `presentation.mode: declarative`：系统选择解释器，带 panel.yaml；可选摘要写在 skill.yaml.summary，无需固定 renderer/version 字段。
- `native`：需要已有可信 provider contribution 和真实注册验证；不附一套冲突的 declarative 槽位，不声称零代码接入。
- `none`：明确没有交互面板的特殊能力，不用于省略用户要求的面板。

## 声明式表达的实际边界

控件和组件是封闭集合，写入前读 `panel-dsl.ts` 中相应类型与绑定规则。例如当前有 `list` / `multi_select`，没有一个可任意猜用的 `tags` 控件；子表格控件还受 `ROW_COLUMN_CONTROLS` 限制。按数据和交互目标选类型，不照搬其他 UI 框架的命名。

问题清单优先使用标准 `question_workspace`（无侧栏需求的极小清单可用 `question_list`），不要用 `record_form` 重新拼一套问答 UI。工作区复用通用 `panel_workspace` 的左侧导航和主内容边界；左侧只承载导航，工作区说明写在 `description`，由共享的顶部悬浮 Tip Bar 呈现，不要把长说明塞进窄侧栏。可选 `round` 自动形成轮次，未声明轮次时仍形成一个“当前问题”分组。记录的通用字段是 `prompt`、可选 `note`、`kind`（`text | single | multiple`）、可选 `choices`、`answer` 和可选 `detail`；其中 `choices` 仅服务交互选项，用户事实以非空 `answer` 为准。文本题只编辑一个 `answer` 文本框，已有 `detail` 作为只读上下文保留；选择题可用 `detail` 补充所选答案。可选 `rejected` 只表达问题交互状态；可选 `multimodal_answer` 使用标准本地附件引用，上传字节由 Host 的浏览器传输与 Panel Save 原子保存，绝不能进入 canonical JSON。不要为不需要的 Bundle 强制添加轮次、拒答或附件字段。

需要 Panel 内左侧导航的其他信息切片使用 `panel_workspace` 的 `sidebar` / `main` slots，复用统一的 containment、滚动和窄宽度退化；不要只为某个 Kit 复制一套双栏 CSS。该布局只定义交互骨架，不改变 Bundle 的 canonical 所有权和领域结构。

摘要由 `packages/core/src/renderer.ts` 定义，`kit-loader.ts` 的 `assertDeclarativeConsistency` 核对 schema。顶层字段和集合的记录字段必须是 scalar；`collections.source` 可指向符合契约的 map/array，不意味着其中任意嵌套数组都可作为记录字段输出。数组内容使用支持的集合摘要或面板组件；无法完整概括时说明摘要覆盖限制，引导读取 canonical，而不是伪造扁平化事实字段或静默丢弃重要信息。

## 推荐参考（按类型读，不全量照搬）

- Record/method：`packages/skills-web-app/bundles/function_modules/`。
- Artifact + script：`packages/skills-web-app/bundles/page_design/`。
- Declarative record/question：`packages/skills-web-app/bundles/smart_questions/`。
- Declarative graph/record relations：`packages/skills-web-app/bundles/business_data/`。
- Declarative table/artifact：`packages/skills-web-app/bundles/role_access/`、`packages/skills-web-app/bundles/web_app_prd_assembly/`；矩阵等其他表达先核对 `docs/dsl-spec.md` 的实际组件契约，不从示例目录推断支持范围。
- 可运行验收结构：`packages/skills-web-app/test/test-page-file-contract.mjs` 和 `packages/panel/test/relation-graph-contract.test.mjs`；不要只复制测试名，要换成真实目标数据。

## 验证层次

从目标版本的实际 Core 加载；任意完整内容包与非空样例可先按[现有 API 校验样例](../../../../docs/wiki/extending.md#校验独立内容包)检查。它不代替以下运行期资源、面板和专业能力验收。

1. 实际 loader：固定槽位、schema/panel/renderer 一致、跨面板绑定可解析。
2. Agent 入口：从 SKILL body 读取链接资源；以 loader 的 resources 模拟绑定读取，不绕到源码直接读。
3. 正/负数据：真实非空 fixture 合法；错枚举/缺必需字段/坏引用/越界产物按对应约束失败。schema 通过不意味着所有引用已被其检查。
4. 状态流：编辑一个字段后保存重开；相关 artifact 已刷新或诚实标为未刷新，没有覆盖无关记录。
5. 交互与领域：新增 UI 实测；专业规则和证据独立核对；外部求解/调研缺失时不伪造完成。

运行策略示例：`execution: {mode: main, handoff: must_edit}` 适合需立即在主对话准备的交互记录，但不是问答 Bundle 的强制选项。`user_continue` 适合已有实际两阶段流程；不要给所有 Bundle 套双阶段。

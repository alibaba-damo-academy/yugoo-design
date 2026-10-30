# 扩展开发

[English](extending.en.md)

本页面向语构设计系统（Yugoo Design）的设计套件（Kit）与设计技能包（Bundle）开发者。运行时责任、版本与发布规则以 [Bundle contract](../bundle-contract.md) 和[架构基线](../system-design-baseline.md)为准。

下文的原地编辑与项目自带内容说明对应当前开发源码，已安装版须包含相应运行时才支持。内容库按身份保留当前内容，新项目复制完整 Kit 与挂载 Bundle 到自己的 `design_kit`，已有项目继续使用自身文件；来源版本用于追溯，本地保存不要求发新版本。文件维护边界见[项目内容维护](../project-content-upgrade.md)。

第一次定制可以先做[客户交付规则的最小教程](custom-kit-tutorial.md)：复制一个完整声明式 Bundle，写领域引导，修改面板文案和非空样例，再验证并查看。下面按职责、结构和验证问题提供参考，便于处理超出该练习的改动。

## 先确定你要改变什么

设计套件（Kit）组合领域主提示词（Mindset）与所挂载的设计技能包（Bundle），可以理解为领域专家的工作方式与工具箱。Mindset 描述专家的个性、思考模式与特殊考虑，Bundle 承载一个可以独立推敲和维护的设计维度。

| 目标 | 修改位置 | 例子 |
| --- | --- | --- |
| 改变领域引导与方法选择 | 独立 Kit 的 Mindset | 为团队增加“先检查既有证据，再决定是否提问”的领域策略 |
| 调整某个维度的方法或交互 | 独立 Bundle 及相关契约 | 为功能模块增加领域判断，或调整卡片与详情的呈现 |
| 组合已有能力 | Kit 的 Bundle 挂载 | 选择适合当前领域的能力，而非复制全部官方 Bundle |
| 增加现有组件无法提供的交互 | 共享组件或受信任 Provider | 新领域编辑器；需要运行时实现和发行 |

以能独立推敲、保存和继续修订的设计成果作为 Bundle 的组织单位。例如，功能范围、业务流程和数学模型各自有需要理解与判断的内容；一个成果也可以通过画布、表格和详情表单共同表达。按钮、菜单或一次工具调用通常不足以形成独立 Bundle。

拆分时说明每个 Bundle 拥有哪些事实、引用哪些已有结果，以及用户在这里作什么判断。数学模型和求解结果可以分别维护模型定义与运行证据；表格视图和矩阵视图则可能只是同一数据的两种表达。不同 Bundle 之间的关系用引用和既有协作方式连接，不把同一事实再存一份。

## 一个最小创作闭环

1. **定义任务与结果。** 说明目标使用者、要作出的判断、已有材料和最小有价值的设计结果。用合成情境作为例子，明确未知项。
2. **选择现有起点。** 编辑现有身份即可保存其当前内容；需要独立方案时复制 Kit，并按需复制相关 Bundle、调整挂载。完整方法和许可资源随副本保留，见下方[脚手架与复制](#创建脚手架)。
3. **同步方法和数据。** 说明如何选择证据、产生设计及修订已有事实，再定义输出结构和校验。方法正文不能由一个 schema 链接或通用操作提示替代。
4. **表达并检验结果。** 从目标版本支持的组件选择合适的图、表、卡片或工作区，将编辑绑定到 canonical 字段。为新增或更新的 Bundle 维护非空、可验证的合成样例；需要 Studio 预览的声明式面板使用该入口读取的 `reference/preview.json`。样例要求见[样例与验证](#样例与验证)，不新增通用 loader 必填槽。
5. **从真正的运行入口使用。** 加载完整内容，确认方法及引用资源可读，检查合法与错误输入。然后在独立项目生成、编辑、保存、重开并继续，检查修改是否影响相关结果。
6. **交给独立接收者。** 提供完整资源、版本、依赖、许可和一个最小请求，让接收者按公共说明导入或加载，并完成同样的闭环，见[分享指南](kit-sharing.md#作者与接收者的最小验证)。

作者 Skill 的分工为 [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md) → [Bundle Creator](../../.agents/skills/design-bundle-creator/SKILL.md) → [Skill Creator](../../.agents/skills/design-skill-creator/SKILL.md)。这是创作方法的组合，不要求创建额外 Agent；同一执行者可以顺序完成。仅修改文案、仅加载成功或样例预览都不能替代新能力的真实使用验收。

## Kit 与 Bundle 一起设计

Mindset 的创作方法作为可共享的 [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md) 提供，具体见 [Mindset 写作规范](../../.agents/skills/design-kit-creator/references/mindset-authoring.md)。自动挂载目录已提供普通技能入口；正文补充专家的身份、个性与思考方式、重要的跨 Bundle 依赖、特殊约定与专业判断，并控制常驻上下文的篇幅。创作者决定专家的协作风格，不必照抄官方 Kit 的顾问式章节或为所有能力重复写一遍说明。

Bundle 提供具体方法与表达工具，领域主提示词（Mindset）组织它们的使用方式，配合 Bundle 的交接策略形成协作节奏。官方 Kit 采用顾问式引导；其他 Kit 也可以先批量展开成果再集中审阅。好的领域引导会根据用户已知信息、当前目的和已有设计选择方法，解释为什么值得做，并在结果保存后重新判断下一步。

例如，优化建模套件面对懂业务、不了解数学建模的用户，应先用熟悉的业务语言展示对象、规则和小规模样例，帮助用户确认，再逐步解释模型和计算结果。若数据面板要求用户填写字段，Mindset 就不能仍把同一轮描述为“系统已经根据材料准备好，请直接确认”。两者需要共同表达实际的互动方式。

调整 Bundle 的职责、字段、结果或交互时，同时复查 Kit 的介绍、挂载说明与 Mindset：它是否仍推荐正确能力，是否知道用户能在面板中看见和修改什么，是否能解释结果及后续影响。用“用户提出目标 → Agent 展开具体成果 → 用户反馈 → Agent 修订或建议下一步”的有限案例检查连贯性，不要求案例运行所有 Bundle。

## 结合 Studio 维护内容

设计工作室（Studio）帮助作者检查专业方法最终被表达成了什么。可以先查看现有 Bundle 的方法和样例，操作相关视图，记录具体对象、预期行为和实际问题，再进行修改。

在当前 Studio 中选择“编辑”，即打开同一身份的当前文件；“复制”用于创建独立方案。文件尚未完整时可以先保存，再根据加载或预览的诊断补全。支持宿主对话创作的版本可将当前对象和修改请求交给原宿主 Agent，在同一源码与预览中检查建议并明确保存。未接入该能力时，可由开发 Agent 在独立作者源维护完整 Bundle 的方法、数据结构、验证与组件，再回到 Studio 检查。原生“试运行”检验已保存方法的实际生成，不代替项目中的保存重开与续作。

每轮修改先核对 Studio 正在读取的内容身份和来源，保存后重新查看方法、资源和样例。已有组件支持的 Panel 声明修改属于内容维护；新增共享组件需要对应运行时构建与发行。库中的保存影响之后创建的项目。更新已有项目时，请 Agent 对比库与项目的 `design_kit`，保留定制后通过普通文件编辑、校验和 Git 记录修改。预览、源码保存、项目文件更新及 npm 发布分别验证；无需额外本地发布或采用步骤。操作见[Studio 使用指南](usage.md#6-studio查看定制和检验套件)，交付见[分享与项目维护](kit-sharing.md)。

## 选择扩展类型

纯声明式 Kit 只包含内容，不需要修改 Core。Bundle 可以使用通用声明式 Panel；只有需要受信任执行逻辑、原生 React Panel 或专用 artifact 处理时才增加 Provider 插件。

Kit 不能自行创建模型 Client，也不能控制 Design Project、Studio 或 G/R/A 的启停。模型、凭据、提问和 Subagent 始终由 Agent Host 提供。

选择交互形式时，可以用声明式布局或 A2UI 从支持的组件中组织问题、表格、图表、原型或白板，也可以复用专业编辑器。在内容库中保存当前文件，或按目标项目的更新请求修订其自带文件；新增运行时组件或可信 native provider 需要相应的运行时发行。具体契约见 [Bundle contract](../bundle-contract.md) 和 [Panel DSL](../dsl-spec.md)。

## 创建脚手架

可以先复制[现场作业内容示例](../../examples/field-operations-shared/README.md)：它包含完整 Mindset、一个声明式 Bundle、双语标签、输出契约和明确标为合成的非空示例。通过宿主支持的 Kit 加载入口接入副本，再为新项目选择它；这类内容定制无需修改 Core。示例 README 记录了从独立目录加载并读回定制内容的使用结果。

目标目录必须尚不存在（空目录和符号链接也不接受），以免覆盖已创建的 Kit。
Kit 与 Bundle 目录身份使用小写字母开头的字母、数字或下划线，并按目标 loader 校验。Bundle 身份独立于 Kit；同一 Kit 不能重复挂载同一身份或占用同一运行时绑定。
脚手架只是起点，不是完整专业方法或已通过真实 Agent 的 Kit。

### 让 Agent 复制并定制 Web App Kit

可以把以下请求交给已有宿主 Agent：

> 从当前实际安装或源码中的完整 Web App Kit 复制到一个尚不存在的独立目录，
> 保留 LICENSE、NOTICE、第三方声明和全部方法资源。把副本 Mindset 的 name
> 改为 workshop_web_copy，先只调整领域引导，保留 kit.yaml 中的全部 Bundle 身份和挂载声明；
> 不改 Core、不改原 Kit、不改已有项目的文件，也不改字段、稳定 ID 或产物路径。
> 用目标安装版本的公开 Kit loader 加载副本，读取方法引用的资源并校验非空
> 合成样例及错误输入。报告实际结果，然后给出该宿主已有的显式选择入口。

Kit 的身份来自 `mindset.md` frontmatter；仅改目录名或 npm package name
不会创建新 Kit 身份。要独立发布 npm 包时另定自己的包名和版本，不覆盖原包。
复制 Kit 保留原有 Bundle 身份引用，不会同时创建每个 Bundle 的独立身份。
如果还要定制 `function_modules` 等 Bundle 的界面文案或方法，应通过目标版本支持的
独立 Bundle 创作入口建立新的目录身份（catalog identity），再修改副本并显式更新 Kit 挂载。
该身份与运行时 `name` 分开：保留原运行时名称、方法约定及 canonical 数据路径，
不要批量替换用户字段。新身份不继承原 native Provider 的信任；同一 Kit 内的运行时绑定仍须唯一。
保留原来源与可恢复备份；需要独立身份时使用复制，不只改目录名。

独立 Bundle 副本只调整翻译时编辑其 `locales/`；改变字段或交互时同时核对 schema、
validation、Panel 与输出契约。既有声明式组件可由内容加载复用，无需重编译
Core；新交互能力仍须补共享运行时实现。完整 Web App Kit 含脚本依赖，复制
目录不会自动安装这些依赖，按随包 README 区分独立目录与自包含 Companion。

完成定制后，在独立项目中检查受改动影响的方法、文案、资源和样例，再通过实际生成、编辑保存与重开确认使用体验。可复用示例已有的检查结果，新的方法或交互需验证其变化；按风险选择检查范围，再分享完整目录。发现、项目选择及原件恢复见[Kit 分享指南](kit-sharing.md)。

### 当前内容组织

Kit 组合方法和 Bundle 身份引用，Bundle 独立维护自己的方法、数据和呈现契约。以当前 Web App 内容包为例：

```text
my-content-package/
├── package.json
├── kits/
│   └── my_kit/
│       ├── mindset.md
│       ├── kit.yaml           # 精确 Bundle 挂载清单
│       └── relations.yaml     # 可选：Kit 级 KAG 关系扩展
└── bundles/
    └── my_bundle/
        ├── SKILL.md
        ├── skill.yaml         # 身份、执行与交接；可选 summary
        ├── schema.yaml
        ├── validation.yaml
        ├── panel.yaml         # 声明式面板
        └── reference/
            └── artifact-contract.md
```

`package.json.designSystem.kit` 声明 Kit 的 `root`、`mindset`、挂载 `manifest` 和 Bundle 搜索目录 `bundles`。**这四个路径都相对于包根目录**，不能使用绝对路径或越出包目录；`mindset` 和 `manifest` 不相对于 `root`。上面的目录可使用：

```json
{
  "designSystem": {
    "kit": {
      "root": "./kits/my_kit",
      "mindset": "./kits/my_kit/mindset.md",
      "manifest": "./kits/my_kit/kit.yaml",
      "bundles": "./bundles"
    }
  }
}
```

npm 包只是分发容器；Kit 与 Bundle 的身份、版本和生命周期各自独立。加载包根目录时使用通用 Kit resolver；仅加载 Kit 目录时还需提供能解析其挂载的 Bundle resolver。Bundle 目录名与 `skill.yaml.identity` 对应，挂载项的 `name` 使用该身份，`bindingKey` 与运行时 `skill.yaml.name` 一致；Mindset 中的 `<design_skills>` 按 `bindingKey` 展示方法入口。具体配置见[官方内容包](../../packages/skills-web-app/README.md)；实际加载步骤见[Companion 显式选择](kit-sharing.md#companion显式目录与项目选择)。

仓库旧脚手架 `scripts/create-design-system.mjs` 仍生成 `mindset.md + skills/` 布局，不能直接作为当前独立目录结构的模板。创建新内容请使用现有 [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md) 与当前内容包；兼容旧布局的示例须按其目标 loader 版本验证。Kit 内容保持宿主无关，不包含 Cordis profile patch、模型 Provider 或 DSH 依赖。

## 可选 KAG 关系扩展

Core 提供跨 Kit 的小型通用关系词汇。只有领域关系无法准确落入 Core 词汇时，Kit 才需要在根目录增加 `relations.yaml`；Bundle schema 和 Design Files 不增加字段。Studio 中的展示与编辑入口以实际安装版本为准，关系声明仍须经过 Core 校验及精确版本解析。

```yaml
schema_version: 1
relations:
  - type: my_kit:validates
    meaning: supports
    direction: forward
    label:
      zh: 验证
      en: Validates
    description:
      zh: A 的证据验证 B
      en: Evidence from A validates B
    # 以下约束全部可选。类型 id 来自 Studio/图谱详情显示的
    # `{kit}/{bundle}#{schema-pointer}`，不是 Design File 新字段。
    domain: [my_kit/research#/properties/evidence/value]
    range: [my_kit/research#/properties/claims/value]
    cardinality: { from: many, to: one }
    reasoning: { impact: true, causal: false, transitive: false }
    evidence: { minimum: explicit }
```

- `type` 必须使用当前 Kit 的 `kit_name:local-name` 命名空间，不能覆盖 Core 类型。
- `meaning` 可以复用 Core 语义，或使用当前 Kit 的命名空间声明更专门的语义。
- 结构性的 `contains` 只由设计文件投影维护，不能被 Kit 扩展复用，也不能由 GRA 推断。
- `direction` 只能是 `forward` 或 `symmetric`；复用 Core 语义时方向必须一致。
- `label` 与 `description` 必须同时提供中英文。声明随精确 Kit 版本编译并生成内容 pin。
- `domain`、`range`、`inverse`、`cardinality`、`reasoning` 和 `evidence` 是可选的保守约束；引用不存在的本体类型或关系会在 Kit 加载时失败，不会降级猜测。
- Agent 优先选择准确的 Kit 扩展，其次选择可推断的 Core 关系；均不匹配时写入类似 `unknown:related-context` 的有界原始类型。Core 将它分类为 `unknown`，保留原始类型用于展示和精确查询，但不会赋予因果、依赖或方向语义。

每个 Kit 的本体类型与属性 shape 会由现有 `schema.yaml` 自动编译，因此 Kit 作者无需创建 `ontology.yaml`，也不需要在 Design Files 中维护 `designRoles`。图谱详情会显示实例的自动类型，Studio 展示可选关系扩展及其约束，编辑与发布按实际安装版本支持的入口进行。

## 声明可选的知识投影

Bundle 作者可以在 `schema.yaml` 的字段上使用 `knowledge`，区分技术元数据、明确引用和内容粒度。声明只影响派生知识图谱，不删除设计文件中的值，也不要求用户另填一组图谱分类字段。没有声明时保留普通内容，不根据字段名或 Bundle 名猜测元数据和业务关系。

```yaml
type: object
properties:
  schema_version:
    type: number
    knowledge: { role: metadata }
  records:
    type: map
    value:
      type: object
      properties:
        name: { type: string }
  selected_record:
    type: string
    knowledge: { role: reference, target: '#/records' }
```

- `metadata` 将该字段或子树排除于图节点、节点上下文及下游语义索引之外，原值仍保留。业务中的 `version` 等名称不会自动被当作技术元数据。
- `reference` 声明字符串叶子的明确引用；数组引用在 `items` 上声明。可选 `target` 是当前文件的 `#/集合路径`，或其他规范文件的 `bundle/bundle.json#/集合路径`。它限定匹配范围，不授予文件访问或跨 Bundle 写入权限；缺失或歧义引用保留原文证据并产生诊断。
- `content` 配合 `granularity: container | unit | property`，分别表达内容容器、独立内容单元或所属内容的属性；可选 `label` 提供可读标题，不改变身份或源事实。例如[功能详情 schema](../../packages/skills-web-app/bundles/function_modules/schema.yaml)将详情分为核心行为、输入、结果和边界，[风格 schema](../../packages/skills-web-app/bundles/design_style/schema.yaml)区分风格容器与具体规范。

这些是可选的内容投影声明，不是职责分类 `designRoles`。创建或修订后，使用目标版本已有的 schema 与 Bundle 校验入口，再核对节点、引用和来源是否表达了原设计；不要为了图形好看改变业务数据。独立来源与汇总产物的区别见[知识来源规则](../design-knowledge-source-policy.md)，读图方式见[使用指南](usage.md#查看-kag-与索引状态)。

## Bundle 文件责任

- `SKILL.md`：frontmatter 提供能力描述；正文定义专业方法、已有产物修订方式、验证和收尾要求。
- `skill.yaml`：稳定身份、版本、执行位置、交接和呈现声明；可选 `summary` 定义模型摘要。省略摘要不阻止执行或保存，显式无效的摘要仍须修正。
- `schema.yaml`：Design state 的落盘结构验证。
- `validation.yaml`：可复用规则与受信任验证 contribution。
- `panel.yaml`：通用 Panel DSL 声明；语法见 [Panel DSL](../dsl-spec.md)。
- `reference/`：可读输出契约及 Bundle 所需的专业参考资源。声明式摘要使用 `skill.yaml.summary`；旧 `renderer.md` 按 [Bundle 摘要迁移规则](../bundle-contract.md#declarative-model-summary)处理，不与新声明并存。

Bundle 只能写自己声明拥有的 Design state 和 artifacts。跨 Bundle 读取用于理解和验证；需要补充或修订其他 Bundle 时，由 caller 在已有授权、校验和发布边界内调用目标 owner。

有画布的 Bundle 以 `reference/canvas-guide.md` 汇集其领域画布方法；确有跨 Bundle 配合需求时使用 `reference/cooperation-guide.md`。两者都应从 `SKILL.md` 与可读输出契约到达，保留既有专门指南。无相应需求不创建占位文件，它们也不增加 loader 必填槽或跨 Bundle 写权限。详见[画布创作约定](../../.agents/skills/design-bundle-creator/references/canvas-authoring.md)与[协作创作约定](../../.agents/skills/design-bundle-creator/references/cooperation-authoring.md)。

## Panel 选择

优先使用声明式 Panel，使 Kit 内容可以在不重新编译 Panel runtime 的情况下加载。需要原生 React 或可执行行为时，Provider 注册稳定 contribution id，Bundle 只引用该 id。

创作入口是 [Bundle Creator](../../.agents/skills/design-bundle-creator/SKILL.md) 的
[Panel 声明指南](../../.agents/skills/design-bundle-creator/references/panel-authoring.md)。
先根据用户要作出的判断和实际数据选择表达，再从目标版本的组件目录核对属性和字段绑定；不要根据常见 UI
框架猜组件名。组件查询脚本面向源码 checkout，不要求 npm 安装包含开发源码。
安装 Companion 后，可通过其 MCP `design_list_panel_components` 使用 `{}` 查询
组件目录，或用 `{ "name": "record_workspace" }` 查询一个准确名称；无需先创建
项目或连接项目。先在实际安装版本的 `tools/list` 确认该入口，旧安装不会随
源码更新获得新工具。目录用于能力选择，不是完整属性 schema；属性和绑定仍须
核对目标版本的契约，不能根据名称猜测。详见
[已安装组件发现入口](../../packages/companion/README.md#discover-panel-components-before-authoring)。
带作者参考资源的新包还可用同一工具按需查询，例如
`{ "name": "record_form", "reference": "contract" }`，或将 `reference`
设为 `docs`、`examples`；返回的 `read` 对象可作为同一工具的下一次参数。
精确嵌套声明可加 `type`，例如 `ComponentNode.navigation_map.edges`，且仅用于
`contract`。这些调用读取同包资源，不要求源码 checkout；材料缺失或与组件目录
不匹配时明确拒绝，不转而搜索本机源码。文档覆盖、无现成用例及仅结构校验的
限制以返回值为准；宿主回调声明不授予 DSL 执行脚本的权限。
方法说明由 [Skill Creator](../../.agents/skills/design-skill-creator/SKILL.md) 维护；
涉及 Panel、schema 或绑定的修改要回到 Bundle 层协同处理。

所有 Kit 共用同一套面板基础：左侧导航与树、内容框架、字号、间距、控件和读写操作由共享组件及 `packages/panel/src/visual-components.css` 负责。Bundle 只声明业务对象、关系、字段、顺序与需要的视图；不要附带基础 CSS、调字号或复制控件来修局部布局。现有组件表达不了可复用交互时，按共享组件缺口处理，见[Panel UIUX 标准](../panel-uiux-standard.md)。

每个独立填写字段都要有具体用途：谁提供或确认、影响哪个判断、后续如何使用。普通待确认事项、假设、设计依据和来源说明合并进对象的可选备注；有独立业务含义的规则、约束及专门证据产物保留。面板自查要核对是否帮助人理解和思考、操作是否熟悉方便、信息组织是否便于改写表达，以及改动影响是否可见；默认不把存储分区拆成多个内部 Tab。详见[字段价值](../panel-uiux-standard.md#独立填写字段的价值)与[面板自查](../panel-uiux-standard.md#面板自查)。

修订声明时逐项保留选择、增删改、排序、附件、引用及保存重开等原有操作，
保持 canonical 路径和稳定 ID，不为新布局批量改写用户数据。UI 文案放在 Bundle
语言资源中，切换语言不翻译或改写用户业务文本。仅更改 `panel.yaml` 或语言资源
应通过重新加载内容生效；新增共享运行时组件才需要相应构建和发布。

交付时一并核对 section/字段的数据路径、schema 与语言资源，具体检查见
[Panel 声明指南](../../.agents/skills/design-bundle-creator/references/panel-authoring.md#绑定与内容更新的交付检查)。
确认实际面板读取了希望测试的已保存内容。当前源码中，内容库保存影响未来项目；
已有项目使用自己的 `design_kit`，按用户的更新请求比较并修订这些文件，保留定制，
再执行原有校验和 Git 记录。源目录修改不等于更新已安装的 npm 包，也不要求为普通
本地保存增加版本发布、重新挂载或采用步骤。

Panel 的保存路径必须经过 Schema、validation、受控文件写入和 Git checkpoint。不要从浏览器直接写项目文件。

## 执行位置与 Subagent

Bundle 的 `execution.mode` 决定在主对话执行（`main`）还是使用独立 Producer
（`subagent`），不由 Panel 类型决定。方法必须允许选定的执行者串行完成；
`main` 不需要虚构一个 Producer。可选 Worker fan-out 用于降低独立工作项的
延迟，不能成为正确性的前提，也不转移 canonical 数据的发布责任。
执行位置与发布责任见 [Bundle 执行契约](../bundle-contract.md#execution-placement)。

## 本地验证

### 样例与验证

每个新增或更新的 Bundle 都应有一份能体现其主要用途的非空合成样例，并随方法、字段和交互变化一起维护。样例让作者和接收者可以判断表达是否可读、交互是否合理；schema 允许空集合，不代表空界面足以验收。

| 内容 | 样例至少应展示什么 |
| --- | --- |
| 记录、关系或数据表 | 可区分的记录、真实字段类型及有意义的关系；提供少量足以理解的值 |
| 公式或数学模型 | 可读的公式、业务解释和符号含义，区分假设、定义和待验证结论 |
| 图表、报告或文件预览 | 实际可读取的有限示例文件与匹配引用，能检查内容和区域布局 |
| 无交互面板的 Bundle | 可读取的输入、预期输出和验证方法，不为满足截图要求伪造面板 |

当前 Studio 已安装面板预览针对已有声明式面板，优先读取 `reference/preview.json`，也可使用该版本支持的声明初始值或显式样例输入。原生面板不提供这一 YAML 预览，需在其 Provider 已支持的界面或独立项目验证样例。若样例引用 HTML、图形或报告，应随同提供受限资源，不能只留一个空路径。示例必须清楚标为合成内容；模拟求解数据不证明求解器已经运行，预览交互不写入用户设计。

样例需覆盖本次修改影响的主要状态，如有值与缺值、可编辑与只读、图表与说明的切换；再提供能触发相关约束的错误输入。按风险选取代表性状态，不把所有组件组合都列成每次修改的强制清单。加载、校验、真实呈现、保存重开和 Agent 使用分别记录结果。

### 校验独立内容包

当前没有接收任意包根目录和样例 JSON 的通用 `kit validate` 命令。现有仓库 smoke
脚本检查它们指定的官方 Kit；Companion 的 `validate --project ... --skill ...`
检查已有项目的 canonical 文件，不能直接当作内容包校验器。

可以复用 Core 已导出的 `resolveDesignKitPackage`、`loadDesignKit` 和
`validateSkillDesign`。下面是 API 调用样例，不是新增产品 CLI。在已有匹配 Core
构建产物的开发 checkout 根目录运行，依次传入完整包根目录、Bundle **运行时
`name`** 和非空合成样例 JSON 的绝对路径；不传目录身份（`identity`）：

```bash
node --input-type=module - /absolute/my-content-package supply_needs /absolute/example.json <<'JS'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveDesignKitPackage, loadDesignKit, validateSkillDesign } from './packages/core/lib/index.js'

const [packagePath, runtimeName, examplePath] = process.argv.slice(2)
if (!packagePath || !runtimeName || !examplePath) throw Error('Provide package, runtime name and example paths')
const packageRoot = resolve(packagePath)
const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}
const location = await resolveDesignKitPackage(fs, packageRoot)
if (!location) throw Error('Missing package.json.designSystem.kit entry')
const kit = await loadDesignKit(fs, location, { sourceId: packageRoot })
const skill = kit.skills.find(item => item.name === runtimeName)
if (!skill) throw Error('Runtime Bundle name is not mounted in this Kit')
const state = JSON.parse(await readFile(resolve(examplePath), 'utf8'))
const issues = await validateSkillDesign(skill, state, { scopes: ['state', 'completion'] })
console.log(JSON.stringify({ kit: kit.name, version: kit.version,
  bundle: skill.catalogName ?? skill.name, runtimeName: skill.name,
  valid: issues.length === 0, issues }, null, 2))
if (issues.length) process.exitCode = 1
JS
```

此样例只读取内容与样例，不创建设计项目、执行 Bundle 脚本或请求模型。加载时
检查精确挂载、声明、schema、Panel 绑定及语言资源；样例检查使用现有数据与
completion 规则。分别运行中英文样例，并提供能触发实际约束的错误样例。
含文件产物的 Bundle 还需提供真实且受限的 `artifactText` 读取器，或在隔离项目中
使用现有项目校验入口；仅凭 JSON 样例不能证明文件存在、脚本执行或领域计算正确。
安装版另核对其实际 Core 导出入口，不把源码构建当成已安装 npm 的验收。

### 仓库回归与真实使用

先用目标版本的 Kit loader、schema 和 Panel DSL 校验非空样例，检查精确挂载、方法资源、语言资源和字段绑定。再在面板编辑、保存、重开，确认无关字段没有被覆盖。纯声明或语言资源修改通过内容重载检查效果，无需重编译整个产品。

根据改动补充相关反例，例如缺少必要定义或资源、无效声明式面板及摘要。省略可选摘要仍应能加载。含产物的 Bundle 还要检查实际文件；新方法需在目标宿主中实际使用。分别记录加载、结构校验、面板交互和 Agent 使用的结果，便于接收者了解适用范围。

同时修改共享组件或 Provider 代码时，再增加对应包的类型检查、构建和必要浏览器操作。按[开发指南](development.md#从最小相关检查开始)从当前 checkout 的根脚本或所属包脚本选择检查，并先准备匹配的构建产物。内部仓库的快捷回归脚本仅用于其对应源码环境；普通内容作者使用上文的公开 API 和目标宿主即可。

官方 Web App Kit 可作为内容与 Provider 分离的示例：

- [`packages/skills-web-app`](../../packages/skills-web-app/)
- [`packages/provider-web-app`](../../packages/provider-web-app/)

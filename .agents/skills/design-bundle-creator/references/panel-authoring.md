# 声明式面板创作与维护

编写前读取目标仓库的 [Panel UIUX 规范](../../../../docs/panel-uiux-standard.md)：
按用户任务选择图形/表单，再应用共享文字层级、空间、控件、状态和保存规则。
这是视觉/交互与审查入口，不是另一份 DSL schema；已确认场景基线不自动成为
所有 Bundle 的布局。仅安装本技能但没有目标仓库时，不猜开发机路径；按下文
组件参考入口获取同包 `sharedStandards`，缺少时明确版本/资料缺口。

含画布的 Bundle 同时遵循 [画布方法文件规范](canvas-authoring.md)：以自身
`reference/canvas-guide.md` 汇合领域生成方法，并从普通方法和还原契约均可达。
它不替代下面的组件契约；统一文件/内容边界不表示统一图形类型或布局。

PanelManifest 是当前使用的纯数据契约，A2UI 当前通过自定义 DesignPanel 适配。
这不等于完整标准组件/绑定互操作已经实现。扩展前先核对 A2UI 已有能力，避免
新增平行语法；现有 Bundle 则使用目标运行时实际支持的契约，不猜写尚未接入的
标准节点。不要让 Kit 提供可执行 JSX、CSS 或脚本。

## 唯一共享基础与作者边界

所有 Kit 共用一个 Panel 基础，不按 Web App、运筹或企业定制场景分别建设。
基础排版的唯一维护文件是 `packages/panel/src/visual-components.css`，行为由
对应共享组件提供。宿主窗口、主题资源及专业图形库各有职责，不能给普通侧栏、
内容页和表单再提供一套覆盖样式。安装版作者使用已安装的组件，不需要源码路径
或修改运行时样式。

| 作者声明的内容 | 共享层自动提供 |
| --- | --- |
| 核心对象、真实父子关系、必要分组和名称 | 同一侧栏/树、层级缩进、展开与选中、滚动、各层级的上下文新增 |
| 方法提示、主次内容、字段顺序与分组 | 内容页框架、留白、标题/正文/辅助文字层次、组间与组内间距 |
| 字段类型、合法选项、引用目标和说明 | 一致的输入、选择菜单、长文编辑、焦点、只读与校验反馈 |
| 允许新增/删除、查看详情和可选补充内容 | 共享操作区、删除确认、内联编辑、展开收起、暂态内容保留 |
| 对象关系图、表格、卡片、报告等有意义的视图 | 对应共享工作区、同源选择与编辑、滚动和尺寸适配 |

作者关注“让人理解什么、判断什么、可以修改什么”，不重复设计基础 UIUX。
优先使用现成工作区和组合组件，不用空白节点、层层容器、CSS 或自制按钮模拟
它们。仅标题的记录投影不制造空正文；同一详情容器只管理一次留白；已有对象
导航不重复自动返回链；单一集合不制造同名分类根节点。
需要新的业务表达仍须选择合理形态，不能假定共享样式会自动修正内容堆叠。
现有形态缺少通用能力时修 owning 组件，并在原样式定义处改进、清理被替代规则，
不追加按 Kit 或 Bundle 匹配的补丁。规范记录共同决定，组件落实共同默认值。
内容变更只检查受影响的阅读与改写路径；共享基础变更才横向检查相关形态，复用
未变化的证据，不要求每个 Bundle 重跑全套 UI 验证。

迁移或升级时，先确定主线已确认的完整共享版本，并让运行中的组件、样式与
Bundle 来源对应这份代码。不能以旧副本含有同名文件或零散修复作为对齐证明；
已有 Bundle 的相同能力应复用当前来源，内容定制只保留必要的领域差异。

## 面板自查

创建、修订和迁移面板都要先按人的阅读、思考和改写过程组织信息。设计时选择
表达方式，交付前结合代表性的非空内容回答以下问题；详细标准见前述 Panel UIUX
规范的“面板自查”（安装版从同包 `sharedStandards` 读取）：

1. 信息表达能否帮助目标用户理解整体、关系与细节，并在相关位置思考条件、取舍与未知？
2. 查看、定位、选择、修改和返回是否方便，符合人的操作习惯，反馈是否清楚？
3. 信息量、层级与编辑空间是否方便人直接改写内容，在同一上下文中表达诉求与想法？
4. 人能否看出自己的修改结果，区分建议、决定与未知，并沿真实保存/继续机制与 AI 对齐？

原则上不推荐面板采用多个内部 Tab，尤其不要把存储 section 逐一变成页签。
优先围绕对象或判断组织相关信息、就近编辑与按需展开；确有独立任务或视图时
说明切换价值，保留选择、未提交内容和阅读位置，不把需要同时比较的信息拆开。
不设统一的 Tab 数量，也不强制所有面板共用一种布局。

在已有任务或交付记录中结合实际阅读和人工改写路径说明自查依据、问题与未测项，
不只罗列组件、字段或声明“符合规范”。迁移对照原有主视图及实际操作；表达能力
不足时明确缺口，不以平铺表单冒充交互保留。自查不新增用户输入、评分、审批
或每次全量回归；纯规范修改仍只检查文档与入口。

### 字段取舍

每个独立填写字段都要能回答：谁提供或确认、影响什么判断或供后续哪里使用、
是否与已有字段重复。按共享 UIUX 规范的“独立填写字段的价值”逐项取舍，
不把 schema 字段数量当作面板完整性。所有 Kit、所有 Bundle 的一般性待确认事项、
假设、设计依据、来源说明和补充说明统一归入所属对象的可选“备注”；不再逐记录
添加“待确认与依据”区域或多个普通说明输入，不能仅改组标题而保留重复字段。
在备注正文里说清哪些还未决定，不把保留未知误解为必须提供独立待确认字段。
有独立业务用途的规则、条件、约束，以及提问、研究、校验等专用 Bundle 的核心
内容仍用对应的有意义控件；这些是业务内容，不是允许复制通用说明字段的例外。
已有编辑入口不重复，派生信息与技术元数据按实际能力提供可读上下文，不让用户
重复手填。简化时保留用户内容、来源、版本与读取/纠正入口；数据语义变化须同步
schema、方法、输出契约及必要迁移，不能只换标题或隐藏后丢失内容。
在现有自查记录中说明有争议字段的保留或合并理由，无须另建逐字段验收台账。

## 先发现能力，再组合

使用已安装 Companion 时，先在实际 MCP `tools/list` 确认
`design_list_panel_components`，用 `{}` 发现目标运行时目录，再用准确 `name`
筛选组件。带作者参考材料的新包可按需传
`{ "name": "record_form", "reference": "contract" }`；`reference` 还支持
`docs` 和 `examples`。返回的 `read` 对象是同一工具的下一次参数，不是源码 CLI。
大类型可聚焦，例如
`{ "name": "navigation_workspace", "reference": "contract", "type": "ComponentNode.navigation_map.edges" }`。
`type` 只用于契约；文档覆盖与无现成用例以返回值为准，例子仅通过结构校验。
新作者材料的 `reference: "docs"` 同时返回 `documentation.sharedStandards`：
其 `content` 是同包 Panel UIUX 规范原文，文件定位只是来源，不要求安装源码。
读取一次即可用于本次组合，不必对每个组件重复灌入；旧包没有时不得声称已读。
这些查询读取同包资源，不需要项目连接、模型、checkout 或运行态 TypeScript。
材料缺失/不匹配时明确拒绝；不要搜索开发机源码来冒充安装版契约。旧包没有该
能力时说明版本缺口，源码中的新增工具不会自动进入安装包。宿主 `RenderOptions`
回调只是可信集成契约，不授予 DSL 事件处理或脚本执行权限。

在源码 checkout 中，可运行本技能的 `scripts/list-panel-components.mjs <repo>`，读取
实际组件用途与自动生成可用范围。该脚本要求支持 TypeScript 类型剥离的
仓库 Node 环境。没有新目录文件的旧运行时，直接读取它的 `panel-dsl.ts`；
不要假称新组件已安装，也不要向 DSL 猜写常见 UI 框架组件名。

目录提供用途，不等于完整属性 schema。选中组件后核对目标仓库
`packages/core/src/panel-dsl.ts` 的 ComponentNode、字段控件及验证规则，
并查看同类现有 `panel.yaml`。Auto Panel 的白名单和编辑范围可能比静态
声明式面板小，不能把静态组件一股脑加入自动生成目录。

按需查询可用 `scripts/inspect-panel-component.mjs <repo> <component>`：从实际
目录返回能力边界，扫描已通过真实 Panel 结构校验的 panel.yaml 用例及节点位置。
再用同命令附加 `--type ComponentNode`、`--type PanelSection` 或
`--type EditorField` 读取源码原文契约，不复制维护一份参数表。该查询需要目标仓库
安装 TypeScript 开发依赖，不要求 Core build；它只读，不安装依赖、不执行 Bundle 代码。
没有用例会明确返回空列表；非法面板列在 invalidExamples，不能静默当成合法参考。
需要交互说明与文档示例时附加 `--docs`：按实际 `docs/dsl-spec.md` 的标题按需
读取，并返回文件行号和同一 Panel UIUX 规范。新组件没有 Kit 用例时仍可读取已有参考，不伪造实际
Kit 用例；`shared-library-reference-only` 明确表示只有公共参考，没有该组件专节。
文档示例不是新 Bundle 的事实或已通过渲染/保存验收的证明。
共享类型中的可选字段不代表每个组件都支持它；仍须走 parsePanelManifest 与实际
Kit loader 检查条件约束。结构校验不等于 schema、交互或保存已经验收。

大类型可按字段逐级查询，例如 `--type ComponentNode.navigation_map.edges`，
只返回该配置的源码及本地引用类型的下一步查询入口。配置字段名来自实际契约，
不由组件名猜测；存在于共享类型不代表目标组件支持，仍须检查运行时条件校验。

从用户要完成的交互选择组合：

在 owning 工作区（或纯表单组合根节点）声明独立可选 `guidance`，用现有 locale
资源提供简短操作引导，不从 Skill 能力简介或空状态 `description` 复制。每个面板
只声明一处；共享关闭控件只影响当前呈现，不代替方法、校验或错误信息。
真实可编辑名称用原字段绑定的共享标题与铅笔，不加第二个名称输入或 `*`；
保留 required aria 与完成校验，不给只读、派生标题或无写回调的界面伪造编辑入口。

有 owning 侧栏标题的 workspace 显式声明有限 `sidebar_icon`（例如角色用
`users`），先查询 `ComponentNode.sidebar_icon` / `SidebarIcon` 和 catalog
的 `sidebarTitle` 能力。只用有限图标名，不传 URL、SVG、import 或表达式；
只装饰标题，不替代文字、不映射记录、不增加保存通道。不能根据 Bundle 名
猜图标，无侧栏页面不要为图标新增导航。生成式 A2UI 不接受此 authored-only
字段。检查标题真实渲染、可访问名称、原操作和窄容器，源码测试不等于宿主验收。

- 先选 UI 形态，再绑定领域信息。记录/章节列表和真实层级共用结构导航；
  `record_workspace.navigation_layout: list` 是无层级结构导航，不是轮次卡片。
  标题 + 次要上下文的卡片导航由问答工作区复用。状态是可选只读投影，不能造事实。
  不为各 Bundle 重新定字号、行高、选中态或状态图标位置。
  单一主集合直接呈现真实记录，不再套同名分类根节点；有无画布遵循同一规则。
  多类真实对象保留必要分组；从属记录沿已有引用与上下文新增组织，不为了树形外观
  新造父对象或改写数据归属。自查同时覆盖父子选择、新增归属和重复导航。
  归属未填或失效的从属记录须有可打开修正的提示入口，不得静默隐藏或自动重归属。
- 嵌套表单复用完整字段组与重复集合：组间16px、组内8px，添加位于所属集合尾部，
  折叠只改变可见性。不靠空白节点、分割线或 CSS 补偿共享组件的排版缺陷；
  发现缺陷应修共享实现并横向验证至少一个同形态的其他面板。
  内联折叠的标题文字对齐正文左边界，箭头紧跟标题、间隔8px，不继承普通按钮
  的水平内边距；展开不额外缩进，首组仍间隔16px。不要用字段声明补空格。
  这不是结构树规则：树的前置层级箭头与缩进保持不变。
- 简短同级单选显式使用 `choice_layout: row_wrap`，横向排列并随内容区宽度自然
  换行，复用共享行间8px/列间20px；不拉伸选项、不缩字、不增加横向滚动。
  长说明或需逐项比较的选项可用纵向，保留已确认场景例外。不改变选择值、显隐
  或校验；检查双语及窄宽度。该规范不改变旧声明省略布局时的运行时行为。
- 字段组默认不需要额外标题；字段自己的标签已经命名输入。避免
  “实现方式／底座选择”这类近义双标题，多字段组名必须提供额外语义范围。
  删除冗余 `group.title` 时保留全部字段、条件及专业说明，不隐藏首字段来补偿。
  共享解释器只自动去重单字段、可见caption、无sidecar且精确同名的组标题；
  不同语义范围不能自动吞掉，hidden caption的唯一组标题仍要保留。
  字段辅助说明按组内8px且无段后间距，下一组16px只由父级负责。
  检查双语、必填/可访问名、只读及嵌套区域，不只检查YAML是否可解析。
- 必填提示对照 schema、validation 的适用阶段与方法语义，不把星号变成新保存门槛。
- 配置驱动的二级表单遵循共享条件表单规范：先主选择、后就近的适用字段，
  复用16px/8px节奏，不为分支新增重复标题或容器。`visible_when` 控制显隐，
  authored `label_when` 可按同记录字段切换标签（有序首匹配，回退原 `label`）；
  嵌套 `item_fields` 同样适用，标签和可访问名一同本地化，不改字段绑定。
  默认隐藏保留内容、切回恢复，不移动焦点、不自动提交；必填提示和实际
  schema/validation 的条件与阶段必须相符，不能以隐藏跳过领域约束。
  检查各分支、切回、保存重开、双语及只读。此 authored 扩展不自动进入生成式白名单。
- 必填显示使用实际字段声明：
  同一字段在不同 section 要求不同时，作者声明使用互斥的 `required_in` 与
  `required`；前者只能列出本字段的 `applies_to`。隐藏标签、组合控件、条件字段
  和新增嵌套条目复用共享提示及可访问命名。所有备注保持可选，不能以统一视觉
  为由收紧草稿或完成规则；实际保存与发布沿已有入口验证。

- 问答工作区用 `question_workspace`；极小清单才用 `question_list`。
- 导航与内容需要共同占满面板时用 `panel_workspace` 的 sidebar/main。
- 记录选择、详情和关系图需要联动时用 `record_workspace`，内部配置
  `record_inspector` / `relation_graph`；图的节点和边字段必须显式绑定。
  多类独立资源已有引用字段时，可用 authored `reference_graph` 只读投影：
  节点绑定 workspace 内的 section，连线绑定 `record_select` / `record_multi_select`
  和目标 section。不新增第二套关系数据；详情回到原记录，引用缺失明确提示。
  配套 state `member_of_map` / `members_of_map` 规则复用现有保存校验。
  可选 `navigation_group_by` 以每个 primary section 的 bound record 中直接
  string/字符串 enum 分类字段分组导航（含 `fields_path`）。它只是共享树视图，
  不造父记录、不隐式继承、不将 reference/跨文件目标当分类标签。新增保持原
  section 默认值；分组展开/选择不写 canonical。`navigation_layout: list`
  保持组内平铺，默认 tree 保留同组父子关系及 contextual 子项；跨组父引用
  原样保留，子项在其所属组根显示。详见 DSL 的 navigation groups 契约。
- 记录之间的有向导航、产物预览与可编辑分组画布使用 `navigation_workspace`。
  `navigation_map` 分别绑定 nodes/edges/frames 的集合、身份相关字段、标题与坐标；
  分组只是布局，不隐含业务关系。只有声明 `nodes.artifact` 才开启产物预览。
  `grouping` 可从辅助导航记录派生初始分组；未保存与显式空 frames 含义不同，
  不要为初始化面板主动补写空集合。需要限制新建连线时显式声明
  `connection_policy.allow_self` / `allow_parallel`，省略默认允许；重复按有向端点
  而非视觉端口判断。此策略不清理既有事实，也不是通用图约束语言。
  选择该组件后查实际 `ComponentNode.navigation_map` 与目标运行时校验规则；
  仓库细节见 `docs/dsl-spec.md` 的导航组件契约，示例见 Page 的面板声明。
  不因示例属于 Web App 而向其他 Kit 复制它的业务字段或连线限制。
- 文件预览使用可用的 artifact 组件及已有读写通道，不伪造 URL 或副本事实。
- 分组卡片/脑图用 `record_board`：显式绑定 label/description/group/badge，
  rejection 可选；`detail_sections` 指向同一记录的嵌套 fields_path，不能引入另一个事实副本。
- 只读单篇 HTML 用 `document_workspace`：声明唯一受限 allowed_files、标题字段，
  可从 H2 的 data 属性读章节来源及关联记录。业务图例和来源名属于 Bundle。
- 多轮/父子报告阅读用 `artifact_workspace`：显式声明父子集合、排序、标题、
  产物引用和 execution artifact_kind/scoped_ids；不把运行状态写进 canonical。
  Markdown 与静态 HTML 按需读取，执行记录通过宿主共享接口读取；这不是通用任意脚本宿主。
- 自由绘制用 `canvas_workspace`：显式声明直接记录集合、排序、标题/ID/文件字段，
  `canvas.format: excalidraw`、场景与图片的 Bundle 相对目录。参考 `whiteboard/panel.yaml`。
  原生场景保留元素与绑定；索引仅保存记录，图片字节独立原子保存。导航、改名、
  排序和删除不改稳定文件身份，不删除历史文件。场景格式仍由 Bundle 自己校验，
  组件只检查原生表示与读写边界；不能把它当任意 HTML/iframe 嵌入容器。
- 参数化 HTML 预览用 `preview_workspace`。`live_preview.file_path` 指向本 Bundle
  的已保存 HTML，`stylesheet` 是可选的本 Bundle CSS 文件；不在声明里写 HTML/JS。
  `tokens` 显式映射 canonical 文本路径到 CSS 自定义属性，可带 fallback、枚举映射、
  字体后备。`presets[].values` 只含 schema 合法的 path → scalar 数据，不能运行表达式。
  `restore_paths` 指定可恢复的初始参数，不包含产物引用或无关业务字段。
  子节点用 `schema_field` 编辑标量；颜色用 `color`，保留自定义原值。
  预览是 opaque iframe，仅接收单向 CSS 变量更新，无宿主写入能力。只有 HTML 实际
  使用的变量会实时生效；结构调整应明确提示保存并重新生成，不伪报已更新产物。

这些是已有组件的选择示例，不是对所有 Bundle 的固定布局要求。

### 问答工作区的可选策略

`question_workspace` / `question_rounds` 可声明 `question_policy`：

- `first_round_ids`：将指定记录放进最早轮次；不改变 canonical round。
- `protected_ids`：这些记录不显示跳过/恢复操作，与轮次归属独立。
- `history_readonly`：非最新轮次只读；默认不启用。
- `numbered_rounds`：显示连续的第 1、2…轮，而不是原始 round 数字。
- `allow_rejection`：启用跳过/恢复，必须声明所属 section 的 `rejected` 字段。

记录 ID 和业务文案由 Bundle 声明，运行时不识别 `const_` 前缀或 Web App
名称。参考 `smart_questions/panel.yaml`，不要把它的固定记录复制到别的 Kit。
轮次介绍应与逐题 `prompt` 分开。静态工作区可用 `rounds_source` 指向另一个
已声明 section（可有 `records_path`，不使用 `fields_path`），其 schema 是
map<object{title:string, description:string}>，并声明同名文本 fields。
map key 对应实际保存的数字轮号，不是从1开始的显示序号；轮次仍由真实问题
推导，孤立介绍不创建轮次或改变历史。未提供介绍的旧文件显示通用轮次标签，
浏览不补写或迁移内容。标题采用短语，详细背景放在 description；控件允许
标题自动换行，不能为短标题指导截断用户内容。生成式 Auto Panel 不支持这个
静态扩展，不得猜写或因此获得新增编辑权限。
附件仍通过通用 Bundle 相对文件路径和原子保存通道处理，不在 panel.yaml 写入
文件字节；保存回显收起已答卡片，局部输入不应触发收起。

## 修订已有面板

### 文案与多语言

界面文案由 Bundle 自己的 `locales/zh-CN.json`、`locales/en-US.json` 维护。
`panel.yaml` 声明 `i18n.default_locale` 和 `i18n.locales`，展示标签用 `$t:key`
引用；默认语言必须覆盖所有引用，其他语言缺失的键回退到默认语言。
共享组件的操作文案归 Panel 的公共 locales，不要每个 Bundle 再复制一份。
参考 `business_rules/panel.yaml` 与相邻 locales；实际 loader 会把语言资源
编入共享面板载荷，因此 DSH 与 Companion 走同一解析和渲染路径。

翻译只适用于标题、标签、说明、占位符。不要翻译字段 key、ID、枚举 value、
路径、引用，也不要把 `$t:` 填进 `initial_values` / `create.defaults`。
用户写入的设计文本不是 UI 翻译资源，切换语言不得改写它。
增加语言要校验占位符一致、缺键回退以及只改 locale 文件后重新加载生效。

### 有序记录与从属编辑

`sections[].create.id_field` 指明新增记录的 canonical ID 字段；`defaults`
只放 schema 接受的标量或字符串列表。`initial_values` 仅在首次编辑时补齐
缺少的顶层标量，不在浏览时写文件、不覆盖已有值。

`record_inspector` 可包含 `record_related_editor`，后者以 `source` 和
`bindings.reference` 绑定一个声明过的单父记录引用。它只过滤视图，不改变
canonical 的扁平集合；新增自动关联当前父记录，其他父记录的数据保持不动。
只有真正的所有权关系才声明 `sections[].delete_children`（section 与
reference_field）；普通关联绝不自动级联删除。当前契约仅支持单层清理，
不支持推断多层或循环所有权。需要更多层时先扩展并验证通用能力。

图关系声明单父继承时使用 `graph.hierarchy.max_parents: 1`（只能包含一个
继承 kind），并在 Bundle 校验中同时声明单父、端点存在与无循环约束。
共享表单的父来源选择更新同一条边，画布不能另存一套 parent_ref。
相关编辑器可显式 `inherit_from_graph: true`：祖先关联记录按来源只读展示，
自有记录仍在原扁平集合内编辑，不能复制父记录或推断覆盖/拒绝优先级。
来源条件、确认要求必须保留；冲突由领域方法解释并请用户确认。
新增子节点复用 `hierarchy.create`，保存仍走原有校验/原子通道。

端点删除时需要移除连线，使用独立的 `sections[].delete_relations`：声明
连线 `section` 和指向当前集合的 `reference_fields`。这只删除匹配的连线记录，
不删除另一端对象、不递归。不可与同集合的从属所有权重叠，也不可指向相同存储路径。

自由字符串列表用 `token_list`；可选 `options` 提供建议而不改变存储值，
`token_layout: cards` 可显示选项说明。预设单选加自定义字符串可用
`radio_custom`，只绑定 string，不绑定封闭 enum。标准 enum 仍用 select/radio。

嵌套键值记录可用 `record_map`。`id_field`、`order_field` 都是可选的：
简单列表用 `columns`；需要条件显示、选择、字符串列表等编辑时改用互斥的
`item_fields`（与顶层字段使用相同控件/可见性规则，但不声明 `applies_to`）。
`item_defaults` 只写 schema 接受的初始值，不为未知枚举补空字符串；
`item_label_field` 引用子记录的 text 字段。子记录 ID 不可编辑，重排只更新
所属 map 的兄弟 order，局部编辑保留其他字段。此版本的 `item_fields` 是有限的
叶子表单，不支持递归嵌套 record_map 或跨记录写入，不能猜测此类能力。
原 schema 仅以 map key 标识记录时不要发明 id/order 字段。`source_reference_map`
用于只读的版本固定引用，用户展开后才读取来源；引用不是用户确认，也不自动更新设计。
`derived_fields` 只用于声明过的确定性文本摘要，不运行表达式或领域脚本；
相关字段修改时更新，其他编辑保持原有摘要。隐藏字段的清理也须显式声明，
不能因为控件不可见就删除保存的数据。
`clear_when_hidden: true` 仅在依赖字段被编辑且条件不成立时清空文本；
`clear_when_hidden: omit` 用于移除 schema 可选标量，例如不适用的数量枚举。
页面载入、语言切换、无关字段编辑不得触发这种清理，required 字段不可使用 omit。

先列出原面板的实际操作：导航、选择、增删改、排序、附件、引用、文件编辑、
保存继续与重开。逐项映射到新声明；不能只把 schema 字段变成一排输入框。
数据仍保存在原 canonical 路径，保留未编辑字段；不要为适配新 UI 批量改写
用户文件。显示标签与领域绑定归 Bundle，运行时不能按 Bundle 名选择特例。

长记录可使用静态 `form.body` 的 `kind: tabs`（id/title/tabs，每页 id/title/items），
页内复用 field/row/group，禁止递归 tabs；字段不能跨页重复。低频字段组可声明
`collapsible: true` 并提供明确标题。共享页签与折叠只改变显示，保留完整编辑内容；
默认页先回答用户最重要的产品问题，不以技术配置开场。这些静态 form 扩展不
自动进入生成式 A2UI 白名单。实际作者仍须核对当前 DSL 与渲染回归。

已有组件不足时，说明缺少什么交互。若任务也授权扩展组件库，需在同一改动中
完成真实目录、结构/绑定校验、`PANEL_COMPONENT_RENDERERS` 渲染实现、共享样式、
正反例和浏览器操作检查。仅注册名称不构成交付；未注册组件必须明确报错，
不能用占位图冒充画布。Bundle 不能通过声明授予自己新的写权限。

## 可执行验收

### 绑定与内容更新的交付检查

- `ui` 的 `source` / `sources` 对应已声明的 section；section 的 `records_path`
  （省略时取 section id）、`fields_path` 和 `order` 对应 schema 的实际集合、
  记录内对象与顺序字段。字段 `key` / `applies_to`、组件特定路径和摘要绑定
  指向同一 canonical 记录；不因展示文案相同就猜它们是同一字段。
- `i18n.locales` 的文件路径相对本 Bundle，文件须随 Kit 交付；默认语言覆盖
  实际 `$t:key` 引用，其他语言按已有规则回退。locale、schema 和 panel 的修改
  一起交给目标版本的实际 Kit loader 校验，不只单独检查 YAML 是否能解析。
- 先确认作者编辑的内容根与宿主实际加载的 Kit 来源。通过宿主已有的加载、
  更新或重新打开入口取得新内容；已安装包需交付更新后的包，项目固定 Kit
  版本时需走其支持的版本更新流程。不要发明通用热重载命令，也不要声称任意
  文件保存会立即刷新正在运行的面板。内容重载后确认实际加载版本和编辑结果，
  再按既有校验/发布通道交付。只有新增共享运行时能力才需要相应构建发布。

用真实 loader 加载同一非空 fixture，验证字段/来源/路径绑定，并尝试非法绑定。
在实际面板操作一个值、保存、重开，确认 canonical 与文件引用正确且无关内容
未被覆盖。导航、附件或画布改动应实际点击/拖拽，另检查窄容器与滚动。

内容维护还要验证：只更改 `panel.yaml` 后重载生效，不依赖重编译宿主或 Core。
新增运行时组件则正常构建发布；不能把它描述为内容热更新。
静态、隔离浏览器、真实宿主与模型生成测试的证据分别记录。
# 可编辑文件型图形

`diagram_workspace` 绑定一个记录 section 的 `artifact_ref` 字段；当前支持
`diagram.format: bpmn`，并显式声明 `file_field`、`label_field`、`artifact_kind`。
`order_only: true` 表示只显示 section.order 中的记录（仅在 Bundle 自身如此规定时使用）。
`summary_fields` 引用同一 section 中已声明字段。元数据详情与图形分别呈现；
不要把 XML 写入 Design JSON，也不要从未确认的未来路径开启编辑。
图形编辑通过运行时的保存屏障序列化后，与 canonical 引用原子保存。
需测试编辑器仍聚焦时保存、切换与重开、失败不伪报成功、只读以及引用被删除/替换。

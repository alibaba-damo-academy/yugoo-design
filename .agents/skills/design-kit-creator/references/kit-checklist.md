# Kit 设计和接入检查

从目标 checkout 或发行版本读取本清单及下层 Creator 参考，并核对实际路径。全局 Skill 的符号链接可能指向另一版本的工作树；不要把旧检查清单或旧目录约束当成当前契约，也不要因此改动全局安装。独立内容包的加载和样例校验可复用[公开 API 样例](../../../../docs/wiki/extending.md#校验独立内容包)。

## 调研转化表

迁移项目时记录“原能力/用户面对的视图 → 新 Bundle 的事实所有权 → panel/产物 → 生成方式与实际可用依赖 → 保留/未接通边界”。同一信息可有表格和图，不必为每个视图新建 Bundle；不同可独立维护的事实也不能因共用一个编辑器而合成一个巨型 Bundle。

对照 `packages/skills-web-app/kits/web_app/mindset.md` 的交互策略，以及 `examples/community-workshop-delivery/mindset.md` 的非软件领域事实与执行边界；不要把示例的 Bundle 列表当成通用 Kit 模板。Kit 通过精确挂载引用独立 Bundle；迁移时仍以目标 loader 和当前内容契约为准，教学示例不替代完整挂载检查。

## mindset 的必要信息

编写或重组正文时使用 [Mindset 写作规范](mindset-authoring.md)。下面检查装载与职责覆盖；不要求逐个重述自动挂载的技能入口，也不规定所有 Kit 的章节或咨询流程。

- frontmatter name/version/description 与目录装载契约一致。
- 可选双语展示简介使用 mindset.md frontmatter 的 `display_description: {zh, en}`，两种语言都非空；保留原 description 和完整方法正文。Studio 卡片与文件说明栏共享 loader 投影，不另设页面私有简介或逐文件用途描述。英文文案按 docs/panel-uiux-standard.md 的角色规则编写。
- `<design_skills>` 精确公开名称及有意义的选择描述；检查当前 `packages/core/src/kit-loader.ts`、`kit-discovery.ts` 的发现规则，不手工修改 Host 白名单。
- 领域专家的职责与协作风格、设计目标、事实边界、最小有价值闭环和已有内容的修改策略；咨询式不是唯一形式。
- 提问仅解决实际用户决策缺口；知识可查证，安全可逆的假设可以明示。示例不是用户事实。
- 跨 Bundle 的输入依赖是证据需求，不是固定串行阶段；缺失输入要说明当前任务的影响，不阻止无关工作。
- 保存后沿真实引用核查参数对既有 artifacts 的影响；不得重复应用 diff 或自动重跑整个 Kit。
- 可选外部环境、真实执行与专业推断的边界；GRA/KAG 与场景呈现复用系统服务。

## 文件组织

新内容按当前独立目录结构组织：`kits/<kit>/mindset.md` 与 `kit.yaml` 保存 Kit 方法和精确挂载，`bundles/<bundle>/` 保存独立 Bundle 的方法、声明和资源。参照 `packages/skills-web-app/package.json` 的 `designSystem.kit` 入口；`root`、`mindset`、`manifest`、`bundles` 与分发 `files` 列表必须指向实际内容。

这四个入口路径均相对于包根目录，不相对于 Kit 的 `root`。Kit 身份来自 Mindset frontmatter；独立 Bundle 的 `identity` 用于目录和挂载项 `name`，运行时 `name` 与挂载 `bindingKey`、SKILL frontmatter 及 canonical 路径对应，不能仅改目录名后批量替换运行时字段。

`kit.yaml` 是精确 Bundle 挂载的权威，Mindset 的 `<design_skills>` 是其模型侧投影，二者须保持一致。加载包根目录时使用通用包 resolver；只提供 Kit 目录时还须配置能解析精确引用的 Bundle resolver。纯本地内容目录另验证目标宿主的 discovery，不要求每个 Kit 发布 npm 包。

既有 `mindset.md + skills/<bundle>/` 内容只按支持该布局的 loader 使用。保留方法、资源和版本引用；不要把旧兼容示例或旧脚手架作为新结构的默认模板。当前契约见 `docs/bundle-contract.md` 和 `docs/wiki/extending.md`。

## 综合验收

- catalog 每项可载入，无重复名和幽灵 Bundle，所有实际输出都能找到唯一 owning Bundle。
- 连贯 fixture 覆盖需协作的信息切片；同一事实没有互相矛盾的重复存储，引用 key 而不是显示标题。
- 新建/改参数/读既有结果路径均可解释；未知、未运行、真实运行不混淆。
- 面板、图表、摘要、场景说明使用同一源事实；场景体验不是额外事实 Bundle。
- 检查是否依赖开发仓库绝对路径、其他 Bundle 私有脚本或未安装引擎。实际安装/宿主验收与静态包验收分别报告。

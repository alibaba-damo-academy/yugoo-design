# 开发指南

面向修改语构设计系统（Yugoo Design）源码、领域内容或文档的贡献者。先阅读 [AGENTS.md](../../AGENTS.md) 与 [CONTRIBUTING.md](../../CONTRIBUTING.md)，再选择工作位置和验证范围。只想定制设计套件（Kit）或设计技能包（Bundle），可以从[扩展开发](extending.md)开始，无需先修改共享运行时。

## 准备工作区

源码声明 Node.js `^22.19.0` 或 `>=24.0.0`、pnpm `11.7.0`。使用所选快照的 `package.json` 和锁文件；源码 checkout 与贡献提交需要 Git；正常设计项目的版本记录由随包运行库处理，无需另装 Git。Panel 的 UI 兼容边界是 React 18。

在独立 checkout 中，从包含 `pnpm-workspace.yaml` 的仓库根目录准备依赖：

```sh
node --version
pnpm --version
git status --short
```

如果所选 checkout 带有与依赖配置匹配的 `pnpm-lock.yaml`，使用：

```sh
pnpm install --frozen-lockfile
```

不要为通过安装而删除锁文件、关闭校验或更换依赖版本。公开源码、内部开发 checkout 和已安装 npm 产品是不同输入：公开快照使用经过整理的依赖配置，不需要取得内部宿主子模块；宿主集成仍须使用兼容的正式宿主。

现有公开导出排除内部开发锁文件，公开锁文件及干净依赖准备需随所选发行源码单独验收。没有配套锁文件时，不将上面的 frozen 安装命令当作可用的公开教程，也不要复制内部锁文件替代它。公开源码的干净安装与构建有独立发行验收，上述准备步骤不代表任意快照已通过整仓构建。失败时保留实际错误、Node/pnpm 版本与所选提交。

## 选择源码分层

| 路径 | 职责与入口 |
| --- | --- |
| `packages/core` | 项目、校验、执行、内容版本和发布语义；先读[架构基线](../system-design-baseline.md) |
| `packages/panel` | 共享 UI、声明式解释器和组件；先读 [Panel UIUX](../panel-uiux-standard.md) 与 [DSL](../dsl-spec.md) |
| `packages/skills-*` | 领域方法、schema、示例和声明；先读 [Bundle contract](../bundle-contract.md) |
| `packages/provider-*` | 明确信任的 native/可执行贡献，不能由导入内容自动获得 |
| `packages/companion`、`packages/dsh` | 宿主适配；入口见 [Companion](../../packages/companion/README.md) 与 [DSH](../../packages/dsh/README.md) |
| `packages/studio`、`packages/studio-ui` | [作者领域](../../packages/studio/README.md)和[共享 UI](../../packages/studio-ui/README.md) |
| `packages/studio-dsh` | Studio 的 DSH 接入 |

不要在共享层写死某个 Bundle 名称来修复领域问题。图、表单和 Agent 应围绕同一份设计数据工作，继续使用已有保存、校验、发布与宿主适配机制。

## 从最小相关检查开始

先查所选快照的根 `package.json` 与所属包脚本，区分消费构建产物的测试和直接读取源码的检查。普通源码修改应先构建被测试者依赖的包；源码别名测试不证明发布后的 `lib` 可以使用。

当前公开源码保留四个根脚本：`build`、`typecheck`、`test:public-documents` 和 `test:public-contracts`。内部开发仓还包含其他快捷脚本，不能假定它们也存在于公开 checkout。按修改选择根脚本或所属包已有的检查，不需要为小改动运行整仓构建。

| 修改内容 | 现有检查入口 | 证明的边界 |
| --- | --- | --- |
| README、Wiki、公共文档同步 | `pnpm run test:public-documents` | 文档选择、链接校验和导出保护的回归；提交前还需检查所改正文的实际链接 |
| Web App 方法脚本与产物 | `pnpm --filter dsh-design-skills-web-app test` | 内容包自己的脚本及产物回归 |
| 决策与运筹建模（Decision Modeling，内部验证） | 仅内部源码环境使用，不属于公开源码验证入口 | 内部保留套件装载、内容契约、示例及方法回归；不随默认产品或公开源码交付，不代表原生 Agent 的完整咨询过程 |
| Studio Kit 草稿 | `pnpm --filter dsh-design-studio test:kit-drafts` | 使用该包明确配置的源码别名，检查草稿服务 |
| 某个包的类型或构建 | `pnpm --filter <package-name> typecheck` 或 `pnpm --filter <package-name> build` | 仅用于该包确实声明的脚本；先按依赖关系准备前置构建 |
| 公开导出与发行合同 | `pnpm run test:public-contracts` | 现有发行回归；其中的合成 fixture 不证明真实安装或模型执行 |

这些命令是已有回归入口，不自动覆盖新 Bundle 的所有专业判断或交互。Kit/Bundle 修改还需核对实际装载、schema 校验与样例；声明式面板修改需核对 DSL 属性、绑定及实际呈现。按所属包的检查和[扩展开发](extending.md)完成相应验证，不把方法脚本通过当作这些边界都已覆盖。

宿主 UI、模型运行、保存重开和干净安装分别验收。只修改文字时，检查正文、链接、锚点和中英文对应关系即可；修改交互时，在实际界面验证受影响操作。提交时记录实际运行的命令和未测项，不必把整张表全部执行。

## 修改领域内容和交互

按[扩展开发](extending.md)同步维护专业方法、输出契约、schema、validation、Panel 和样例。保留稳定 ID、用户字段、源引用及精确内容版本。方法和结果契约的创作要求分别见 [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md)、[Bundle Creator](../../.agents/skills/design-bundle-creator/SKILL.md) 和 [Skill Creator](../../.agents/skills/design-skill-creator/SKILL.md)。

Panel 的信息表达先服务于用户要作出的判断，再选组件；按 [Panel authoring](../../.agents/skills/design-bundle-creator/references/panel-authoring.md)查实际支持的属性和绑定。复用声明式组件的内容修改不要求重编译整个宿主；新增共享组件或受信任 Provider 则需要相应运行时构建与发行。

Companion 提供的 MCP `design_list_panel_components` 可在创作前查询目录，无需项目连接或模型调用：

```json
{}
```

也可查询准确名称及同包参考：

```json
{ "name": "record_form", "reference": "contract" }
```

先在实际安装版的工具清单确认该工具存在。目录描述用途及数据绑定，不等于完整属性 schema；返回的契约、文档和实例仍按目标版本核对。详情见[组件发现入口](../../packages/companion/README.md#discover-panel-components-before-authoring)。

## 隔离 UI 与宿主验证

使用合成材料、新设计项目和独立端口，不打开真实用户项目来验证功能。DSH 测试需同时隔离宿主 profile 与插件存储：仅设置 `DSH_HOME` 不够，还要把 Core 的 `projectsRoot`、`stateRoot` 指向测试目录；Electron 的 userData 也按宿主方式隔离。打开项目前确认测试项目列表为空。

原生宿主拥有模型与凭据，不创建第二套模型 Client 来模拟接入。环境、端口、进程和产物应有明确归属；只停止自己的进程，保留失败证据，不改真实用户认证或安装配置。开发热更新的入口见 [Companion HMR](../../packages/companion/README.md#hot-development-ui-hmr)，它不代表已安装包已更新。

## 提交可核验的贡献

说明用户遇到什么问题、改动归哪个契约、最终行为是什么。附所选源码提交或候选版本、实际命令和结果；交互变化记录相关的编辑、保存、重开及原生消费，未测项明确说明。行为缺陷保留能检出原问题的回归，不为纯文字改动添加重复测试。

Kit 作者与独立接收者的交付检查见[分享指南](kit-sharing.md)。普通错误和建议走[反馈入口](support.md)，敏感问题按[安全报告](../../SECURITY.md)处理。凭据、私密项目、会话日志及内部 URL 不进入提交或截图。

## 文档与公开同步

中文文档遵循[命名与术语翻译](terminology.md)，首次介绍核心术语使用中文（英文）。中文 [README](../../README.md) 与 [English README](../../README.en.md)保持相同章节、能力和状态。

开发仓正式 README、公共 Wiki、贡献与安全说明是维护源。公开源码从固定提交按[公共文档同步规范](../public-document-sync.md)导出，不作为第二开发源。源码提交、公开同步、npm 打包与发布分别记录；贡献或检查通过不自动授权发布。

# 客户项目交付协作平台：可继续修改的设计示例

这是语构设计系统（Yugoo Design）的合成设计项目。六人项目交付团队希望把客户反馈、原定交付范围和交期影响联系起来，让设计师处理日常修改，由项目负责人决定新增范围和交付承诺。

你可以阅读现有设计，也可以把项目复制到自己的目录，打开面板修改一项判断，再让 AI 沿着修改继续推敲。

## 先复制到自己的工作目录

请保留仓库中的示例原件，在仓库外继续设计。例如，在仓库根目录执行：

```bash
mkdir -p "$HOME/Documents/YugooExamples"
cp -R examples/design-team-delivery "$HOME/Documents/YugooExamples/design-team-delivery"
```

Windows 中也可用文件资源管理器复制整个 `examples/design-team-delivery` 文件夹。目标请选择尚未使用的新目录，避免覆盖自己的修改。

## 在 Yugoo Design 中继续

本示例的流程图使用布局修订 13，需要包含该布局更新的 Web App Kit。如果迁移校验提示只支持 `layoutRevision=9, 10, 11 or 12`，请先更新到支持修订 13 的插件版本；开发者也可按[开发指南](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/development.md)使用当前源码。不要手动修改 BPMN 的版本标记来跳过校验。

先按[安装指南](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/getting-started.md)启用插件和 Web App Kit，再把副本的绝对路径交给宿主。DSH 可以使用：

```text
/yugoo migrate /absolute/path/to/your/design-team-delivery
```

迁移保留这份副本，在新设计项目中读取并适配设计文件。Companion 迁移使用当前已选项目的 Kit；如果还没有选定项目和 Kit，先创建一个准备项目并选择 Web App Kit，再迁移示例。可以直接告诉 Agent：

```text
请使用 Yugoo Design，将这个示例迁移为我自己的设计项目：
/absolute/path/to/your/design-team-delivery
先确认当前已选项目使用 Web App Kit；若尚未选择，先创建准备项目并选择该 Kit。
保留示例原件，使用当前可用的 Web App Kit。
打开业务流程面板，说明设计师和项目负责人分别作什么判断。
```

这份示例不含 `.git`，首次使用请走迁移入口，不能直接用 `open` 打开这个副本。迁移完成后，使用[项目命令](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/commands.md)的 `open` 打开新项目，后续修改保存在新项目中。缺少对应 Kit 时先按安装指南获取，不要手改 `project.json` 的版本来消除提示。

迁移会适配 Kit 支持的设计文件，不复制原项目的 Git 历史、历史评估或运行记录。示例保留的记录与场景体验供阅读；需要在新项目中使用场景体验、清晰度评估或关联图谱时，请让 Agent 基于迁移后的设计重新生成或评估。

打开后可以从一个具体问题继续：

```text
现有规则已经区分了不影响交期的小改，以及需要负责人确认的修改。
请对照问题回答、流程和规则，说明这项判断怎样落在三页原型中。
如果负责人退回补充，设计师怎样完善判断并重新提交？
先指出现有设计缺少什么，再和我讨论补全方式。
```

在面板中修改并保存，再请 AI 基于新内容继续。完整练习见[客户项目交付教程](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/web-app-demo.md)，日常操作见[使用指南](https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/usage.md)。

## 这个目录保存什么

- `project.json`：示例的项目身份与 Kit 版本。
- `design_files/`：问题与回答、调研发现及结论、业务对象、规则、流程、视觉风格、页面地图、原型及整合 PRD；BPMN、Markdown 和 HTML 等产物一起保留。
- `design_records/`：项目已有的设计与建议记录，供理解此前发生的操作。
- `.gitignore`：项目自己的忽略规则。

目录保留了项目资料，按示例交付要求不包含原 `.git`。历史记录中的提交标识不能用于还原未提供的 Git 历史；继续工作时，由新项目或副本建立自己的版本记录。宿主安装、会话存储和模型凭据在项目目录之外，不随示例提供。

## 阅读和修改时

业务情境与数据均为合成，已有内容包含人工准备和原生 Agent 生成的成果。示例包含流程、规则、视觉风格、三页原型、场景体验和带来源的调研。PRD 汇集这些设计，包含纵向流程图、三页原型及风格预览；其中的验收草案仍需团队确认，不是测试结果。调研中的机制是参考选项，不会自动成为本项目的需求。退回补充后的重新提交界面仍未定义；风格约定中的侧边栏与现有页面布局也需要对齐。调研材料包含产品文档、提供商观点和社区讨论，不能一概当作官方结论。可以从这些具体问题继续推敲。按当前任务判断哪些内容值得沿用，遇到未知项或矛盾可继续讨论；保存过的方案仍可修改。

页面和场景体验用于理解设计，业务服务需要后续实现。PRD 从独立设计文件整合；需要改变事实时，先修订相应面板，再更新整合文档。

示例随附 [Apache-2.0 许可](LICENSE)和[署名说明](NOTICE)。样式配置和 HTML 中使用的 Lucide/Feather 图标保留其 [ISC/MIT 许可](licenses/lucide/LICENSE)，不因项目许可而改变；复制或再分发示例时，请一起保留这些文件。

## 给读取示例的 Agent

没有安装插件时也可以阅读这些设计文件，服务于用户当前的分析或讨论任务。

- 从 `project.json` 确认项目身份和 Kit，再读取相关设计文件，保留来源路径、记录标识与可获得的版本依据。
- 区分已确认决定、候选方案和未知项；生成或保存过的内容不自动成为用户确认的需求。发现矛盾时说明依据，再与用户澄清。
- 按当前任务使用示例，不因读到目录就执行全部设计或开始开发。通过对应 Bundle 的校验和发布流程修订设计事实；本说明不授予额外权限。

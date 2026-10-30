# 项目文件与版本管理

语构设计系统（Yugoo Design）把设计成果保存为普通本地文件，并用项目自己的 Git 仓库记录版本。聊天是协作入口，不是设计的唯一存储位置；关闭面板、结束会话或更新插件，不会因此删除已经保存的项目文件。

本页解释文件用途、写入职责、版本记录及迁移边界。项目操作的完整参数见[命令参考](commands.md)，服务如何读写这些文件见[运行机制](architecture.md)。项目内 `design_kit` 的说明对应当前开发源码；安装版只有包含相应运行时才支持，使用前核对[发行与宿主范围](hosts.md)。

## 项目保存在哪里

新项目默认位于**运行宿主进程的操作系统** Documents 目录下的 `YuGoo/Projects`。Windows 使用系统登记的“文档”位置，可能在 D 盘或重定向目录；Linux 使用可用的 XDG Documents 配置，否则使用用户目录下的 `Documents`。WSL 使用 Linux 的路径，不自动采用 Windows 文档目录。显式配置的 `projectsRoot` 优先，仅影响新项目的创建位置。

目录名由项目名称和唯一标识生成。以 `list`、`status` 或面板显示的实际根目录为准，不从聊天工作目录或目录名猜项目身份。已有项目可以通过绝对路径打开，不要求搬回默认目录。

## 一个项目可能包含什么

下面是结构示意，不是每个新项目都会立即生成的清单。空目录也不会被 Git 单独记录；评估、审查和知识记录在实际产生时才出现。

```text
<项目根目录>/
├── project.json
├── README.md
├── .gitignore
├── .git/
├── design_kit/
│   ├── source.json
│   ├── kit/
│   └── bundles/<identity>/
├── design_files/
│   └── <Bundle 名>/
│       ├── <规范设计数据>.json
│       └── <引用的文档、图片、图表或预览产物>
└── design_records/
    ├── clarity.json
    ├── journal/*.jsonl
    ├── reviews/
    │   ├── gra-policy.json
    │   └── *.jsonl
    └── knowledge/archive.json
```

| 路径 | 内容与作用 | 谁维护，怎样记录 |
| --- | --- | --- |
| `project.json` | 项目身份、创建时间、Kit 来源记录与知识 Provider 选择 | 项目管理服务创建或通过明确操作更新；Git 跟踪 |
| `README.md` | 给人和 Agent 的项目阅读与继续使用说明，不是业务需求或额外授权 | 创建项目时生成；Git 跟踪 |
| `.gitignore` | Git 忽略规则；新项目默认只忽略 `.DS_Store`、`Thumbs.db` | 项目初始化生成；Git 跟踪。不是对任意临时文件的自动清理规则 |
| `.git/` | 提交、对象、分支等 Git 历史元数据 | 版本管理维护；它承载历史，而不是另一个被 Git 跟踪的普通文件夹 |
| `design_kit/` | 项目自己的完整 Kit 与挂载 Bundle 方法、定义和资源；`source.json` 记录布局与来源 | 首次选择 Kit 时复制；之后通过获准的文件编辑、校验与 Git 操作维护，完整备份须包含它 |
| `design_files/` | 规范设计数据（canonical data）及它引用的实际产物 | 用户通过 Panel、Agent 通过所属 Bundle 修订；校验发布后 Git 跟踪 |
| `design_records/clarity.json` | 最近一次成功保存的 U/S/T 评估及其所依据版本 | 评估报告工具写入；Git 跟踪 |
| `design_records/journal/*.jsonl` | 设计过程中的持久化事实，例如保存、评估和交接记录 | 共享 Journal 服务追加；Git 跟踪，不是宿主完整聊天记录 |
| `design_records/reviews/*.jsonl` | 已发布的审查建议、用户处理决定及相关记录 | 审查与建议服务维护；Git 跟踪，不等于仍存活的后台任务 |
| `design_records/reviews/gra-policy.json` | 项目级 GRA 自动审查策略与调度间隔 | 用户通过设置或明确指令更新；DSH 与 Companion 共用并提交到 Git，不是宿主缓存 |
| `design_records/knowledge/archive.json` | 与 Provider 无关的知识归档，保留关系、发现与决定等持久化数据 | 知识服务保存并由 Git 跟踪；不是可随意丢弃的数据库缓存 |

项目可以包含用户另存的材料，但**文件出现在目录里，不等于工具已校验、提交或作为设计事实使用**。系统只提交本次操作明确拥有的文件，不把用户其他改动顺带提交。分享前应检查整个目录及历史中的隐私信息。

## project.json 的字段

当前源码的项目格式为 `formatVersion: 3`。这是项目文件格式号，不是 npm 版本或 Kit 版本。

| 字段 | 含义 |
| --- | --- |
| `kind` | 固定为 `dsh-design-project`，识别项目类型 |
| `formatVersion` | 元数据格式版本；不能通过手改数字完成升级 |
| `id` | 项目的稳定 UUID；目录移动不应产生新身份 |
| `name` | 显示名称；当前登记中名称须唯一 |
| `createdAt` | 创建时的 UTC ISO 时间 |
| `knowledge.provider` | 由宿主安装并解析的知识 Provider ID，不存数据库路径或凭据 |
| `kit.name`、`kit.version` | 选定 Kit 的技术身份与所记录的来源版本；未选 Kit 时整个 `kit` 字段可缺省 |
| `kit.bundles` | 可选的成员 Bundle 精确版本记录，旧格式项目恢复时用于还原实际原内容，不是另一份设计数据 |
| `kit.contentHash` | 可选的来源内容摘要，用于核对所记录的定义，不替代项目完整 Kit 文件 |

不要为了消除报错而修改 `id`、版本或摘要。同名同版本的内容不一定相同；这些来源记录不是本地版本选择器，也不要求修改方法前先发布新版本。项目运行时读取自己的 `design_kit/kit` 与 `design_kit/bundles/<identity>`，包括方法、schema、validation、Panel、摘要和二进制资源。内容库的修改或删除不会替换这些文件。

旧格式项目尚无 `design_kit` 时，只能从它实际保留的原 Kit/Bundle 内容初始化；原内容缺失时先恢复，不能静默改用内容库新版。需要更新已有项目时，让 Agent 对比目标内容与项目文件，保留定制、设计事实和标识，再沿普通校验及 Git 流程记录修改。Provider 与安装依赖仍需单独保留，详见[Kit 分享与项目维护](kit-sharing.md)及[项目内容维护](../project-content-upgrade.md)。

## design_files 中的数据与产物

各 Bundle 定义自己的规范路径、JSON Schema、字段语义、校验器和允许引用的产物。不要假设所有 Bundle 都只有一个同名 JSON：例如多份调研可以分别位于 `research/<条目 ID>/`，流程可能引用 BPMN，页面设计可能引用 HTML 和图片。

Panel、图上的详情表单和 Agent 应读写同一份规范数据，不各存一份“面板版本”。用户编辑后由公共保存流程校验；Agent 负责的 Bundle 也经过对应校验与 Git 发布。看到一个生成文件或 Agent 声称完成，不等于已经发布成功。

字段说明应从所属 Bundle 的输出契约读取；概览见[官方套件](official-kits.md)，作者结构见[扩展开发](extending.md)。规范事实、假设、用户回答和未决事项需要保持区别。PRD 等汇总产物可以用于交接，但不能反过来覆盖其来源设计，也不作为新的独立 KAG 事实源。

## UST 具体记在哪里

当前评估读取 `design_records/clarity.json`，不是从聊天文字中临时抽分数。主要字段如下：

| 字段路径 | 内容 |
| --- | --- |
| `schemaVersion`、`projectId` | 评估文件格式与所属项目 |
| `assessedCheckpoint` | 本次评估依据的 Git 提交 |
| `report.summary` | 综合判断 |
| `report.u.score`、`report.u.evidence` | U 维度分数及理由 |
| `report.s.score`、`report.s.evidence` | S 维度分数及理由 |
| `report.t.score`、`report.t.evidence` | T 维度分数及理由 |
| `report.nextGap` | 可选的下一项关键缺口 |
| `report.kit`、`report.version`、`report.kitContentHash` | 评估所用方法及内容版本信息 |
| `report.digest` | 报告内容摘要，用于一致性核对，不是另一套设计版本 |

主 Agent 根据真实设计证据提出评估，通过 `report_design_clarity` 持久化，面板读取同一记录。DSH 还可通过原生评估接线使用同一报告契约。分数是带理由的判断，不是测试通过率或必须达到的进度指标。

新评估失败不会被记成零分，也不应清除上一次有效结果；旧结果可能被标为待更新。文件不存在表示尚无评估。用户可在对话里要求更新，历史评估通过 Git 查看，Journal 保留报告事实。普通使用不需要手写这个 JSON。

## 审查策略记录

GRA 策略文件中的 `mode` 可为 `auto`、`continuous`、`every-publication` 或 `off`；`autoMergeWindowMs` 是合并自动触发的静默窗口，可选的 `continuousIntervalMs` 是连续检查间隔，单位均为毫秒。文件尚未生成时默认使用 `auto` 和 30 秒静默窗口。关闭自动审查仍保留用户手动检查入口，同步执行需本次明确同意；具体行为见[共享触发规则](../../packages/companion/README.md#kag--gra-trigger-model-shared-with-dsh)。策略修改通过设置接口保存，不需要手写 JSON；它随完整项目备份保留，`migrate` 不复制旧策略等系统记录。

## Git 怎样记录变化

创建项目会生成初始提交；设计发布、Panel 保存和显式系统记录写入通过各自已有流程提交对应文件。Git commit 是版本依据，无需维护第二套人工设计版本号。

`HEAD` 是最近提交，但最近一次提交可能只新增了评估或审查记录，没有改变设计依据。系统在判断评估和图谱是否过期时区分业务设计变化与已声明的辅助记录变化，避免“保存评分 → 评分立即因自身提交而过期”的循环。

已提交版本与工作树未提交改动要分开阅读。Agent 可通过只读 Git 工具查看历史、差异及特定提交的文件；审查固定一个 checkpoint，是为了评审期间仍可继续编辑而不混用不同版本的证据。它不阻止新设计保存，也不要求把全部历史交给 Agent。

你可以请求：“比较这次保存前后的功能卡，列出我改了什么”，或“说明当前评分依据哪个版本”。需要撤销设计时，明确目标和应保留的修改，再按正常修订或获准的版本操作处理；不要直接对项目执行破坏性的重置来修复连接问题。

## 项目外部还有哪些文件

| 类别 | 用途 | 是否随项目迁移 |
| --- | --- | --- |
| 注册表 `design-projects.json` | 将项目 ID 映射到本机路径；不是项目内容副本 | 新机器或新状态目录重新登记，不盲搬旧路径 |
| 宿主会话选择 | 记录哪个原生会话正在使用哪个项目 | 不作为设计成果共享；不同宿主各自绑定 |
| Companion connection 文件 | 本地服务地址、连接授权及会话关联 | **不共享、不公开、不借用旧连接**；服务重新打开后使用本次返回的连接 |
| 运行状态、锁、投递收据、原生任务绑定 | 协调当前进程和真实宿主任务 | 不是可恢复的设计内容；复制它们不会复活旧任务 |
| 知识数据库、向量索引、模型缓存 | 加速查询或提供本地计算 | 与项目内知识归档不同；可重建部分按实际诊断处理，不在运行时随意清空 |
| Kit/Bundle 内容库与作者源 | 为未来项目提供当前方法和定义，并保留可复用的专业内容 | 项目取得的完整副本在 `design_kit/`；库与作者源仍应独立保留，不能当作可删除缓存 |
| Provider 及 npm runtime | 提供受信任的执行、原生面板与宿主接入能力 | 不因复制 `design_kit` 而被安装；按安装与发行入口单独维护 |

这些位置由宿主及安装方式决定，项目命令返回的 `stateRoot` 也是运行位置，不写回 `project.json`。DSH 和 Companion 有不同状态目录；同一台机器安装多个宿主，不意味着复制项目目录或各生成一份设计事实。完整职责见[共享底层与宿主适配](architecture.md#共享底层与宿主适配)。

## 打开、迁移、重建与移除的区别

| 操作 | 输入与结果 | 原项目和历史 |
| --- | --- | --- |
| `open` | 打开兼容的已有设计项目，必要时登记路径 | 继续同一身份和 Git 历史 |
| `close` | 解除当前会话选择 | 文件和历史保留 |
| `delete` | 从注册列表移除项目，不删除目录 | 文件和历史保留，可再按路径打开 |
| `migrate` | 从旧项目的 `design_files/` 为目标 Kit 新建迁移项目，再由 Agent 校验适配 | 原件不动；新身份、新历史，不复制旧评估、缓存或会话 |
| `reconstruct` | 从非设计项目的代码、文档或截图还原设计 | 材料只读；生成新的设计项目，不是字节复制 |

`migrate` 只处理目标 Kit 认识的 Bundle，未知 Bundle 和无法适配的内容要报告，不承诺任意历史格式都能自动转换。需要完整保留历史时，备份整个原项目，而不是把迁移当成备份。

## 备份、分享与清理

先保存编辑，确认没有正在写入的任务。完整备份应保留项目根目录，包括隐藏的 `.git/`、`design_kit/`、`design_files/` 和 `design_records/`。旧格式项目尚未形成项目内 Kit 文件时，还需保留其实际所用的完整 Kit/Bundle 原件；独立 Provider 和安装依赖另行备份。仅做 Git clone 不会带走尚未提交或未跟踪的文件。

复制项目用于备份不会生成新身份。同一注册表不接受同一个 ID 同时指向两个项目路径；不要手改 ID 来制造分支项目。使用副本继续工作前先明确保留哪一份登记，或使用 `migrate` 创建新项目。

发布或交给第三方前检查设计内容、图片、Journal 和 Git 历史中的隐私；只从当前文件删除敏感内容，并不从旧提交删除它。不要附带连接文件、宿主认证和完整私密聊天记录。

清理空间时先区分业务成果、持久化记录、安装依赖和运行缓存。不要把 `design_records/` 当临时目录，也不要把删状态目录当通用修复方法。真正删除项目目录是文件删除，不包含在 `delete` 命令中，需要另行明确确认。

实现入口：[项目元数据与初始化](../../packages/core/src/design-project.ts)、[注册与迁移](../../packages/core/src/design-project-registry.ts)、[项目 Kit 文件](../../packages/core/src/project-kit-source.ts)、[持久化记录分类](../../packages/core/src/design-project-record-paths.ts)、[UST 文件](../../packages/core/src/design-clarity-authority.ts)、[知识归档](../../packages/core/src/design-knowledge-records.ts)。

# 公共文档维护与同步规范

## 唯一维护源

开发仓根 `README.md`（中文首页）、`README.en.md`（完整英文对应版）、`CONTRIBUTING.md`、`SECURITY.md`、`docs/README.md`（文档总览）和按策略选入的 Wiki、架构与技术参考是正式公共文档。公开目录使用相同相对路径及字节，从一个经过审查的固定 main 提交导出。产品定位、宿主兼容、安装和贡献说明不维护内部/公开两套正文。

`docs/README.md` 按阅读任务索引原文，`docs/wiki/README.md` 聚焦使用与内容创作；独立架构和契约文档保留稳定路径。入口可以相互链接，不复制正文或为公开目录维护第二套文档。

旧 `release/*.public.md` 只保留迁移指引，不再作为当前文档输入。旧固定提交的三份草稿导出及其 manifest 仍可读取和验证；这不允许当前同步回退到另一份正文。

2026-10-13 阶段性重写前的用户原稿保留为根目录 `README.old.md` 与 `README.en.old.md`，仅用于内部对照和后续内容取舍。两份旧稿按精确文件规则排除公开导出，不作为另一套维护源；后续调整继续维护正式中英 README。

## 手册、技术参考与历史资料

使用与创作说明从 `docs/wiki/README.md` 进入，跨主题导航由 `docs/README.md` 维护。架构、Bundle、DSL 和其他技术契约保留稳定路径；手册引用它们，不复制或另设一份契约。日期和文件名不能代替对源码、实际消费者与内容状态的核对。

已确认的历史方案、实现记录和验收笔记归入 `docs/internal/history/`，保留原文、来源、失败及验证范围。归档索引说明对应的现行说明，并记录原路径到新路径的映射。实验输入、脚本和原始来源材料继续在 `docs/experiments/`、`docs/reference/` 保持成套关系；文档整理不重写实验产物或恢复历史运行方式。

移动文档前核对 Markdown 链接和代码、测试、技能中的实际路径消费者；移动后修复受影响的相对链接，并验证正文与来源保留。公开包含文件保持原有路径和字节导出规则。新内部索引、归档和处置清单须在既有策略中明确排除；原历史路径的精确排除规则继续防止旧说明被误重新发布。内部盘点与执行证据不进入正常使用步骤。

## 中英对应维护

产品名称与术语遵循 Wiki 的[命名与术语翻译规范](wiki/terminology.md)。中文文档保留“语构设计系统（Yugoo Design）”及中文（英文）对照；翻译不改变命令、包名或协议标识。

中文首页与英文版在顶部互相导航，并使用对应的章节顺序。产品定位、核心能力、具体示例、宿主状态、演进方向、截图及其范围说明、署名和反馈渠道两边同时维护。英文版是完整对应正文；修改一边时核对另一边，避免只保留摘要或造成能力与状态不一致。

迁移时逐张核对截图的展示目的、界面上下文和正文位置。展示对话与 Panel 配合的系统截图，不能仅用单个业务产物页面代替并记作完整还原。保留原图，或在有必要的遮挡后保留其交互信息；图像选入仍按既有策略和实际像素审阅。两种语言引用同一套图像。

每种语言的正文都是正式源文件，由同一个固定提交原字节导出，不在公开目录临时翻译。新语言文件仍须逐文件分类；工具检查选入的根 `README.<language>.md` 与中文首页的本地链接及标题锚点。链接检查不证明翻译语义等价，含义和章节对应仍由内容审查确认。

官网直接引用的使用与创作指南在原路径旁维护 `.en.md` 英文对应版；Wiki 的 `README.md` 与 `README.en.md` 分别提供中文和英文入口。语言切换链接保留读者所在主题，不用另一语言的摘要代替完整操作说明。中文入口及 DSH 社区原有路径继续保留。正文、命令、示例、截图用途和版本边界须成对核对；尚未完成的深层参考翻译不伪装成已有英文版。官网只链接这些正式源文件，未来站内文档也应从经审查的固定源构建，不另行手工维护正文。

## 分类

`release/public-source-policy.json` 是现有分类 authority；规则按顺序匹配，新文件必须有明确分类及理由。

产品发布工作流 `.github/workflows/publish-product.yml`、产品清单 `release/product.json`、安装包模板 `release/product-package-template.json` 及准备、原生材料获取和定点检查脚本按精确路径选入。维护者操作说明集中在 [CONTRIBUTING.md](../CONTRIBUTING.md#publish-a-product-release)。它们与文档一起从固定提交导出，不在公开目录维护另一份。

公开仓库推送与产品清单一致的 `vX.Y.Z` Git 标签后，工作流依次发布同版 DSH 依赖和统一 `yugoo-design` 产品包；源码必须位于公开 `main` 历史中。正式产品版本不含预发布后缀。DSH 宿主映射模板不再维护独立版本号，安装包中的精确版本从产品清单生成。普通 `main` 推送不发包；手动入口用于仅构建检查或匹配版本标签的发布恢复。原始包、依赖锁和完整性证据随同一固定源码绑定，不能用新打包结果冒充原包恢复。

官方 npm 发布只在 GitHub Actions 内执行，本机开发、测试、构建和 pack 不授权本机发布。产品与内部包使用相同的 `publish-product.yml` Trusted Publisher 身份；实际账户配置仍须与包、仓库和允许动作一致。正式发布使用 `latest`，不再维护 `beta` 发布通道；重试不得回退到旧版本。

| 内容 | 处理 |
| --- | --- |
| README、公共 Wiki、贡献/安全文档及可公开契约 | 逐文件 include，链接须在选入文件中闭合 |
| 内部 TODO、开发现场、临时证据、旧版保留副本 | exclude，保留开发仓原件 |
| 未分类内容 | review，阻止导出 |
| 截图、外部图稿与第三方材料 | 按现有精确来源/权利及隐私检查选入 |

可复用的演示项目放在 `examples/`，其说明和项目内容随同一固定提交导出。保留演示所需的完整项目资料，不包含项目自己的 `.git`；用户在独立副本中打开或迁移，不直接修改仓库样例。选入前检查个人路径、真实业务数据和凭据，不将项目目录外的宿主会话、模型配置或运行状态一并复制。截图与 GIF 应对应样例中的真实内容，素材整理过程和逐次录制证据留在内部工作记录。

产品标识与截图用途集中说明在 `docs/images/README.md`；截图的唯一目录索引放在原生插件入口 `packages/dsh/screenshots.json`，供以该子目录为条目的插件市场读取。索引使用固定公开提交中的 GitHub HTTPS 原图地址，不复制图片，也不在仓库根保留第二份截图名单。说明、索引、源 SVG 和已审阅 PNG 按正式路径原字节导出。`release/product-package-template.json` 的主页、问题反馈与关键词用于下一次产品安装包构建；源码素材同步不会修改已经发布的 npm 包，也不新增宿主兼容性声明。

公共文档不得要求读者访问私有源码、内部网关或个人开发路径。内部启动说明单独存放；公开用户的安装路径是对应宿主的插件接入。

## 工具行为

继续使用现有 `scripts/public-export.mjs` 的 stage、inspect、prepare、verify、apply 流程，具体命令见本文的[源码导出步骤](#准备与核准源码导出)，中断处理见[恢复步骤](#恢复中断的源码导出)。[贡献指南](../CONTRIBUTING.md)保留维护者入口；详细操作在本页集中维护，不建立第二套流程。正式文档路径、原字节导出及现有分类规则不变。

启用 `--public-documents true` 时，当前快照选择正式根文档并原字节导出，同时检查公共 Wiki 和 `examples/` 中示例说明的本地链接。只有历史快照明确选入三份旧草稿时才走原有迁移路径。混合或缺失输入失败；不把用户的工作树未提交字节写入快照。

检查分别证明：

- 固定 Git 输入和输出内容一致。
- 公共文档文件链接和标题锚点闭合；无法验证的语法明确失败。
- 内部资料仍排除，未知文件及其他 preflight guard 继续生效。
- inspect/prepare/apply 的 hash、目标冲突保护、Git 元数据保护和恢复记录沿用原工具。

链接检查不证明外部 URL 可用、安装步骤已验收或任何产品能力已发布。格式和字节检查也不授予对外 push/npm publish 权限。

## 内容状态

源码实现、UI 原型、实际保存重开、原生 Agent 执行、安装候选和已发布版本分别描述。宿主徽章链接到有版本及范围说明的指南。反馈渠道实际启用前，说明当前可用的联系方式；启用待办留在维护记录，不虚构入口或服务承诺。

面向读者组织正文：README 说明用途、能力与开始方式，Wiki 说明操作、结果与排障，技术参考说明职责、接口与运行机制。内部排期、编辑过程、测试命令输出和逐次验收记录放在对应维护或历史章节，不插入日常操作步骤。必要限制紧邻相关能力说明，避免逐段重复免责声明。重组时保留专业方法、示例、截图和真实失败记录；链接检查之外，还需检查正常使用路径是否清楚、中英含义是否对应。

英文产品名称使用 **Yugoo Design**，中文展示使用 **语构设计系统（Yugoo Design）**，维护团队署名保持 **YugooDesign Team**；既有包名、命令及协议标识按技术契约保留。README 开场同时说明交互式构思设计的价值、插件身份与宿主兼容，中文和英文同步更新。Web App Kit 是默认随主插件提供的官方领域入口；决策与运筹建模（Decision Modeling）Kit 暂仅供内部验证，不随默认产品发行，也不从公开源码导出。保留内部源码与通用独立 Kit 接入能力，但不提供该内部 Kit 的公开获取或安装指引。历史发布和验证记录可以保留，须明确不代表当前默认交付；撤包结果按实际登记状态说明，不能将计划写成已完成。游戏设计等未交付规划不得写成已交付 Kit，也不能把产品定位收缩为只服务编码或应用生成。当前官方套件清单集中维护在 Wiki 的 kit-sharing.md，不另造市场或重复的内容版本 authority。

README 的快速开始保持简短入口；宿主兼容说明支持方向与交互体验，详细安装和兼容范围集中维护在 Wiki。增加宿主徽章时，同步更新安装指南及 Wiki 对应章节，不在 README 重复维护完整宿主矩阵。记录具体候选、呈现方式和验收范围，并区分 CLI 与桌面端；连接成功、页面打开、保存后原生会话读取、完整 Bundle 执行及后台能力分别核对。通用兼容徽章不代表各宿主功能完全相同。正式发行的统一安装 Skill 或提示词应在实际交付与验证后替换预览入口。

## 验证入口

中文加粗内容以括号、冒号等标点结尾且后接正文时，在结束的 `**` 后留一个空格，例如 `**设计套件（Kit）** 将方法组织在一起`。不要在 `**` 与其包裹的文字之间加空格。文档测试复用现有 CommonMark/GFM 渲染器检查正文是否漏出加粗标记；代码示例中的字面标记不算格式错误。

在依赖已准备的工作区运行：

```sh
pnpm run test:public-documents
```

正式同步前仍需检查所选固定提交的完整 policy 和实际目标差异。focused fixture 不替代整份快照的导出检查；源码提交、公开同步和发布是不同交付步骤。

## 准备与核准源码导出

This is a maintainer operation, separate from npm installation and publication.
Maintain public documentation in the development repository at its formal paths; see [the document sync contract](#唯一维护源). Current exports copy these files unchanged. Historical fixed commits retain their documented draft relocation.

Export only a reviewed immutable Git commit, not the dirty working tree. Use
the versioned `release/public-source-policy.json` belonging to that commit;
unknown files and unresolved findings block staging. Do not broaden the policy
to include internal plans, credentials or development paths merely to pass.

Use new, non-overlapping stage and preparation directories. Start with a disposable
target for validation; writing the actual public repository requires a separate
review of its exact changes and authorization. These commands do not commit,
configure a remote, push or publish:

```sh
node scripts/public-export.mjs stage --source /absolute/SOURCE --revision FULL_COMMIT --policy /absolute/REVIEWED_POLICY.json --destination /absolute/NEW_STAGE --public-documents true --public-source-config true
node scripts/public-export.mjs inspect --stage /absolute/NEW_STAGE --target /absolute/TARGET
node scripts/public-export.mjs prepare --stage /absolute/NEW_STAGE --target /absolute/TARGET --preparation /absolute/NEW_PREPARATION --stage-sha256 STAGE_HASH --target-sha256 TARGET_HASH
node scripts/public-export.mjs verify --preparation /absolute/NEW_PREPARATION --receipt-sha256 PREPARED_HASH
node scripts/public-export.mjs apply --preparation /absolute/NEW_PREPARATION --receipt-sha256 PREPARED_HASH --stage-sha256 STAGE_HASH --target-sha256 TARGET_HASH
```

Before `prepare`, review `inspect`'s `writes`, `deletes` and `conflicts`; require
`applicable: true`. Use its exact `stageManifestSha256` and `targetStateSha256`
as `STAGE_HASH` and `TARGET_HASH`. `PREPARED_HASH` is `prepare`'s
`preparedSha256`, not a hash of its displayed JSON wrapper. Do not guess hashes
or reuse approval after the source, target or evidence changes. `verify` checks
the prepared evidence; it does not authorize `apply` or approve a release.

The exporter preserves target Git metadata and unmanaged content, and refuses
conflicting user edits or unsafe paths rather than overwriting them. Staging
does not prove dependency closure or buildability: validate the staged source
and its intended distribution before authorizing the actual public target.
Successful synchronization still reports publication readiness as false.
Failed staging/preparation may retain an incomplete new directory; failed apply
may retain partial target changes, backups, journal and locks. Preserve those
artifacts and follow explicit recovery below instead of blindly retrying.

## 恢复中断的源码导出

This is a maintainer operation, not a plugin installation step. Keep the target,
backups, journal and locks intact, and stop every executor for that transaction
before approving settlement. A PID, timestamp or old lock does not prove that an
executor has stopped. Do not delete locks or blindly rerun the export.

List the explicit recovery commands with:

```sh
node scripts/public-export-recovery.mjs --help
```

If a settlement resume itself stopped and retained its `.resume-lock`, inspect
the complete evidence first, then approve exactly that reported plan:

```sh
node scripts/public-export-recovery.mjs inspect-resume-lease --journal /absolute/JOURNAL --header-sha256 HEADER_HASH --tail-sha256 CURRENT_TAIL_HASH --evidence /absolute/EVIDENCE --intent-sha256 INTENT_HASH
node scripts/public-export-recovery.mjs takeover-stopped-resume --journal /absolute/JOURNAL --header-sha256 HEADER_HASH --tail-sha256 CURRENT_TAIL_HASH --evidence /absolute/EVIDENCE --intent-sha256 INTENT_HASH --stopped-resume-plan-sha256 EXACT_INSPECTED_PLAN_HASH --executor-stopped yes
```

Replace every hash placeholder with the exact lowercase SHA-256 from the
transaction evidence. The approval is the inspector's top-level `planSha256`,
not its nested resume hash. Inspection neither stops a process nor approves a
mutation. Unknown, changed or incomplete evidence is rejected.

This command settles an already recorded pending operation; it does not redo
managed target writes, delete the retained lease or backups, release the
transaction lock, commit, push or publish. A `result-recorded` response is not
completion of the entire export. Truncated journals, unrecorded directory
ownership and unsupported interrupted cleanup states remain blocked: retain
the evidence and report the specific state rather than forcing recovery.

For an explicitly stopped directory cleanup, new rollback logs include a durable
physical-identity anchor. Inspect that complete log and approve its current resume
plan; historical logs without this anchor are refused, not backfilled:

```sh
node scripts/public-export-recovery.mjs inspect-directory-rollback-resume --journal /absolute/JOURNAL --header-sha256 HEADER_HASH --tail-sha256 FILE_JOURNAL_TAIL --directory-plan-sha256 ORIGINAL_CREATION_PLAN_HASH
node scripts/public-export-recovery.mjs resume-directory-rollback --journal /absolute/JOURNAL --header-sha256 HEADER_HASH --tail-sha256 FILE_JOURNAL_TAIL --directory-plan-sha256 ORIGINAL_CREATION_PLAN_HASH --plan-sha256 EXACT_INSPECTED_RESUME_PLAN_HASH --executor-stopped yes
```

Only directories recorded as exporter-created, still having their recorded
identity and currently empty, can be removed non-recursively. If a durable removal
intent's path is already absent, recovery records that observation without claiming
who removed it. Unknown contents, replacement directories or leases, symlinks,
changed permissions, altered evidence and truncated logs refuse further cleanup.
The exact accepted hash and immutable generation claim exclude same-plan competing
executors; neither proves that another executor has stopped.

Success retains the cleanup log, claims, backups, original directories and user/Git
content, and releases only the exact anchored empty shared step lease. The response
separates `stepLeaseReleased` from `lockReleased=false`; the original transaction
lock remains. Use the existing `inspect-finalize-rollback` and separately approved
`finalize-rollback` commands for transaction completion. A completed cleanup with
its step lease already absent can be confirmed read-only. A re-interrupted resume
requires stopping executors again and inspecting a new plan, not reusing approval.
No command commits, pushes, publishes or sets `publicationReady=true`.

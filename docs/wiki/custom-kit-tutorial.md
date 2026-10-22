# 最小定制教程：工作室的范围与变更规则

本教程为语构设计系统（Yugoo Design）创建一个只处理项目范围与修改请求的设计套件（Kit）。你会复用完整的业务规则设计技能包（Bundle），调整领域主提示词（Mindset）、面板文案与预览样例，再检查这个工具能否帮助用户作出判断。

练习对应[工作室项目交付案例](web-app-demo.md)：客户说“再改一点”时，怎样记录请求、判断与原交付范围的关系，以及说明后续影响。完成后得到一个独立内容目录，原 Web App Kit 和已有设计项目保持原样。

## 1. 先确定改什么

| 本轮改动 | 希望看到的效果 |
| --- | --- |
| 新 Kit 的 Mindset | Agent 用工作室熟悉的语言帮助讨论范围与变更 |
| 独立 Bundle 身份 | 可以单独维护这份副本，继续使用原有数据语义和专业方法 |
| 面板语言资源与样例 | 打开时看到项目规则，知道该怎样阅读和修改 |

本轮复用业务规则的专业方法、schema、validation、执行声明、摘要和面板布局，并在下文明确修正一条与当前系统评估原则不一致的旧表述。若要改变字段或其他专业方法，再按[扩展开发](extending.md)同步维护相关契约；一次标签修改不需要先改共享组件。

## 2. 复制完整 Bundle 与原始声明

在所选源码 checkout 根目录操作，先核对 Node.js 版本与[源码准备](development.md#准备工作区)。目标目录必须尚不存在，父目录应已存在。下面只复制一个完整 Bundle 和原始许可材料，不安装依赖或接入宿主：

```bash
node --input-type=module - /absolute/new-studio-kit <<'JS'
import { cp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

if (!process.argv[2]) throw Error('Provide a new destination directory')
const target = resolve(process.argv[2])
const source = resolve('packages/skills-web-app')
const kit = join(target, 'kits/studio_delivery')
const bundle = join(target, 'bundles/studio_scope_rules')
await mkdir(target)
await mkdir(kit, { recursive: true })
await mkdir(join(target, 'bundles'))
await cp(join(source, 'bundles/business_rules'), bundle,
  { recursive: true, force: false, errorOnExist: true })
for (const directory of [target, kit, bundle]) {
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await cp(join(source, file), join(directory, file),
      { force: false, errorOnExist: true })
  }
}
console.log(target)
JS
```

这是基于现有源码的准备步骤；已安装内容的实际位置按目标版本查看。复制失败时先检查目标中的实际文件，不覆盖已有目录重跑。保留原署名与来源，自己的说明可以追加。

## 3. 声明新 Kit 与精确挂载

在目标包根目录创建 `package.json`：

```json
{
  "name": "local-studio-delivery-kit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "designSystem": {
    "kit": {
      "root": "./kits/studio_delivery",
      "mindset": "./kits/studio_delivery/mindset.md",
      "manifest": "./kits/studio_delivery/kit.yaml",
      "bundles": "./bundles"
    }
  }
}
```

在 `kits/studio_delivery/kit.yaml` 写入：

```yaml
version: 1
mounts:
  - bindingKey: business_rules
    name: studio_scope_rules
    version: "1.0"
```

打开副本 `bundles/studio_scope_rules/skill.yaml`，**新增一行** `identity: studio_scope_rules`，保留原 `name: business_rules`、`version: "1.0"` 及其他全部内容。目录名和挂载的 `name` 使用新 catalog 身份；`bindingKey` 与原运行时名称一致，所以设计数据仍使用原业务规则字段与路径。

`package.json` 的版本是本地分发容器版本，Mindset 与 Bundle 还有自己的版本。这里创建新身份的本地练习，不覆盖已发布的同一身份/版本。

## 4. 写一个范围清楚的 Mindset

在 `kits/studio_delivery/mindset.md` 写入：

```markdown
---
name: studio_delivery
version: "0.1"
description: Help a small design studio clarify project scope and change rules.
---

# 工作室的范围与变更规则

你是一位专业、友好的项目交付顾问，帮助用户把实际工作约定表达为可讨论的规则。
用户熟悉客户与团队，但未必事先想清楚怎样界定范围、修改与交期影响。

<design_skills>
## business_rules
把具体情境展开为有条件、有确定处理结果的规则，并通过面板让用户查看和修改。
</design_skills>

先使用用户已有的交付约定和具体修改请求。信息足够时直接展开规则；
遇到会改变判断的未知项，再给出一个熟悉的情境帮助用户选择或补充背景。
可以先形成明确标为暂定的方案，不强求用户一次回答全部问题。

区分原交付范围内的修改、尚待确认的新范围，以及对交期的影响。
它们的具体界线由用户和实际约定决定，不替团队编造次数限制、收费或承诺。
本 Kit 只挂载业务规则能力；需要流程、排期等其他成果时说明当前范围，
不声称已经生成或更新未挂载的内容。

保存后读取用户实际修改，保留无关规则和稳定 ID；再判断还有什么需要澄清。
当本轮规则已经足以供讨论时，总结决定与未决项。沿用系统的校验、保存、
版本记录和审查机制，不覆盖执行门或自动接受建议。
```

这段 Mindset 负责选择与解释；副本 `SKILL.md` 仍保留业务规则的完整专业方法，输出契约仍在 `reference/artifact-contract.md`。若将来修改 Bundle 方法，共有的关键约束需要从方法与输出契约两条入口都能到达，见[方法创作规范](../../.agents/skills/design-skill-creator/references/standards.md)。

### 核对复用方法中的旧约定

检查所复制的[业务规则方法](../../packages/skills-web-app/bundles/business_rules/SKILL.md)。部分版本在 Close-out evidence 中保留了历史表述 `A grounded set typically supports S +15..+25 and T +20..+30.`。[共享推进与评估原则](../system-design-baseline.md#foreground-design-loop)要求根据已保存设计、当前范围和实际证据判断清晰度；分数可能不变或下降，不能按完成一个 Bundle 固定加分。

若练习副本的 `SKILL.md` 仍有上述一句，只将它替换为下面的说明；所用版本已经采用现行原则时，无需重复修改：

```text
Assess current clarity from the saved design and current scope; explain what is clear, unresolved or inconsistent. Scores may stay unchanged or decrease; do not apply fixed increments for producing rules.
```

保留该段关于可审阅成果、完成校验与证据说明的其余要求，以及全部规则推导、修订、稳定 ID 和交接方法。这里明确修正副本中的冲突，不更改官方原件，也不新增评分或执行机制。

## 5. 让面板说明符合这个领域

打开副本的 `locales/zh-CN.json`，只更新以下键，保留其余翻译：

```json
{
  "rules": "项目范围与变更规则",
  "guidance": "选择一条规则，核对客户请求的情境、处理方式与待确认的影响。",
  "conditionExample": "例如：客户要求调整原定首页布局，未增加页面或业务能力",
  "outcomeExample": "例如：记录为当前范围内修改，由负责人确认本轮安排"
}
```

在 `locales/en-US.json` 更新对应键，其他键同样保留：

```json
{
  "rules": "Project scope and change rules",
  "guidance": "Select a rule and review the client request, its handling and any impact that needs confirmation.",
  "conditionExample": "For example: revise the agreed homepage layout without adding pages or capabilities",
  "outcomeExample": "For example: record an in-scope revision and have the project lead confirm its scheduling"
}
```

已有 `panel.yaml` 通过 `$t:rules`、`$t:guidance` 和字段提示使用这些文案。你改变了用户看见的标题与引导，仍复用相同的列表、详情、编辑控件与共享样式。字段 key 和用户记录不随语言切换改变。

## 6. 准备能看出差别的预览样例

将副本的 `reference/preview.json` 替换为下面的完整合成样例。样例只用于预览，不成为任何用户项目的初始事实：

```json
{
  "schema_version": 4,
  "rules": {
    "BR-STUDIO-001": {
      "id": "BR-STUDIO-001",
      "title": "原交付范围内的修改",
      "condition": "客户要求调整原定首页布局，未新增页面或业务能力",
      "outcome": "记录为范围内修改；涉及交期影响时交负责人确认安排",
      "notes": "合成预览，具体界线以团队实际约定为准。"
    },
    "BR-STUDIO-002": {
      "id": "BR-STUDIO-002",
      "title": "新增交付范围",
      "condition": "客户提出原定范围外的页面或功能",
      "outcome": "登记为待评估变更；确认范围与排期影响后再安排",
      "notes": "尚未确认的请求不表示团队已经承诺。"
    }
  },
  "rule_order": ["BR-STUDIO-001", "BR-STUDIO-002"]
}
```

## 7. 先验证内容，再查看效果

按[独立内容包校验样例](extending.md#校验独立内容包)，使用**目标包根目录**、运行时名 `business_rules` 和这份 `reference/preview.json`。核对读回的 Kit 为 `studio_delivery@0.1`、Bundle catalog 为 `studio_scope_rules@1.0`，运行时名仍为 `business_rules`。

再用一个错误样例检查拒绝路径，例如把 `schema_version` 改为不支持的值。原样例通过、错误样例被拒绝，是内容检查；还需要在实际面板查看标题、两条规则、中文/英文文案及字段编辑。此练习没有需要安装的脚本依赖，也没有新增共享组件。

### 到 Studio 查看

通过目标宿主已支持的完整内容包入口接入这份目录。Companion 使用[完整目录与同一状态入口](kit-sharing.md#使用完整内容包创建新项目)，DSH 使用其[发现与显式选择](kit-sharing.md#dsh发现冲突与显式版本切换)；不要把包目录直接当成 Studio 归档文件导入。

确认 Studio 正在读取这个独立来源和身份，再打开 Bundle 的“面板预览”。应看到两条项目规则，标题为“项目范围与变更规则”。修改一条结果文字，确认视图和字段能正常工作；样例预览不向设计项目发布修改。若还显示原内容，按[来源与刷新排查](troubleshooting.md#修改了-bundlestudio-仍显示旧内容)核对。

若目标宿主或安装版本没有 Studio 面板预览入口，可以跳过这一项，在下一节的独立新项目中通过普通设计面板检查展示与编辑，无需切换真实项目或修改宿主配置。记录实际完成的检查：普通面板使用与 Studio 样例预览各自验证不同的内容。

## 8. 在新项目中走一轮真正的协作

通过宿主的 `yugoo` 入口为新项目选择 `studio_delivery`，确认精确版本，再提出：

```text
我们约定交付首页和案例页。客户今天要求修改首页布局，另外提出增加会员中心。
请把两类请求整理成可以讨论的业务规则，不替我们决定收费或承诺交期。
先给出面板，让我补充实际约定。
```

检查 Agent 使用了新 Mindset，并读取副本的完整方法。得到面板后，补充“范围内的修改也可能影响已承诺节点”，保存、关闭并重开，确认修改保留；然后要求 Agent 基于这项反馈修订相关规则。

这一步检验 Agent 能否生成结果、保留人的修改，并在保存后继续理解和修订。记录所用宿主、内容版本，以及实际完成的内容校验、预览和协作过程，供自己和接收者参考。

分享时交付整个内容包、原始声明、适用请求与实际验证范围。按[作者与接收者检查](kit-sharing.md#作者与接收者的最小验证)让另一位接收者检验；目录复制、内容采用、新版本发布和已有项目迁移分别处理。

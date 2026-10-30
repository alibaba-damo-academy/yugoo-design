# Minimal customization tutorial: scope and change rules for client projects

[中文版](custom-kit-tutorial.md)

This tutorial creates a Yugoo Design Kit focused only on project scope and change requests. You will reuse the complete business-rules Bundle, adjust the Mindset, Panel copy, and preview example, then check whether the tool helps users make judgments.

The exercise corresponds to the [client project delivery case](web-app-demo.en.md): when a client asks for “one more small change,” how do you record the request, judge its relationship to the original delivery scope, and explain what follows? The result is an independent content directory; the original Web App Kit and existing Design Projects remain intact.

The current source implements the in-place editing, source import and project-owned `design_kit` flows used in this tutorial. For an installed release, use the capabilities and instructions shipped with that version; documentation updates do not change an existing installation.

## 1. Decide what to change first

| Change in this round | Intended effect |
| --- | --- |
| New Kit Mindset | The Agent helps discuss scope and changes in language familiar to the project team |
| Independent Bundle identity | Maintain this copy independently while continuing to use the original data semantics and professional methods |
| Panel locale resources and example | On opening, users see project rules and understand how to read and edit them |

This round reuses the business-rules professional methods, schema, validation, execution declarations, summary, and Panel layout. To change fields or professional methods, maintain the related contracts together following [extension development](extending.en.md). Label changes alone do not require shared component changes first.

This is a source-based content exercise. The Studio in-place editing and project-owned Kit files described below require a version with the corresponding runtime; see [sharing and project maintenance](kit-sharing.en.md). Source and example checks do not establish that an older installed release supports those capabilities.

## 2. Copy the complete Bundle and original notices

Work in the root of the selected source checkout, first checking the Node.js version and [source preparation](development.md#准备工作区). The target directory must not yet exist, and its parent must already exist. The following copies only one complete Bundle and original license materials, without installing dependencies or connecting a Host:

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

This preparation uses existing source. Check the target version for actual installed-content locations. If copying fails, inspect the files actually present in the target before proceeding; do not overwrite an existing directory and rerun. Preserve original attribution and provenance; you may append your own notes.

## 3. Declare the new Kit and exact mounts

Create `package.json` at the target package root:

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

Write the following in `kits/studio_delivery/kit.yaml`:

```yaml
version: 1
mounts:
  - bindingKey: business_rules
    name: studio_scope_rules
    version: "1.0"
```

Open the copied `bundles/studio_scope_rules/skill.yaml` and **add one line**, `identity: studio_scope_rules`, retaining the original `name: business_rules`, `version: "1.0"`, and all other content. The directory name and mounted `name` use the new catalog identity; `bindingKey` matches the original runtime name, so design data retains the original business-rule fields and paths.

The `package.json` version belongs to the distribution container; Mindset, Bundle, and mount declarations retain their respective source versions. This exercise creates an independent identity without overwriting the original content. Current Studio editing saves the same identity in place, without a local version bump or remount for each change; retain the version fields shown in this directory example.

## 4. Write a clearly scoped Mindset

Write the following in `kits/studio_delivery/mindset.md`:

```markdown
---
name: studio_delivery
version: "0.1"
description: Help a small client delivery team clarify project scope and change rules.
---

# Scope and change rules for client projects

You are a professional, friendly project-delivery consultant helping users express
actual working agreements as rules they can discuss. Users know their clients and
team, but may not yet have thought through scope, revisions, and schedule effects.

<design_skills>
## business_rules
Develop concrete situations into rules with conditions and definite outcomes, and
let users view and change them through the Panel.
</design_skills>

Start with the user's existing delivery agreements and specific change requests.
Develop rules directly when there is enough information. When an unknown would
change the judgment, offer a familiar scenario to help the user choose or add context.
You may first create a clearly provisional proposal; do not require all questions
to be answered at once.

Distinguish revisions within the original delivery scope, new scope still awaiting
confirmation, and effects on delivery dates. Users and actual agreements determine
the boundaries. Do not invent revision limits, fees, or commitments for the team.
This Kit mounts only business-rules capability. When flows, scheduling, or other
outputs are needed, explain the current scope; do not claim to have generated or
updated content that is not mounted.

After saving, read the user's actual changes and preserve unrelated rules and
stable IDs, then judge what still needs clarification. When this round's rules
are sufficient for discussion, summarize decisions and unresolved matters. Follow
the system's validation, saving, version records, and review mechanisms without
bypassing execution gates or automatically accepting suggestions.
```

This Mindset handles selection and explanation. The copy's `SKILL.md` still retains the complete business-rules professional methods, and the output contract remains in `reference/artifact-contract.md`. If you later change Bundle methods, shared critical constraints must be reachable from both the method and output-contract entry points; see the [method authoring standard](../../.agents/skills/design-skill-creator/references/standards.md).

<details>
<summary>Compatibility with older business-rules methods</summary>

Inspect the copied [business-rules method](../../packages/skills-web-app/bundles/business_rules/SKILL.md). Some versions retain the historical sentence `A grounded set typically supports S +15..+25 and T +20..+30.` under Close-out evidence. The [shared progression and assessment principles](../system-design-baseline.md#foreground-design-loop) require judging clarity from saved design, current scope, and actual evidence. Scores may remain unchanged or decrease; completing a Bundle must not award fixed points.

If that sentence remains in your exercise copy's `SKILL.md`, replace only that sentence with the following. If the version already uses the current principles, no repeat change is needed:

```text
Assess current clarity from the saved design and current scope; explain what is clear, unresolved or inconsistent. Scores may stay unchanged or decrease; do not apply fixed increments for producing rules.
```

Retain the rest of that paragraph's requirements for reviewable artifacts, completed validation, and evidence explanations, along with all methods for rule derivation, revision, stable IDs, and handoff. This explicitly corrects a conflict in the copy, without changing the official original or adding a scoring or execution mechanism.

</details>

## 5. Adapt Panel guidance to the domain

Open the copy's `locales/zh-CN.json` and update only these keys, retaining other translations:

```json
{
  "rules": "项目范围与变更规则",
  "guidance": "选择一条规则，核对客户请求的情境、处理方式与待确认的影响。",
  "conditionExample": "例如：客户要求调整原定首页布局，未增加页面或业务能力",
  "outcomeExample": "例如：记录为当前范围内修改，由负责人确认本轮安排"
}
```

Update the corresponding keys in `locales/en-US.json`, also retaining other keys:

```json
{
  "rules": "Project scope and change rules",
  "guidance": "Select a rule and review the client request, its handling and any impact that needs confirmation.",
  "conditionExample": "For example: revise the agreed homepage layout without adding pages or capabilities",
  "outcomeExample": "For example: record an in-scope revision and have the project lead confirm its scheduling"
}
```

The existing `panel.yaml` uses these strings through `$t:rules`, `$t:guidance`, and field hints. You change visible titles and guidance while reusing the same list, details, editing controls, and shared styles. Field keys and user records do not change when the language switches.

## 6. Prepare a preview example that shows the difference

Replace the copy's `reference/preview.json` with the complete synthetic example below. It is for preview only and does not become initial facts in any user project:

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

The example retains its Chinese business text across interface languages. The first rule is “Revision within the original delivery scope”: revising the agreed homepage layout without adding pages or business capabilities is recorded as an in-scope revision, with any schedule impact referred to the project lead. Its note marks the preview as synthetic and leaves boundaries to actual team agreements. The second is “Additional delivery scope”: pages or functions outside the agreed scope are recorded as changes for assessment, to be scheduled after scope and timing effects are confirmed. Its note says an unconfirmed request is not a team commitment.

## 7. Validate content before inspecting the result

Follow the [independent content-package validation example](extending.en.md#validate-an-independent-content-package), using the **target package root**, runtime name `business_rules`, and this `reference/preview.json`. Check that the returned Kit is `studio_delivery@0.1`, the Bundle catalog is `studio_scope_rules@1.0`, and the runtime name remains `business_rules`.

Also test rejection with an invalid example, such as changing `schema_version` to an unsupported value. The original example passing and the invalid example being rejected are content checks. You still need to inspect the actual Panel's title, two rules, Chinese/English copy, and field editing. This exercise has no script dependencies to install and adds no shared component.

### Inspect it in Studio

Connect the directory through the target host's supported complete-content-package entry point. Companion uses a [complete directory and shared state entry point](kit-sharing.en.md#create-a-new-project-with-a-complete-content-package); DSH uses [discovery and explicit selection](kit-sharing.en.md#dsh-directory-discovery-and-explicit-selection). This exercise passes the package root to the loader. If you instead use Studio source ZIP or folder import, follow the [source-import instructions](kit-sharing.en.md#share-through-studio-content-archives) to retain Kit and mounted Bundle files, and use the imported result's independent identity in later steps.

Confirm Studio is reading this independent source and identity, then open the Bundle's “面板预览” (Panel preview). You should see two project rules with the Chinese title “项目范围与变更规则” (Project scope and change rules), or the corresponding English locale title. Change one outcome's text and confirm that the view and field work. An example preview does not publish changes to a Design Project. If the old content still appears, check [source and refresh troubleshooting](troubleshooting.md#修改了-bundlestudio-仍显示旧内容).

If the target Host or installed version lacks Studio Panel preview, skip this item and inspect display and editing through an ordinary Design Panel in the independent new project in the next section. No switch of real projects or Host-configuration change is needed. Record checks actually completed: ordinary Panel use and Studio example preview verify different things.

## 8. Complete a real collaboration loop in a new project

Through the host's `yugoo` entry point, select `studio_delivery` for a new project, check the actual Kit identity and source, and ask:

```text
We agreed to deliver a homepage and a case-studies page. Today the client asked to
change the homepage layout and also proposed adding a member center.
Organize these two kinds of request into business rules we can discuss, without
deciding fees or promising delivery dates for us.
Show me the Panel first so I can add the actual agreements.
```

Check that the Agent uses the new Mindset and reads the copy's complete methods. A runtime implementing the current contract copies the complete Kit and mounted Bundles into the new project's `design_kit`. Inspect those project files rather than only the library list. In the resulting Panel, add “even in-scope revisions may affect already committed milestones,” save, close, and reopen to confirm that the change persists. Then ask the Agent to revise related rules based on that feedback.

This checks whether the Agent can generate results, retain human changes, and continue understanding and revising after saving. Record the host, content identities and existing source versions, and the content validation, preview, and collaboration steps actually completed for your own and recipients' reference.

When sharing, deliver the whole content package, original notices, applicable requests, and actual verification scope. Have another recipient check it through the [author/recipient checks](kit-sharing.en.md#minimum-checks-for-author-and-recipient). Saving library methods does not change existing projects. To update a project, ask the Agent to compare its files with the target content, preserve customizations, and use existing validation, saving, and Git workflows. Content import, project-file updates, npm publication, and `migrate` project migration serve different purposes; see [updates and recovery](kit-sharing.en.md#update-and-restore-project-content).

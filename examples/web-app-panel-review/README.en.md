# Loopline Delivery: a full Web App Panel review example

[中文](README.md)

These Yugoo Design examples support reading and editing all 15 Panels in the Web App Kit. The [Chinese source](zh-CN/) and [English source](en-US/) describe the same synthetic business: a six-person design studio receives additional customer feedback before Friday delivery and must distinguish small changes, added scope, lead commitments and notification delivery.

Both sources use corresponding record IDs, relationships and ordering. Multiple records, long explanations, an unanswered question, multiple choice, an attachment, disclosures, diagrams and details, and readable professional artifacts support detailed Panel review. Their counts describe this example’s coverage rather than requirements for other design projects.

## Migrate to your own working projects

The repository sources contain no `.git`. They are migration inputs and cannot be opened directly with `open`. Preserve them and copy each selected language directory to a new location outside the repository. For example, from the repository root:

```bash
mkdir -p "$HOME/Documents/YugooExamples"
cp -R examples/web-app-panel-review/zh-CN "$HOME/Documents/YugooExamples/loopline-review-zh"
cp -R examples/web-app-panel-review/en-US "$HOME/Documents/YugooExamples/loopline-review-en"
```

A file manager also works. If a target already exists, choose another directory rather than overwriting your edits.

Follow the [installation guide](../../docs/wiki/getting-started.en.md) to enable the plugin and current Web App Kit. Select a preparation project using that Kit, then give the host each copy’s absolute path and migrate them separately. For example, in DSH:

```text
/yugoo migrate /absolute/path/to/loopline-review-en
```

In a native host such as Codex, you can ask:

```text
Use Yugoo Design to migrate this directory into an independent Panel review project:
/absolute/path/to/loopline-review-en
First confirm that the selected project uses the current Web App Kit; create a preparation project and select that Kit if needed.
Preserve the source and read all its design files and artifacts. Do not generate model execution records or assessment results.
Open the new project after migration and start with Questions.
```

Migration uses the selected project’s Kit and creates the new project’s identity, version history and project-owned definitions. It does not copy source Git history or assessment records. Use `open` with the returned project ID or absolute path, then migrate the other language. Each working project saves edits independently. Selecting the host’s interface language and selecting a project’s content language are separate actions. See [project commands (Chinese)](../../docs/wiki/commands.md) and the [usage guide](../../docs/wiki/usage.en.md).

Flow artifacts use layout revision 13. If the installed Kit does not support it, update to a version that does or follow the [development guide (Chinese)](../../docs/wiki/development.md) to use current source. Do not change BPMN revision markers or `project.json` versions to bypass validation.

## Where to read all 15 Panels

Paths are relative to `design_files/` inside the selected language directory. Each directory’s same-named JSON file is the canonical Panel data. Diagrams and detail forms edit that same data.

| Panel / Bundle | Prepared content | Suggested review path |
| --- | --- | --- |
| Questions `smart_questions` | Two rounds and 14 questions, including two fixed settings, unanswered Q-010, multiple-choice Q-012 and a Markdown attachment on Q-002 | Expand long answers, inspect the attachment, edit choices and notes, and scroll to the end of round two |
| Research `research` | Two rounds, six directions, Markdown analyses and HTML conclusions | Switch rounds and directions, read findings and conclusions, and distinguish synthetic analysis from external verification |
| Functions `function_modules` | F-001–008 in six groups, including a rejected proposal and nested behavior, inputs, outputs, boundaries and exceptions | Expand F-002 and F-004, edit a long explanation, then return to the function list |
| AI capabilities `ai_agent_capabilities` | Two Agents, three Skills, three tools, two knowledge resources and one model-source declaration | Follow A-001’s collaboration and tool references, read method bodies, and inspect human adoption and access boundaries |
| Business flows `flow_design` | Actual BPMN for P-001 scope approval and return, and P-002 lead-reviewed retry of the same notification | Switch processes, zoom and fit, and inspect responsibilities, branches and return paths |
| Visual style `design_style` | Colors, typography, brand, icons and interaction patterns; `DESIGN.md`, `tokens.css`, `preview.html` | Read the specification and rendered preview; inspect long text, state feedback and form hierarchy |
| Business data `business_data` | Seven objects, 63 fields, 11 states and eight relationships | Open O-003’s detail from the diagram, reach its final field, then inspect the decision-to-delivery relationship |
| Business rules `business_rules` | BR-001–008: missing information, escalation, explicit decisions, separate delivery and isolation | Compare conditions and outcomes, edit one rule, and check its ID and order |
| Roles and access `role_access` | Four roles, eight policies and one inheritance relationship | Follow R-LEAD → R-DESIGNER, then inspect the conditional prohibition |
| Integrations `integration_design` | Attachment, notification and identity designs, with secret-purpose declarations only | Expand connections and secret entries and inspect recovery; addresses use invalid example domains |
| Notifications `notification_design` | Six notifications with recipients, channels, messages and action destinations | Compare N-005 with P-002; distinguish saved decisions, unclear receipts and resending |
| Quality and acceptance `quality_acceptance` | Ten observable criteria covering recovery, access and narrow-screen reading | Read conditions, criteria and verification methods; these are design criteria rather than test results |
| Pages `page_design` | PG-001–005, 15 connections and five complete HTML files; 18 inbox rows and 12 history rows | Map → detail → prototype; follow inbox, detail, lead review and history, checking scrolling and context |
| PRD assembly `web_app_prd_assembly` | `prd.html` with complete function specifications, object/rule tables, and figures and page snapshots generated by the owning scripts | Read one decision across Panels, scroll to the end, and check adjacent prose, figures and sources |
| Whiteboard `whiteboard` | Native Excalidraw scenes: WB-001 feedback/commitment boundaries and WB-002 AI suggestion handoff | Switch boards, zoom, inspect text/shapes/connectors, edit the working copy and reopen |

## A connected review route

Start with Q-003, Q-005, Q-007 and unanswered Q-010 to understand requests, commitments and delivery. Follow F-002 → BR-003 → P-001 → PG-003 for added-scope assessment, then BR-006 → P-002 → N-005 for failed-delivery recovery. R-LEAD’s explicit assignment, O-005’s decision and O-006’s delivery record should agree with those paths.

In a working copy, edit and save F-002’s long explanation. Visit another Panel, return, and reopen the project to check persistence. Open O-003’s detail from the business-data diagram, reach its last field, then return to its relationships. The page map should also support selecting a record, opening its detail and scrolling through it. Cancel an edit to check retention, then complete a save. Practice add/delete only on a newly created temporary record.

Page HTML represents the proposed product rather than Yugoo Design’s own Panels. Prototype search and submission feedback run only in the browser; there is no business backend, notification service or real membership change. To check Panel saving, navigation and reopening, edit canonical design fields in the host.

The designs show different stages and possible decisions in the same collaboration journey, rather than a simultaneous business-database snapshot. Only FB-042 in the inbox has a corresponding detail path. Other feedback supports reading and filtering without incorrectly linking every ID to the same detail.

Professional artifacts are included for independent reading: Research Markdown/HTML, BPMN, style specifications and preview, page HTML, the assembled PRD and native whiteboards. The PRD is derived from those designs. Change facts in the owning Panel before refreshing the PRD.

## Language correspondence and known limits

Business IDs such as F, BR, O, R, P and PG and their references correspond between languages; project identities are independent. Natural language, diagram labels, pages and documents are prepared per language. Attachments and research files have different digests because their actual bytes differ and cannot be interchanged.

The current Flow contract requires the built-in role `{id: "System", name: "系统"}` and recognizes automated lanes by the label “系统”. The English role cast and both BPMN files therefore retain this Chinese label; other English business text is translated. Related PRD flow snapshots retain it too. This example does not establish complete English interface localization, and does not hide the limit by changing a validator or treating an automated lane as human work.

The current English PRD’s native projections also show five Chinese structural labels: “功能范围图” (function scope map), “产品功能结构” (product function structure), “页面关系图” (page map), “主要导航” (primary navigation) and “关联跳转” (related navigation). “产品功能结构” is the missing-title fallback; the current Function canonical schema declares no separate title field. The other four labels are fixed generator text. Business names, page content and prose are English. Rewriting the figures by hand fails the owning projection check. Localization belongs in the shared generator.

## Content origin and scope

The business scenario, examples, analyses and criteria are manually prepared synthetic review material. P-001 retains the process structure and attribution of the existing delivery collaboration example; other content is prepared for this scenario. There is no real customer data, externally verified research, model invocation, sent notification, clarity assessment (UST), association graph (KAG) or design recommendation (GRA) result. Run those capabilities through the normal host workflow in your own project when needed.

`project.json` and `design_files/` retain migratable designs. They contain no host credentials, runtime environment, historical assessments or fabricated execution records. Prompts, Skills and tools in AI capabilities describe the proposed application; reading the example does not install or invoke them. The example includes an [Apache-2.0 license](en-US/LICENSE) and [attribution](en-US/NOTICE), with corresponding files in the Chinese directory.

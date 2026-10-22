# Yugoo Design

[简体中文](README.md) · English

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![DeepSeek Harness: preview](https://img.shields.io/badge/DeepSeek_Harness-preview-2563eb)](docs/wiki/hosts.md#deepseek-harness)
[![Codex CLI: preview](https://img.shields.io/badge/Codex_CLI-preview-2563eb)](docs/wiki/hosts.md#codex-cli)
[![Claude Code CLI: preview](https://img.shields.io/badge/Claude_Code_CLI-preview-2563eb)](docs/wiki/hosts.md#claude-code-cli)
[![Qoder CLI: preview](https://img.shields.io/badge/Qoder_CLI-preview-2563eb)](docs/wiki/hosts.md#qoder-cli)
[![千问办公 QwenWork: preview](https://img.shields.io/badge/%E5%8D%83%E9%97%AE%E5%8A%9E%E5%85%AC_QwenWork-preview-2563eb)](docs/wiki/hosts.md#千问办公-qwenwork)
[![WorkBuddy: preview](https://img.shields.io/badge/WorkBuddy-preview-2563eb)](docs/wiki/hosts.md#workbuddy)

**See your ideas. Shape the details.**

Yugoo Design (语构设计系统) is an open-source plugin for leading AI agent applications that adds interactive Design Panels to professional skills. AI helps develop a proposal; you examine the details and express your judgment through diagrams, tables, cards, and prototypes. Saved designs give you and AI a shared basis for the next discussion and revision.

![Yugoo Design concept: turn scattered ideas into coherent designs through interactive Panels, gap-driven collaboration, and KAG/GRA integration, with ongoing feedback and revision](docs/images/yugoo-design-concept.webp)

Start with the **Web App Kit**, included with the plugin by default, to design a complete software application, or customize Kits and panels for tasks such as developing game rules or designing a scheduling optimization model. See the [Kit list and installation guide (中文)](docs/wiki/kit-sharing.md#official-kits) for available Kits and how to load an independent Kit.

[Quick start](#quick-start) · [Why use it](#why-use-it) · [Core capabilities](#core-capabilities) · [Walkthrough](#a-complete-collaboration) · [Extend it](#start-with-software-design-then-extend-it) · [Wiki (中文)](docs/wiki/README.md) · [Contributing and feedback](#contributing-and-feedback)

## Quick start

You need **Node.js `>=22.19.0 <23`** and an Agent Host with a configured model. The plugin uses your host's existing model, conversation, and tools; see [getting started (中文)](docs/wiki/getting-started.md) for environment setup.

1. **Install the plugin.** Give the agent in your current host the [shared installation prompt](packages/companion/HOSTS.md#default-prompt-any-supported-host). Follow its instructions for authorization, import, activation, and any restart or new session.
2. **Create a Design Project.** Invoke the installed `yugoo` entry and ask:

   ```text
   Create a Design Project named studio-delivery using the Web App Kit.
   ```

   In DeepSeek Harness, you can also use `/yugoo new studio-delivery` and `/yugoo kit web_app`. Other hosts' entry points are in the [host guide (中文)](docs/wiki/hosts.md).
3. **Describe this round's goal.** For example:

   ```text
   We are a six-person design studio. Client requests and revision feedback
   are scattered across chats. I want a project delivery platform where AI
   organizes feedback and flags impacts, while we make the commitments.
   Help us think through what should happen when a client requests a change.
   ```

4. **Express your judgment in the Panel, then continue.** AI opens questions or design panels as needed. Edit and save, then ask: “Continue from the handling rules I just saved and explain which parts of the design they affect.” You can also request changes in conversation. Follow the [walkthrough (中文)](docs/wiki/web-app-demo.md) or consult the [usage guide (中文)](docs/wiki/usage.md).

This is a **beta preview, with the Web App Kit included by default**. See [preview status](docs/wiki/preview-status.md) for exact releases and verified scope, and the [command reference (中文)](docs/wiki/commands.md) for all `/yugoo` parameters.

Hosts such as Codex CLI, Claude Code CLI, and Qoder CLI use panels in a browser. **DeepSeek Harness (DSH) is currently the only desktop host that accommodates the full feature set and integrated interaction experience**, bringing conversation, panels, and Studio into one workspace. Feature support varies across other desktop hosts. Codex desktop integration is planned; Claude Code desktop has not been tested. Consult the [host guide (中文)](docs/wiki/hosts.md) when choosing a host.

## Why use it

Vibe Coding makes it increasingly easy to turn ideas into software. At the same time, understanding what you actually need, bringing individual features together into a complete system, and keeping that system consistent through later iterations become even more important. **Implementing features does not mean you have built the product you actually need.**

For example, suppose you want to build an internal expense reimbursement tool for your team. What information an expense report requires, whether it can be edited after submission, and how approvers are chosen must all follow your team's rules. If the approval process changes later, the existing forms, permissions, and workflows need to change with it. AI can propose solutions, but your input and judgment are needed to explain these realities and weigh the trade-offs.

Yugoo Design helps you work through these questions with AI: use design panels to understand proposals and refine details, then bring separate designs together into a consistent whole. As requirements change, you can keep discussing, checking, and revising the design together, so it remains a shared foundation for development, iteration, and maintenance.

Software application design is a starting point. The framework aims to support a broader form of **Human-in-the-loop (HITL)** collaboration: **helping people understand problems, think through choices, express their needs, and keep AI aligned with their intent.** With methods and panels for different domains, this approach can also extend to event planning, game mechanics, and operations research modeling. See the [product principles (中文)](docs/product-vision.md) for more background.

## Core capabilities

### Interactive design artifacts: from Skill to Bundle

Yugoo Design extends an Agent Skill into a **Bundle**, adding interactive panels, structured data validation, and execution controls to professional methods. Each Bundle focuses on one part of a design, such as an application's features, processes, rules, data, or pages, turning skill outputs into artifacts you can inspect, discuss, and edit.

Inspect relationships in a diagram, edit properties in a form, or explore pages through a prototype. The Panel and agent work with the same design data; validated, saved changes become the basis for further design. A Bundle can also declare whether to run in the main agent or a subagent, and when to hand control back to the user for input, edits, or confirmation, so its methods can take the appropriate role in the collaboration.

### Gap-driven Agent Loop

AI considers your goals, existing designs, and feedback to identify what is missing: do you need to understand how things work in practice, explore a proposal, or make a trade-off? These gaps lead to concrete actions—opening a Smart Questions panel, suggesting further research, or opening the relevant design panel. As information is added, proposals are revised, and people provide feedback, AI reassesses what to do next, taking the design further.

A **Kit** brings a set of Bundles together with a **domain prompt (Mindset)**, providing this loop with professional methods, criteria for judgment, and available tools. You can choose where to explore first, or let AI move ahead independently where the goals are clear. The process adapts as the design takes shape, without requiring a fixed workflow.

**Clarity assessment (U/S/T)** offers evidence-based signals for Understanding, Structure, and Testability, helping explain what still needs attention. Interpret these signals against the evidence and the current scope: they support discussion of the next step rather than serving as an objective completion rate, a workflow gate, or a ranking across Kits. See the [usage guide (中文)](docs/wiki/usage.md) and [assessment explanation (中文)](docs/ust-score-explanations.md).

### From details to a coherent whole: KAG and GRA

A process change can affect permissions, notifications, and pages. The **knowledge graph (KAG)** updates with design files, connecting their content and supporting evidence. **Proactive review (GRA)** examines the design from three perspectives and offers suggestions:

- **Grounding:** Check for contradictions or missed agreements across the design.
- **Reflection:** Identify uncertainties that need research or verification.
- **Alignment:** Raise questions that need your context or judgment.

Automatic GRA needs background execution that leaves the main conversation available. When background execution is unavailable or review would occupy the conversation, you can disable automatic GRA or explicitly choose a synchronous review for this occasion. Manual review remains available with automatic GRA disabled. See the [host guide (中文)](docs/wiki/hosts.md#后台能力与评审降级) for current support and limitations; U/S/T assessment and KAG operate independently.

Explore processes, rules, and prototypes in concrete scenarios to assess how the decisions work together. When it is time to hand off the work, assemble the separate designs into a **Product Requirements Document (PRD)** or other deliverable, retaining the original design sources.

### Projects you can return to

A **Design Project** keeps design files, related artifacts, and version history. Reopen it after a discussion to continue from existing work with AI. Ask, for example, “Show the latest changes and explain what changed in the process and rules.” Git history traces how the proposal took shape. The plugin includes its version-control runtime, so normal Design operations require no separate Git installation. See the [usage guide (中文)](docs/wiki/usage.md#4-管理与恢复) for history, migration of existing projects, and reconstruction from materials. The shared design can accumulate over time instead of living only in one conversation.

### Custom Kits and panels: tools that fit your field

Reuse, combine, or customize Kits and Bundles to adapt professional methods, output structures, and interactions to your field. Panels can be configured with **declarative UI** or, in supported hosts, generated by AI through **A2UI** using the component catalog. Both approaches share components and rendering capabilities. Extend the UI components or integrate a specialist editor when you need a different form of expression.

**Studio** provides entry points to inspect, manage, and customize these methods and panels, so you can keep refining and reusing them. See [Kit extension](#start-with-software-design-then-extend-it) to get started.

## A complete collaboration

Continue with the six-person studio from the quick start: turn its agreements for handling client change requests into the platform's processes, rules, permissions, and pages. In DeepSeek Harness, discuss the design with AI on the left and edit the corresponding Panel on the right. Open Studio when you want to customize a Kit.

> This example uses a fictional studio's business data to show actual conversations and Panel interactions, not one-click generation of a complete specification. The PRD follows the official template but remains a draft with open questions to discuss. See the [host guide (中文)](docs/wiki/hosts.md) for Panel and review support in each host.

In DeepSeek Harness, create a project and manually activate the Web App Kit:

```text
/yugoo new studio-delivery
/yugoo kit web_app
```

You can also describe your goal first and let the agent select a suitable Kit using the existing design. Other hosts use their own `yugoo` skill or tool entry; see the [host guide (中文)](docs/wiki/hosts.md).

### 1. Confirm the important context in a panel

After you describe the studio from the quick start, AI can open the **Smart Questions panel**, presenting questions that matter to the current proposal as answerable cards. You explain how your team works: **designers can discuss requests with clients; the project lead approves additional scope and delivery dates.**

Once you save, AI suggests: “Let's map a client's change request through to scheduling the work, showing who records feedback, assesses scope, and makes commitments.”

![Read Smart Questions beside the conversation, zoom into details, and edit supporting context](docs/images/readme-smart-questions.gif)

### 2. See the process, then add real-world context

AI opens the **business process panel**. A swimlane diagram separates the client, designer, and project lead, showing feedback capture, scope comparison, impact assessment, and confirmation of the work.

Seeing every revision go through the lead, you add: “Designers can handle layout revisions within the agreed scope directly. New pages or capabilities need a scope discussion.” AI revises the branches. You discuss, edit, and save alongside the Panel, bringing the team's real working practices into the design.

![Discuss the proposal beside a swimlane process distinguishing direct changes from those needing the project lead's confirmation](docs/images/readme-flow.png)

### 3. Check earlier decisions against the current design

In a host that supports GRA, developing the design might lead to a **design suggestion** like this:

> Designers can handle in-scope revisions directly, while the lead approves delivery dates. What happens when many in-scope revisions affect a milestone already promised to the client?

You decide: “Assess scope and timing separately. Any impact on a promised milestone needs the lead to confirm the plan again.” Ask AI to revise the relevant rules and process, then inspect the panels. Reviewing the relationships helps you articulate a choice you had not expressed separately before.

![Expand design suggestions beside the conversation and compare them with the business process](docs/images/readme-design-advice.png)

### 4. Develop other parts as needed

Next, you might design the data relationships between feedback, deliverables, and changes; client and team permissions; and pages for inspecting impacts and confirming plans. Open the **AI capabilities panel** to define how the application's AI organizes feedback and drafts impact notes, which Skills and tools it needs, and which commitments remain human decisions.

Each part has its own panel, and KAG helps you find their relationships. Choose the next activity around what you currently need to understand or decide.

![Browse the same project's object relationship canvas, object details, and business rules](docs/images/readme-design-views.gif)

### 5. Bring the design together in a PRD

When this round of design is clear, you ask: “Assemble the current design into a PRD, keeping the supporting sources and unresolved questions.” AI opens the **PRD panel**, organizing existing requirements, processes, pages, permissions, and AI capabilities. Browse the outline and trace the sources; if something needs to change, return to its panel.

For implementation, prepare a spec for the particular task and the development project's conventions, linking the relevant design evidence. Follow the [complete tutorial (中文)](docs/wiki/web-app-demo.md), read the [design-to-development handoff (中文)](docs/design-development-handoff.md), or explore [non-Web Kit examples (中文)](docs/wiki/non-web-kit-demo.md).

![Read the PRD draft's formal chapters beside the conversation, retaining design sources and unresolved content](docs/images/readme-prd.png)

In a research collaboration, you can discuss the work with AI while using design suggestions to refine the process. The example below shows conversation and Panel side by side; see the [interface overview (中文)](docs/wiki/usage.md#7-界面概览) for more page-map and PRD examples.

![Conversation, design suggestions, and a business process panel in DeepSeek Harness](docs/images/design-panel-process.png)

## Start with software design, then extend it

The official **Web App Kit** covers requirements clarification, research, feature planning, and the design of business processes, rules, data, permissions, pages, and acceptance criteria. It also helps plan an application's **AI capabilities**: the AI's responsibilities, how it interacts with people, and the prompts, Skills, and tools it needs. Explore the [Mindset](packages/skills-web-app/kits/web_app/mindset.md) and [Bundle mount list](packages/skills-web-app/kits/web_app/kit.yaml) for the methods and scope.

The shared framework's panels, feedback, and design integration capabilities can be extended with methods for other domains: developing a game's actions, resources, and win conditions, or turning staffing needs, night-shift limits, and fairness trade-offs into an operations research model for scheduling. These are possible customizations, not Kits included by default. See the [official Kit list (中文)](docs/wiki/kit-sharing.md#official-kits) for current availability and installation options.

Start by reusing a professional method you know, define its structured output and interactive panel, and try it on a small example. Combine it with related Bundles and a domain Mindset to form a Kit. Panels can use question cards, tables, diagrams, prototypes, or whiteboards; extensions can also integrate specialist editors and UI components. Use **Studio** to inspect methods and source files, then customize and preview a working copy. Follow the [sharing guide (中文)](docs/wiki/kit-sharing.md#作者与接收者的最小验证) to check and deliver the Kit. See the [Studio walkthrough (中文)](docs/wiki/usage.md#6-studio查看定制和检验套件) for instructions and host support.

![Read the Web App Mindset and browse mounted Bundles in the complete Studio page](docs/images/readme-studio.gif)

| What you want to do | Start here |
| --- | --- |
| Organize domain methods and Kits | [Kit Creator](.agents/skills/design-kit-creator/SKILL.md) · [Extension guide (中文)](docs/wiki/extending.md) |
| Create Bundles and write professional methods | [Bundle Creator](.agents/skills/design-bundle-creator/SKILL.md) · [Skill Creator](.agents/skills/design-skill-creator/SKILL.md) · [Bundle contract](docs/bundle-contract.md) |
| Configure or extend interactive panels | [Panel authoring](.agents/skills/design-bundle-creator/references/panel-authoring.md) · [Panel DSL](docs/dsl-spec.md) |
| Try and share your work | [Kit sharing and recovery (中文)](docs/wiki/kit-sharing.md) · [Community workshop example](examples/community-workshop-delivery/README.md) |

## Documentation and development

| Entry | What it covers |
| --- | --- |
| [Documentation overview (中文)](docs/README.md) | Entry points for usage, Kit authoring, architecture, and technical reference |
| [Wiki (中文)](docs/wiki/README.md) | Installation, usage, host compatibility, and troubleshooting |
| [Core concepts (中文)](docs/wiki/concepts.md) · [Terminology (中文)](docs/wiki/terminology.md) | Projects, Kits, Bundles, panels, and bilingual naming |
| [Product principles (中文)](docs/product-vision.md) | Professional methods, human–AI alignment, and interaction principles |
| [Development guide (中文)](docs/wiki/development.md) · [Architecture baseline](docs/system-design-baseline.md) | Source setup, layer responsibilities, and verification |
| [Preview status](docs/wiki/preview-status.md) | Versions, supported features, and known limitations |

Before changing the project, read [AGENTS.md](AGENTS.md) and the [contribution guide](CONTRIBUTING.md).

## Contributing and feedback

Contributions of code, professional methods, Kits, documentation, translations, and examples are welcome. We would also like to hear about design tasks in your field. See the [contribution guide](CONTRIBUTING.md).

When reporting an issue, include the version, steps, expected result, and actual result; see the [feedback guide (中文)](docs/wiki/support.md). Contact: [yangjianfeng.yjf@alibaba-inc.com](mailto:yangjianfeng.yjf@alibaba-inc.com). Follow the [security reporting policy](SECURITY.md) for sensitive information or security issues.

## License and attribution

Maintained by **YugooDesign Team**. Project-owned code and documentation are licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE) for attribution. Third-party components retain their own licenses and required notices; see [third-party notices](THIRD_PARTY_NOTICES.md).

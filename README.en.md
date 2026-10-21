# Yugoo Design

**See your ideas. Shape the details.**

[简体中文](README.md) · English

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![DeepSeek Harness: preview](https://img.shields.io/badge/DeepSeek_Harness-preview-2563eb)](docs/wiki/hosts.md#deepseek-harness)
[![Codex CLI: preview](https://img.shields.io/badge/Codex_CLI-preview-2563eb)](docs/wiki/hosts.md#codex-cli)
[![Claude Code CLI: preview](https://img.shields.io/badge/Claude_Code_CLI-preview-2563eb)](docs/wiki/hosts.md#claude-code-cli)
[![Qoder CLI: preview](https://img.shields.io/badge/Qoder_CLI-preview-2563eb)](docs/wiki/hosts.md#qoder-cli)
[![千问办公 QwenWork: preview](https://img.shields.io/badge/%E5%8D%83%E9%97%AE%E5%8A%9E%E5%85%AC_QwenWork-preview-2563eb)](docs/wiki/hosts.md#千问办公-qwenwork)
[![WorkBuddy: preview](https://img.shields.io/badge/WorkBuddy-preview-2563eb)](docs/wiki/hosts.md#workbuddy)

Yugoo Design (语构设计系统) is an open-source plugin for leading AI agent applications that adds interactive Design Panels to professional skills. AI helps develop a proposal; you examine the details and express your judgment through diagrams, tables, cards, and prototypes. Saved designs give you and AI a shared basis for the next discussion and revision.

![Yugoo Design concept: turn scattered ideas into coherent designs through interactive Panels, gap-driven collaboration, and KAG/GRA integration, with ongoing feedback and revision](docs/images/yugoo-design-concept.webp)

Start with the **Web App Kit**, included with the plugin by default, to design a complete software application, or customize Kits and panels for tasks such as developing game rules or designing a scheduling optimization model. The [official Kit list and acquisition guide (中文)](docs/wiki/kit-sharing.md#official-kits) describe other Kits and their actual integration scope.

[Quick start](#quick-start) · [Why use it](#why-use-it) · [Core capabilities](#core-capabilities) · [Walkthrough](#a-complete-collaboration) · [Extend it](#start-with-software-design-then-extend-it) · [Wiki (中文)](docs/wiki/README.md) · [Contributing and feedback](#contributing-and-feedback)

## Quick start

**Requirements:** The current npm preview requires Node.js `>=22.19.0 <23` and a compatible agent host with a configured generative model. KAG's local text embeddings run on CPU, with no GPU required; see the [installation guide](docs/wiki/getting-started.md) for dependencies and model preparation. The versioning runtime is bundled, so normal Design operations need no separate Git installation; see [preview status](docs/wiki/preview-status.md) for platform and tested scope.

> **Release preview:** The most recently recorded public version is `@yugoo-design/companion@0.1.0-beta.3` (2026-10-17 UTC). Web App is the current default Kit. Historical npm releases, later local candidates, and per-host acceptance are recorded separately in [preview status](docs/wiki/preview-status.md). Resolve the selected channel to an exact version and follow its bundled instructions; see [host compatibility](docs/wiki/hosts.md) for integration scope.

1. **Ask the agent in your current host to install the plugin.** Copy the [shared installation prompt](packages/companion/HOSTS.md#default-prompt-any-supported-host). The agent acquires an exact npm version and installs the components needed by your host; you do not install DSH and Companion separately. Supply only a missing host choice or a required human authorization, import, or activation step. Follow any required restart or new-session instruction. See the [installation guide](docs/wiki/getting-started.md) for prerequisites, host-specific entries, and the manual fallback.
2. **Create or open a design project and describe your goal.** Start from your host's installed `yugoo` entry. For example:

   ```text
   We are a six-person design studio. Client requests and revision feedback
   are scattered across chats. I want a project delivery platform where AI
   organizes feedback and flags impacts, while we make the commitments.
   Help us think through what should happen when a client requests a change.
   ```

3. **Inspect the Panel, give feedback, and save.** Change editable content in the Panel or ask for revisions in conversation. Save, then ask AI to continue from those changes. See the [usage guide](docs/wiki/usage.md) for the full workflow.

The plugin uses your host's existing generative model, conversation, and tools. Integrations include Codex CLI, Claude Code CLI, and Qoder CLI, with coverage continuing to expand. Hosts with customizable interfaces, such as **DeepSeek Harness**, can bring the conversation, panels, and **Studio** into one workspace; other hosts use panels in a browser. **Among desktop hosts, only DeepSeek Harness (DSH) can currently accommodate the full feature set and integrated interaction experience**; other desktop integrations retain their individually verified scope. ChatGPT desktop app integration in Codex mode is a second-round development goal; Claude Code desktop has not been tested. See the [host guide](docs/wiki/hosts.md) for versions and capabilities.

## Why use it

Vibe Coding makes it increasingly easy to turn ideas into software. At the same time, understanding what you actually need, bringing individual features together into a complete system, and keeping that system consistent through later iterations become even more important. **Implementing features does not mean you have built the product you actually need.**

For example, suppose you want to build an internal expense reimbursement tool for your team. What information an expense report requires, whether it can be edited after submission, and how approvers are chosen must all follow your team's rules. If the approval process changes later, the existing forms, permissions, and workflows need to change with it. AI can propose solutions, but your input and judgment are needed to explain these realities and weigh the trade-offs.

Yugoo Design helps you work through these questions with AI: use design panels to understand proposals and refine details, then bring separate designs together into a consistent whole. As requirements change, you can keep discussing, checking, and revising the design together, so it remains a shared foundation for development, iteration, and maintenance.

Software application design is a starting point. The framework aims to support a broader form of **Human-in-the-loop (HITL)** collaboration: **helping people understand problems, think through choices, express their needs, and keep AI aligned with their intent.** With methods and panels for different domains, this approach can also extend to event planning, game mechanics, and operations research modeling. See the [product principles](docs/product-vision.md) for more background.

## Core capabilities

### Interactive design artifacts: from Skill to Bundle

Yugoo Design extends an Agent Skill into a **Bundle**, adding interactive panels, structured data validation, and execution controls to professional methods. Each Bundle focuses on one part of a design, such as an application's features, processes, rules, data, or pages, turning skill outputs into artifacts you can inspect, discuss, and edit.

Inspect relationships in a diagram, edit properties in a form, or explore pages through a prototype. The Panel and agent work with the same design data; validated, saved changes become the basis for further design. A Bundle can also declare whether to run in the main agent or a subagent, and when to hand control back to the user for input, edits, or confirmation, so its methods can take the appropriate role in the collaboration.

### Gap-driven Agent Loop

AI considers your goals, existing designs, and feedback to identify what is missing: do you need to understand how things work in practice, explore a proposal, or make a trade-off? These gaps lead to concrete actions—opening a Smart Questions panel, suggesting further research, or opening the relevant design panel. As information is added, proposals are revised, and people provide feedback, AI reassesses what to do next, taking the design further.

A **Kit** brings a set of Bundles together with a **domain prompt (Mindset)**, providing this loop with professional methods, criteria for judgment, and available tools. You can choose where to explore first, or let AI move ahead independently where the goals are clear. The process adapts as the design takes shape, without requiring a fixed workflow.

### From details to a coherent whole: KAG and GRA

A process change can affect permissions, notifications, and pages. The **knowledge graph (KAG)** updates with design files, connecting their content and supporting evidence. **Proactive review (GRA)** examines the design from three perspectives and offers suggestions:

- **Grounding:** Check for contradictions or missed agreements across the design.
- **Reflection:** Identify uncertainties that need research or verification.
- **Alignment:** Raise questions that need your context or judgment.

Automatic GRA needs background execution that leaves the main conversation available. The inspected QwenWork `1.3.2` desktop build disables background Agents; in a reported WorkBuddy `5.8.3` run, native asynchronous review still occupied the main conversation. In either case, the shared implementation asks you to choose between disabling automatic GRA and running this review synchronously in the main conversation, which will occupy it. Manual review remains available when automatic GRA is off. **One user-confirmed foreground G/R/A review has passed in QwenWork's local beta.18 candidate; the corresponding WorkBuddy flow and background capability remain separate acceptance items.** U/S/T assessment and KAG remain independent. See the [exact candidate, method and scope](docs/wiki/hosts.md#后台能力与评审降级).

Explore processes, rules, and prototypes in concrete scenarios to assess how the decisions work together. When it is time to hand off the work, assemble the separate designs into a **Product Requirements Document (PRD)** or other deliverable, retaining the original design sources.

### Projects you can return to

A **Design Project** keeps design files, related artifacts, and version history. Reopen it after a discussion to continue from existing work with AI. Use Git history to trace changes and understand how the proposal took shape. The shared design can accumulate over time instead of living only in a single conversation.

### Custom Kits and panels: tools that fit your field

Reuse, combine, or customize Kits and Bundles to adapt professional methods, output structures, and interactions to your field. Panels can be configured with **declarative UI** or, in supported hosts, generated by AI through **A2UI** using the component catalog. Both approaches share components and rendering capabilities. Extend the UI components or integrate a specialist editor when you need a different form of expression.

**Studio** provides entry points to inspect, manage, and customize these methods and panels, so you can keep refining and reusing them. See [Kit extension](#start-with-software-design-then-extend-it) to get started.

## A complete collaboration

This existing research-collaboration example shows the DeepSeek Harness interface: conversation and design suggestions on the left, a business process on the right. You can discuss a proposal while looking at the design itself.

![Conversation, design suggestions, and a business process panel in DeepSeek Harness](docs/images/design-panel-process.png)

*The screenshot above retains the conversation-and-Panel context of an earlier version. See the [interface overview](docs/wiki/usage.md#7-界面概览) for the page map and PRD panels. The screenshots and short GIFs below show a synthetic studio project-delivery example in the current shared Panel and Studio interfaces.*

> **Demo scope:** The example data, review suggestion, and PRD are prepared for demonstration in an isolated local project. The GIFs show interface interactions; see the [host guide](docs/wiki/hosts.md) for generation, saved-edit continuation, and background-review support.

These commands match the current DeepSeek Harness source. Follow bundled help on older installations, where `mindset` is the old spelling. Create a project and manually activate the Web App Kit:

```text
/yugoo new studio-delivery
/yugoo kit web_app
```

You can also describe your goal first and let the agent select a suitable Kit using the existing design. Other hosts use their own `yugoo` skill or tool entry; see the [host guide](docs/wiki/hosts.md).

### 1. Confirm the important context in a panel

After you describe the studio from the quick start, AI can open the **Smart Questions panel**, presenting questions that matter to the current proposal as answerable cards. You explain how your team works: **designers can discuss requests with clients; the project lead approves additional scope and delivery dates.**

Once you save, AI suggests: “Let's map a client's change request through to scheduling the work, showing who records feedback, assesses scope, and makes commitments.”

![Read answers and edit supporting context in Smart Questions](docs/images/readme-smart-questions.gif)

### 2. See the process, then add real-world context

AI opens the **business process panel**. A swimlane diagram separates the client, designer, and project lead, showing feedback capture, scope comparison, impact assessment, and confirmation of the work.

Seeing every revision go through the lead, you add: “Designers can handle layout revisions within the agreed scope directly. New pages or capabilities need a scope discussion.” AI revises the branches. You discuss, edit, and save alongside the Panel, bringing the team's real working practices into the design.

![A swimlane process distinguishes direct changes from those needing the project lead's confirmation](docs/images/readme-flow.png)

### 3. Check earlier decisions against the current design

In a host that supports GRA, developing the design might lead to a **design suggestion** like this:

> Designers can handle in-scope revisions directly, while the lead approves delivery dates. What happens when many in-scope revisions affect a milestone already promised to the client?

You decide: “Assess scope and timing separately. Any impact on a promised milestone needs the lead to confirm the plan again.” Ask AI to revise the relevant rules and process, then inspect the panels. Reviewing the relationships helps you articulate a choice you had not expressed separately before.

![Expand a design suggestion about in-scope changes and delivery commitments](docs/images/readme-design-advice.png)

### 4. Develop other parts as needed

Next, you might design the data relationships between feedback, deliverables, and changes; client and team permissions; and pages for inspecting impacts and confirming plans. Open the **AI capabilities panel** to define how the application's AI organizes feedback and drafts impact notes, which Skills and tools it needs, and which commitments remain human decisions.

Each part has its own panel, and KAG helps you find their relationships. Choose the next activity around what you currently need to understand or decide.

![Browse the same project's object relationship canvas, object details, and business rules](docs/images/readme-design-views.gif)

### 5. Bring the design together in a PRD

When this round of design is clear, you ask: “Assemble the current design into a PRD, keeping the supporting sources and unresolved questions.” AI opens the **PRD panel**, organizing existing requirements, processes, pages, permissions, and AI capabilities. Browse the outline and trace the sources; if something needs to change, return to its panel.

For implementation, prepare a spec for the particular task and the development project's conventions, linking the relevant design evidence. Follow the [complete tutorial (中文)](docs/wiki/web-app-demo.md), read the [design-to-development handoff](docs/design-development-handoff.md), or explore the recorded [non-Web Kit examples](docs/wiki/non-web-kit-demo.md).

![Read the PRD outline and its question, process, and business-rule source labels](docs/images/readme-prd.png)

## Start with software design, then extend it

The official **Web App Kit** covers requirements clarification, research, feature planning, and the design of business processes, rules, data, permissions, pages, and acceptance criteria. It also helps plan an application's **AI capabilities**: the AI's responsibilities, how it interacts with people, and the prompts, Skills, and tools it needs. Explore the [Mindset](packages/skills-web-app/kits/web_app/mindset.md) and [Bundle mount list](packages/skills-web-app/kits/web_app/kit.yaml) for the methods and scope.

The shared framework's panels, feedback, and design integration capabilities can be extended with methods for other domains: developing a game's actions, resources, and win conditions, or turning staffing needs, night-shift limits, and fairness trade-offs into an operations research model for scheduling. Game design remains an extension direction. The **Decision Modeling Kit** is currently for internal validation, excluded from the default product distribution and public source export. See the [official Kit list (中文)](docs/wiki/kit-sharing.md#official-kits) for the default Kit and guidance on loading independent Kits.

Start by reusing a professional method you know, define its structured output and interactive panel, and try it on a small example. Combine it with related Bundles and a domain Mindset to form a Kit. Panels can use question cards, tables, diagrams, prototypes, or whiteboards; extensions can also integrate specialist editors and UI components. **Studio** provides an entry point to inspect and manage methods and source files, and customize working copies. Available authoring capabilities depend on the installed version; follow the [Studio walkthrough](docs/wiki/usage.md#6-studio查看定制和检验套件) and complete the [author and recipient checks](docs/wiki/kit-sharing.md#作者与接收者的最小验证) before sharing.

![Browse a Kit, its Mindset and Bundles, Panel previews, and the component catalog in Studio](docs/images/readme-studio.gif)

| What you want to do | Start here |
| --- | --- |
| Organize domain methods and Kits | [Kit Creator](.agents/skills/design-kit-creator/SKILL.md) · [Extension guide](docs/wiki/extending.md) |
| Create Bundles and write professional methods | [Bundle Creator](.agents/skills/design-bundle-creator/SKILL.md) · [Skill Creator](.agents/skills/design-skill-creator/SKILL.md) · [Bundle contract](docs/bundle-contract.md) |
| Configure or extend interactive panels | [Panel authoring](.agents/skills/design-bundle-creator/references/panel-authoring.md) · [Panel DSL](docs/dsl-spec.md) |
| Try and share your work | [Kit sharing and recovery](docs/wiki/kit-sharing.md) · [Community workshop example](examples/community-workshop-delivery/README.md) |

## Documentation and development

| Entry | What it covers |
| --- | --- |
| [Wiki (中文)](docs/wiki/README.md) | Installation, usage, host compatibility, and troubleshooting |
| [Core concepts](docs/wiki/concepts.md) · [Terminology](docs/wiki/terminology.md) | Projects, Kits, Bundles, panels, and bilingual naming |
| [Product principles](docs/product-vision.md) | Professional methods, human–AI alignment, and interaction principles |
| [Development guide](docs/wiki/development.md) · [Architecture baseline](docs/system-design-baseline.md) | Source setup, layer responsibilities, and verification |
| [Preview status](docs/wiki/preview-status.md) | Candidate identity and verification scope |

Before changing the project, read [AGENTS.md](AGENTS.md) and the [contribution guide](CONTRIBUTING.md).

## Contributing and feedback

Contributions of code, professional methods, Kits, documentation, translations, and examples are welcome. We would also like to hear about design tasks in your field. See the [contribution guide](CONTRIBUTING.md).

When reporting an issue, include the version, steps, expected result, and actual result; see the [feedback guide](docs/wiki/support.md). Contact: [yangjianfeng.yjf@alibaba-inc.com](mailto:yangjianfeng.yjf@alibaba-inc.com). Follow the [security reporting policy](SECURITY.md) for sensitive information or security issues.

## License and attribution

Maintained by **YugooDesign Team**. Project-owned code and documentation are licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE) for attribution. Third-party components retain their own licenses and required notices; see [third-party notices](THIRD_PARTY_NOTICES.md).

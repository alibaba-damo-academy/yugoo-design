# Using the official Design Kits

[简体中文](official-kits.md) · English

Yugoo Design organizes a field's methods and Bundles into a Kit. This guide helps you choose where to start, what to examine in a Panel, and when the current work is ready to hand off. The [official Kit list](kit-sharing.en.md#official-kits) maintains versions, acquisition routes and what is included. Start with [getting started](getting-started.en.md) for installation.

| What you want to do | Kit or example | Main outputs |
| --- | --- | --- |
| Design how software should work, including its AI capabilities | Web App Kit | Features, flows, rules, data, access, prototypes and an assembled Product Requirements Document (PRD) |
| Explore methods and Panels outside software design | [Public non-Web examples](non-web-kit-demo.md#从公开示例开始) | Community workshop delivery and field-operations risk records; load them independently using the sharing guide |

A Design Project uses a Kit's complete files and retains their provenance. Library updates do not automatically replace the project's definitions. Its Bundles are capabilities to use as needed; the questions below are not a mandatory sequence.

## Web App: from a business idea to an application you can discuss and implement

Consider a six-person client delivery team. Requests and feedback are scattered across chats, and changes often affect delivery. You want a collaboration platform where AI organizes feedback and flags impacts, while the project lead decides scope and dates.

Start with the facts you know: who uses it, where work goes wrong, and what you want to improve this time. Give the host Agent existing documents, screenshots or prototypes when helpful. Unknowns can remain explicit; you do not need a complete PRD before starting.

### Choose an activity from the current question

| What needs to become clear | Capability | What to judge in the result |
| --- | --- | --- |
| Goals, users and the first release's boundaries | Smart Questions `smart_questions`, Research `research` | Which facts are supported, which assumptions need checking, and what is outside this round |
| What the application does and what matters first | Function Modules `function_modules` | Whether feedback, scope confirmation and delivery review are useful capabilities, including important exceptions |
| How a request moves through people and systems | Business Flows `flow_design` | Who acts or confirms, which conditions select a branch, and how work continues after an exception |
| What the system remembers and how it makes decisions | Business Objects `business_data`, Business Rules `business_rules` | Relationships between feedback, deliverables and changes, and the rules that determine behavior |
| Who can see, change or commit to what | Roles and Access `role_access` | Operations and visibility for clients, designers and project leads |
| How AI participates in the application | AI Capabilities `ai_agent_capabilities` | Responsibilities, inputs and outputs, full prompts, Skills, tools and cooperation; which decisions remain human |
| How external services connect and people receive notices | System Integration `integration_design`, Notification Design `notification_design` | Connections, exchanged information, failure handling, notification moments and recipients |
| What users see and operate | Design Style `design_style`, Page Design `page_design` | Visual direction, page relationships, controls and prototype paths that fit the work |
| How to check and hand off the design | Acceptance Criteria `quality_acceptance`, Assembled PRD `web_app_prd_assembly` | Observable acceptance conditions and an assembly faithful to the source design |
| How to explore an idea together | Whiteboards `whiteboard` | Whether shapes, text and connections help explain and examine the question |

Design Panels present these outputs as diagrams, cards, forms, tables or prototypes. Editable diagrams and details share the same data. The Agent maintains a business process diagram's structure; use node details to supplement activities, conditions and failure handling. Edit definite facts directly, and use conversation to explain, compare or coordinate a change across designs.

### A useful first request

```text
We are a six-person client delivery team. Client requests and revision feedback
are scattered across chats. I want a delivery platform where AI organizes
feedback and flags impacts, while the project lead decides scope and dates.
Start with a process for one client change request that we can discuss.
Use concrete situations to ask about decisions I actually need to make.
Leave contracts, billing and finance outside this round.
```

Follow the [client-project walkthrough](web-app-demo.en.md) for the complete exercise. You can also request a feature, data model or specific page directly; a clear result request does not require a full interview first.

### When this round is ready to finish

When you can understand and judge the relevant operations, rules and important exceptions, organize the current design, unresolved questions and sources. A PRD assembles existing designs. When an implementation task needs more precision, prepare a task-level spec using the [design-to-development handoff guide](../design-development-handoff.md). An interactive prototype does not mean the business service is implemented, and design work does not require filling every Panel.

Read the methods in the [Web App Mindset](../../packages/skills-web-app/kits/web_app/mindset.md) and [Bundle mount list](../../packages/skills-web-app/kits/web_app/kit.yaml). The [content-package README](../../packages/skills-web-app/README.md) explains dependencies and distribution.

### Explore independent public examples

Beyond the included Web App Kit, inspect the [community workshop delivery Kit](../../examples/community-workshop-delivery/README.md) and [field-operations Kit](../../examples/field-operations-shared/README.md). They combine independent domain methods, structured records and shared Panels. See [Kit sharing and recovery](kit-sharing.en.md) for directory adoption, host loading, actual use and updates. Each example retains its own verification scope.

## Continue designing, or customize the methods

Editing a Panel changes your design results. To change the guidance, output structure or Panel for future projects, customize a Kit or Bundle. Start with the [minimal customization tutorial](custom-kit-tutorial.en.md), use the [Studio guide](usage.en.md#6-studio-inspect-customize-and-check-kits) for editing and storage, and check the [sharing guide](kit-sharing.en.md) before handing it to someone else.

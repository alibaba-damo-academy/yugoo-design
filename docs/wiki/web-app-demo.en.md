# Web App collaboration tutorial: a customer project delivery platform

English · [简体中文](web-app-demo.md)

Follow a six-person project delivery team's practice exercise and use Yugoo Design to turn a business idea into a design you can discuss, edit and develop further. The example uses a synthetic business situation. Screenshots show actual Chinese-language conversations and Design Panels in DeepSeek Harness; animations include close-up views. The conversation and results are practice references. See the [host guide](hosts.en.md) for operations actually available.

Start with one round of collaboration: **discuss the goal → understand and edit using the Panel → save and let AI continue from your revised decisions**. Expand page maps, UI prototypes, research, scenario experiences and the PRD when needed. The sections below follow different questions; you do not need to complete every part in order.

To begin with existing content, copy the [customer project delivery example project](../../examples/design-team-delivery/README.md) outside the repository, then migrate it into your own Design Project.

## Prepare: open a project and explain the situation

Follow [getting started](getting-started.en.md) to install and enable the plugin. Current project entry points in DeepSeek Harness include:

```text
/yugoo new design-team-delivery
/yugoo kit web_app
```

In other hosts, use the installed `yugoo` skill or project-tool entry point and request, "Create a Design Project named design-team-delivery using the Web App Kit." See the [command reference](commands.md) for all parameters. After selecting the Web App Kit, state the goal like this:

```text
We are a six-person project delivery team serving several customers at once.
Requirements and change requests are all in chat, and we often discover late in the work
that the scope has changed. I want to design a project delivery platform:
AI organizes feedback and flags impacts, while we still make the key commitments.
First help me think through how a customer change request should be handled
and develop a design we can discuss.
Leave contract billing and financial management out of this round.
```

If you already have delivery lists or customer feedback, remove private information and give the materials to the host Agent. Leave unclear agreements as unknowns and start from what you know.

## 1. Add key context in the questions Panel

When missing context would affect the design, AI can open the Smart Questions Panel. Question cards should help you understand concrete choices, for example:

| What needs to be understood now | Answer in the exercise | Effect on the design |
| --- | --- | --- |
| After a customer requests a change, who decides whether it is outside scope? | Designers can discuss and record it; the project lead confirms additions to scope. | Customer feedback and formal scope confirmation need to be distinguished. |
| Who can commit to a delivery date? | The project lead. | Both AI and designers need to bring relevant impacts to the lead for a decision. |
| Is there already a clear delivery list? | Usually there is a page list, but details continue to be discussed during design. | Retain the original delivery basis and allow gradual clarification. |

Select or add answers in the Panel, save and continue. If the context is already clear, you can ask for a flow directly without completing a questionnaire first.

A reasonable next-step suggestion would be: "First map the path from a customer's change request to scheduling the work, separating feedback recording, scope assessment and delivery-date confirmation. This will make it clear who decides what, and where."

![Inspect and edit Smart Questions in the full conversation workspace, then zoom in to read the reasons for the three U/S/T dimensions](../images/readme-smart-questions.gif)

## 2. Use feature cards to find this round's scope

If you are unsure which capabilities the platform needs, start with the feature-module Panel. For this goal, discuss collecting customer feedback, recording delivery scope, handling changes and reviewing deliveries; leave financial management for later.

Read each card's situation, behavior, inputs and results. Identify what addresses a real problem and what is unnecessary for now. You might ask:

```text
Keep feedback recording, scope comparison and change confirmation for now.
We do not need automatic scheduling for the whole team yet, but we need to see
which delivery milestone a change would affect.
Use this scope to develop the customer change-request flow.
```

This choice narrows the design scope. The next step develops a specific operation rather than asking AI to detail every module at once.

## 3. Use the flow to express how your team actually works

AI opens the business-flow Panel, using swimlanes to distinguish the customer, designer, project lead and system. An initial proposal may show feedback recording, delivery-scope comparison, impact assessment, arrangement confirmation, customer notification and implementation of the change.

The example's P-001 uses vertical swimlanes. First read the whole flow to understand the path from customer feedback to the system's record of the decision. Then zoom into the branches for direct handling and project-lead confirmation to check how scope and delivery-date impacts are assessed separately.

If the initial proposal sends every change to the project lead, add the real situation:

```text
Designers can handle layout adjustments within the existing scope directly,
without asking the project lead every time. Only new pages or business capabilities
need a scope discussion. A customer's "okay" in a group chat is not necessarily
formal confirmation; we need to record exactly what was confirmed.
```

Ask AI to revise the flow branches accordingly and maintain the corresponding judgments through the business-rules Bundle. Continue inspecting and editing specific conditions, save, then ask the Agent to continue from the saved content. Use the Panel directly for definite fields or wording; add reasons in conversation when interpretation or effects across design areas matter.

| Design content | Judgment that needs to be clear |
| --- | --- |
| Customer feedback | Retain the original intent, source and related delivery content first; do not directly treat it as a new task the team has committed to. |
| Changes within scope | Designers can handle them, while still checking effects on delivery dates. |
| Added scope | Send it to the project lead for assessment and confirmation. |
| Confirmation records | Record what was confirmed and its content; avoid a context-free "confirmed" status. |

Once the Panel reports a successful save, continue discussing effects on flows and rules without waiting for a score update. If edits are not retained or the Agent still cites old content, check the relevant step with [save and continuation troubleshooting](troubleshooting.md).

When viewing a U/S/T clarity assessment, expand the reasons and next gaps rather than looking only at scores. One specific gap in the example is: after the project lead returns a request for more information, on which page does the designer complete the assessment, and how do they resubmit it? The existing flow describes the loop, but the three-page prototype does not yet cover the full operation. Such reasons help you choose the next round of work. Prototypes and scenario experiences do not prove that business tests have passed.

![Business flow and role responsibilities for a customer change request](../images/readme-flow.png)

## 4. Use a suggestion to expose an unresolved tradeoff

In a host that supports proactive review (GRA), read the evidence behind a suggestion before deciding how to proceed. The customer project delivery example saved a Grounding suggestion: [Smart Questions](../../examples/design-team-delivery/design_files/smart_questions/smart_questions.json) already required project-lead confirmation when a committed milestone was affected, while BR-001 in the [business rules](../../examples/design-team-delivery/design_files/business_rules/business_rules.json) checked only for new pages or business capabilities and missed the delivery-date exception. The suggestion's point was:

> Even without added scope, a change that affects a committed delivery milestone needs the project lead to confirm the arrangement.
> Compare the questions and answers with the flow, and add this existing judgment to the business rule's direct-handling conditions.

This identifies an existing judgment expressed inconsistently across designs; it does not make a new business decision for you. You can restate it in conversation:

```text
Assess scope and delivery dates separately. Even without added scope, a change
that affects a committed milestone should go back to the project lead
to confirm the arrangement.
```

In this demonstration, after human acceptance, AI was asked to revise the rules: BR-001's direct-handling conditions gained "does not affect committed delivery milestones," while BR-002 explicitly required project-lead confirmation for added scope or affected milestones. Compare the saved rules with the flow to check the result. Reading a suggestion does not rewrite the design. Use background review within the [host's supported scope](hosts.en.md), or explicitly ask the original session to check against existing designs.

This comparison makes "within scope can be handled directly" more precise and can lead to further discussion of unresolved delivery-date responsibilities. See [core concepts](concepts.md#知识关联与审查) for the three review perspectives.

![Read a Grounding suggestion beside the conversation and check the delivery-milestone condition missing from BR-001](../images/readme-design-advice.png)

KAG helps you find related content and sources. For example, choose the customer change-request flow or feedback-detail page under 「关联图谱」 (Related graph) at the bottom to see their referenced BPMN and HTML artifacts, then return to the Panel to check them. The graph and review each provide clues. The rule suggestion above came from comparison between Design Files, rather than a decision made automatically by the graph.

## 5. Develop data, AI capabilities and pages as needed

With those decisions made, make the proposal more concrete. For example, first inspect the page map to see where the project lead enters and how they find the original scope and impact. Once the main path is confirmed, generate concrete UI to judge whether the information and interactions are convenient.

```text
Use the saved responsibilities and scope rules to develop the page map
for customer feedback, scope comparison and change confirmation.
First explain how the project lead sees the original scope, the impact
and what is proposed for confirmation.
After we confirm the page relationships, generate the corresponding prototypes
so I can inspect and try the main interactions.
```

If the next decision depends on external information, use Research. For example, to understand how existing collaboration tools retain customer feedback, versions and confirmation evidence, first ask AI to draft research questions and directions, revise the plan, then confirm that research should begin. R-001 in the example explores three directions: "collecting feedback does not make a commitment," "AI suggestions and human confirmation," and "retaining context when returning a request for more information." It retains sources, findings and conclusions. When reading, distinguish reference products' practices, research recommendations and rules already confirmed for this project. A product convention does not automatically become your requirement.

![Switch between Research, UI Design and page-map Panels in the same customer project delivery example](../images/readme-design-exploration.gif)

A scenario experience places existing designs in a concrete situation, useful for discussing how to handle "the customer requests a new page, affecting a committed milestone." It can bring flows, rules and pages together to show the current proposal. Enter through 「场景体验」 (scenario experience) at the bottom of the Panel; see the [usage guide](usage.en.md#view-a-scenario-experience) for steps. Page prototypes focus on specific interfaces and navigation; each serves a different purpose.

![Compare a customer's request for another page with the original scope and impact assessment in a scenario experience](../images/readme-scene.png)

Explore other questions as needed:

| What needs more thought | What to inspect in the relevant Panel |
| --- | --- |
| How feedback, deliverables, changes and confirmations relate | Objects, relationships and field meanings in business data |
| What customers, designers and project leads can each do | Visibility and operation scope in roles and permissions |
| How AI helps without making commitments for the team | Responsibilities, prompts, Skills, tools and human-confirmation boundaries in AI capabilities |
| How users inspect feedback and decisions | Paths from feedback to scope evidence, impact and confirmation in page maps and prototypes |
| How to judge whether later implementation matches the design | Observable acceptance conditions for selected behavior |

For example, the future application's AI might summarize customer feedback, flag similar requests and draft impact notes. Authorized people decide whether to include a change in scope and which delivery date to commit to. You are designing AI for your future application here; its specific responsibilities and execution mode need to be defined in that application's design.

The conversation can suggest a next step: fill in missing scope evidence, or first use one page to check whether the project lead can see the information needed to decide. The choice follows the current obstacle, rather than the number of Panels or the lowest score. See the [official Kit user guide](official-kits.md#web-app从业务想法到可以讨论和实现的应用设计) for the purpose of each design activity.

<details>
<summary>Explore further: business objects, relationships and rules</summary>

![Inspect business-object relationships, details and business rules in the same project](../images/readme-design-views.gif)

</details>

## 6. Assemble the current design, retaining evidence and open questions

When this round is ready for team discussion, ask:

```text
Assemble the current project delivery platform design into a PRD.
Retain sources for features, flows, rules, data, permissions and AI capabilities.
Explain which decisions are confirmed and which remain provisional or unresolved.
Do not invent commitments we have not discussed just to make the document complete.
```

The example PRD has been reassembled from this round's design, including the current vertical flow, three-page prototype, visual-style preview and research evidence. Start with the product definition, users and scope, business rules and items needing confirmation. As design continues, first save this round's independent designs, then request reassembly to keep the document aligned.

Browse the PRD Panel's contents and body. Check whether the judgment that "changes within scope can still affect delivery dates" carries through the flows, rules and interactions, and whether illustrations match the current design. When you find an issue, revise it in the Bundle that owns the fact, then update the assembled document. A PRD is derived output and does not replace independent design sources.

When moving to implementation, prepare sourced instructions only for the current development task, such as "implement customer feedback recording and project-lead confirmation." Follow the [design-to-development handoff](../design-development-handoff.md) to prepare the spec and acceptance evidence; you do not need to implement the whole project at once.

![Read a PRD draft in formal chapters beside the conversation, retaining design sources and items needing confirmation](../images/readme-prd.png)

*The PRD draft follows formal chapter organization, with synthetic business data and unresolved content still marked. Its draft acceptance criteria still need team confirmation; they are not test results that have already passed.*

## 7. Continue after saving, and reopen next time

Next time, open the same project and continue discussing the saved content. For example:

```text
Continue the design-team-delivery project. Keep the scope and delivery-date rules I saved.
Explain what the project lead needs to see when confirming an arrangement,
then suggest what is worth improving this round.
```

To compare decisions before and after a change, ask, "Inspect the most recent change and explain which flows and rules changed." The project retains Design Files, artifacts and version history; you can reopen a Panel after closing it. See [everyday usage](usage.en.md#4-manage-and-recover-projects) for history inspection, recovery and reconstruction from materials, and the [command reference](commands.md) for project commands and all parameters.

If the Agent provides a U/S/T clarity assessment, use its evidence to understand current Understanding, Structure and Testability. Ask, "Why is this still unclear, and which concrete decision is most worth discussing?" Scores help locate gaps; they do not require you to fill every Panel to improve the score. See [clarity explanations](../ust-score-explanations.md).

To understand how a judgment relates to other content, open 「关联图谱」 (Related graph) at the bottom of the Panel, select relevant objects and inspect sources, then return to the flow or rules to decide whether a change is needed. You can also ask the Agent to explain against the original design. Graph links help find evidence, but still need to be read with the actual files. See [viewing KAG](usage.en.md#view-kag-and-index-status) for steps.

## What to check after the exercise

- You can explain this round's proposal, identifying which tradeoffs you made and what remains to be discussed.
- The context you supplied actually changed a flow, rule or AI responsibility rather than staying only in chat.
- Your saved changes carry into the next discussion. Page prototypes let you experience the design; business services still need later implementation.
- A relationship suggestion helped expose a meaningful issue without automatically deciding for you.
- The assembled result retains sources and unknowns, and the project can be reopened to continue.

To change methods or Panels for future design work, continue with the [minimal customization tutorial](custom-kit-tutorial.en.md). You can also replace this page's specific working practices with your own business context; you do not need to copy the exercise's answers.

# Product philosophy: help people think clearly, express themselves, and align with AI

[中文版](product-vision.md)

The product philosophy of Yugoo Design is: **help people understand, think, express themselves, and align with AI.**

**Not vibe, but intent.** Enabling human intent to enter, influence, and continually refine a design guides our choice of interactions and our judgment of product value. Intent does not have to be complete and clear at the start; people also work out what they mean as they see proposals, compare options, and experience scenarios.

This document introduces the product's positioning, design principles, and direction. Declarative Panels, A2UI, shared progression guidance, and knowledge review already have an implementation foundation; see the [Host guide](wiki/hosts.en.md) and [release notes](wiki/preview-status.md) for specific available capabilities. A complete AI-assisted authoring experience in Studio remains a direction for development, and methods across domains still need continual testing through actual use.

## 1. The central value

> Help people turn vague ideas into designs they can understand, judge, change, and gradually confirm for themselves.

Users often bring goals, uncertainties, examples, partial preferences, and judgments they have not yet formed, rather than complete requirements. The system's purpose is to help people think clearly, express themselves, and align with AI. It is more than prompting them to answer every question or producing documents faster.

A Kit can let AI act like a consultant with professional knowledge and several ways to communicate: understand the situation, find evidence, present choices, explain tradeoffs, and revise its understanding in response to the person. It can also define an expert that completes several outputs within a clear authorization and then brings them together for human review. The Mindset defines the expert's identity, personality, way of thinking, and special considerations; Bundles supply the toolbox. Collaboration styles can vary, but all should let human judgment shape the design, without deciding unauthorized goals or value tradeoffs on the person's behalf.

An artifact is something both sides think with. It may be a document, a question card, a comparison table, a flowchart, a page prototype, or a freeform whiteboard. What matters is whether it helps the user discover “this is exactly what I mean” or “this is not what I want,” rather than how many artifacts exist.

Here, “alignment” means a shared understanding within a particular task that can be inspected and revised. It does not claim that the model is universally correct.

### Which tasks need this kind of collaboration?

Human participation materially changes the result when it depends on preferences, actual circumstances, information outside the available materials, or value tradeoffs that those materials do not fully reveal. AI can generate a team expense tool, but you need to help express and judge whether an expense claim can be changed after submission and how its approver is chosen. AI can also build a scheduling optimization model, but someone who knows the work must supply and confirm which shifts cannot run consecutively and which business exceptions must remain.

The boundary is not code volume or problem size. A small, highly personal tool may need close collaboration; a large task with clear inputs and evaluation criteria may suit more automated execution. The system should involve people where they can add information, form judgments, and change outcomes, avoiding meaningless confirmations added just to maintain a Human-in-the-loop (HITL).

### Four connected purposes

- **Understanding**: understand the current proposal, its basis, and what remains uncertain.
- **Thinking**: use professional methods, concrete representations, and alternatives to discover questions the person had not yet thought through.
- **Expression**: bring preferences, constraints, and tradeoffs into the proposal accurately through conversation, Panel interaction, or direct design changes.
- **Alignment**: let the person's response change AI's understanding and subsequent actions, and make it possible to check that the change entered the shared design.

We welcome the efficiency and room for exploration that automation brings. What needs to endure is people's ability to participate meaningfully and influence results, without requiring them to confirm every item of work.

## 2. Interaction: enable people to respond, beyond asking them to answer

Actual user feedback offers an important clue: some questions are unclear or overly detailed. Others are understandable, yet users do not know how to answer before seeing or using the product, or they want to simplify first and fill in details later.

This does not necessarily mean the user is uncooperative. The communication method may be wrong. The system should choose a representation based on the current obstacle:

- If the user does not understand, use concrete scenarios, familiar language, and examples.
- If the user cannot judge tradeoffs, show a few meaningful options and explain their effects.
- If the user needs to see something first, offer a sketch, example, or prototype to discuss, then revise it in response.
- If the user wants to simplify first, use reversible provisional choices within an appropriate scope and retain undecided questions.
- If the user really must make a decision, ask a targeted question with a basis, without substituting an AI guess.

The basic rhythm is “express an idea → see a concrete representation → judge or change it → update shared understanding.” This is not a fixed workflow that must be completed step by step. The Agent should choose its next action from the situation and the user's intent, without forcing the user through every Bundle.

Seeing does not necessarily mean understanding, and clicking a confirmation does not necessarily mean shared understanding. The key is whether users can explain their tradeoffs and correct AI's misunderstandings.

## 3. What each layer carries

### Three core mechanisms

**Interactive exploration, gap-driven progression, and structured integration and calibration** together form the system's practical approach. Work moves among them continually; they are not three stages passed through just once.

| Core mechanism | What it helps people and AI do | Current technical counterpart |
| --- | --- | --- |
| Interactive exploration | Expand a question into design dimensions that support deeper judgment and revision, making details visible and specific tradeoffs expressible | Design Panels, declarative UI, and A2UI; Bundles carry the relevant methods, data contracts, validation, and execution declarations |
| Gap-driven Agent Loop | Judge what is worth doing next from the current goal, available evidence, and unresolved questions, then reassess after the result | Shared Core progression guidance and assessment, professional calibration by the Mindset, and U/S/T assessment of Understanding, Structure, and Testability |
| Structured integration and calibration | Connect separate designs, surface conflicts, knowledge doubts, and unresolved tradeoffs, and continually check the whole against the person's actual intent | KAG supplies traceable relationships; GRA supplies Grounding, Reflection, and Alignment suggestions |

An **Information Slice** is a metaphor for a design dimension that can be examined independently. An application's functions, flows, rules, data, and pages, for example, can each become interactive results. AI can propose a draft; people can design directly or change AI's results. Panels and the Agent continue working around the same saved design. A slice is a way to understand design, not a new file format, and it does not require every Bundle to have a Panel.

**A gap must be judged relative to the current goal.** It may be a missing fact, a tradeoff not yet made, an untested assumption, or a conflict between earlier and newer decisions. The next step might be a more useful question, a search for evidence, comparable proposals, or a return to an existing design. Empty fields and unused Bundles are not in themselves gaps that must be filled. Users can decline, defer, simplify, or change direction, and should be able to stop when the current purpose is served.

U/S/T supplies evidence-based heuristic clues for these judgments. It is not an objective completion percentage, a stage gate, a ranking across domains, or proof of correctness. Scores should be read with their reasons, scope, and unresolved questions; they may decrease as goals change or new evidence appears. The objective is meaningful progress rather than numbers that always rise.

**Integration also goes beyond aggregation.** It must preserve evidence and unresolved matters, expose how local changes affect other parts, and keep the shared design understandable, inspectable, and open to revision as a whole. An integrated PRD or other handoff artifact is a derived expression and does not replace the original design facts. KAG/GRA can help calibrate, but cannot guarantee correctness, consistency, or fidelity to reality. Suggestions still need verification, judgment, and actual revision.

All three core functions need to work together; the particular technologies may evolve. If KAG is temporarily unavailable, work can still continue from Design Files, with relationships traced and proposals integrated from those files.

### A picture of ongoing collaboration

![From loose yarn to a sweater knitted together; the lower row shows ideas and materials, interactive Design Panels, gap-driven progression, KAG/GRA relationship review, and systematic design artifacts, retaining a feedback and revision loop](images/yugoo-design-concept.webp)

*Product concept illustration, created with AI assistance.* The upper row uses sorting yarn, knitting together, and a coordinated sweater as a metaphor. The lower row represents materials, Panels, the gap-driven loop, relationship review, and design artifacts. Exploring, discussing, and integrating the same materials produces a proposal that meets actual needs. Feedback arrows show that integration uncovers new questions, requiring changes to existing designs or exploration of new dimensions.

### Supporting conditions and reinforcing mechanisms

For these mechanisms to work, people and AI must be able to continue around the same design, and human judgment must actually affect later action. Project storage and version records support continuity and traceability; professional method packages supply domain knowledge; scenario experiences bring slices and relationships into concrete situations to support judgment; Studio supports managing and authoring these methods and representations. These are important, but need not each become a separate product philosophy alongside the three core mechanisms.

| Layer | Product responsibility | What it should avoid becoming |
| --- | --- | --- |
| Design system | Maintain ongoing human–AI collaboration, supporting viewing, changes, saving, continuation, and review | A fixed software-document production pipeline |
| Kit | Combine domain knowledge, methods, judgment criteria, and capabilities through a Mindset and Bundles | A collection of unrelated prompts |
| Bundle | Provide a focused professional capability, combining Skill methods, resources, artifact contracts, validation, and interactive representation | A single capability treated as a complete consulting relationship |
| Design Panel | Let people view, compare, operate on, and revise shared artifacts | A read-only result window or a duplicate chat entry |
| GRA | Expose doubts from independent perspectives to support later verification, revision, and clarification | An automatic certification stamp of correctness |
| Studio | Help creators make professional methods into Kits / Bundles they can try, change, and reuse | An administration console that requires every professional to learn engineering configuration first |

Bundles maintain domain methods, resources, and rules as self-contained content. Specialized frontend editors connect through existing Provider / Panel extensions. This lets professional capabilities be reused across Hosts without scattering domain logic into Core or every Host.

A Bundle is one tool an expert can call. The Kit and Mindset organize domain thinking and the toolbox, combining with shared progression guidance into a coherent experience. A consulting expert can keep discussing, explaining tradeoffs, and choosing the next step; other styles can produce several outputs within user authorization and then align through Panels together.

The Web App Kit is the first domain application explored in depth. The framework should not make “pages,” “PRDs,” or a fixed set of software facets mandatory concepts for every Kit. Other domains' professional methods belong in their Kits, without inventing a universal workflow for all domains in advance.

## 4. Studio: create Kits and Bundles with AI assistance

### Creators express professional intent first; the system helps form the technical structure

Creating a Kit / Bundle should embody the same philosophy: help creators turn the methods in their heads into something they can understand, judge, and change. AI-assisted authoring is the core direction for Studio's interactions, beyond adding a question box beside a configuration page.

Creators can start with natural questions: Who do you want to help? What do you want to help them think through? What materials, cases, or existing Skills do you have? Which representation would help them judge? What counts as a good result? Which decisions must you leave to them? These are clues for understanding, not a questionnaire to complete all at once.

AI can help:

- Organize domain goals, boundaries, knowledge sources, and methods, and propose how to assemble a Kit.
- Organize a professional activity into a Bundle, explaining inputs, artifacts, and human interaction.
- Reuse or adapt existing Skills, examples, and components instead of inventing every method from scratch.
- Generate necessary declarations, Schemas, validation rules, and interface configuration, letting creators inspect technical details as needed.
- Discover problems in methods or representation through previews, trials, and feedback, then revise and validate again.

One intended authoring experience is:

> Describe a method or supply existing materials → AI proposes an understandable draft → the creator inspects and changes it → try it on an example → revise from feedback → save the method once it fits the task, then mount it in a Kit.

Authoring should accommodate the materials already at hand. Creating a Bundle on its own, combining existing Bundles into a Kit, and adapting an external Skill can all continue from existing work without repeating the entire process.

### “Painless” means reducing technical translation effort while retaining professional judgment

Ordinary creators should not have to understand internal fields and Host interfaces before they can express a method. At the same time, AI-generated configuration must remain inspectable and editable, rather than becoming another black box. Specialized interactions may still need trusted code components; there is no promise that any interface can be implemented automatically without code.

Creators must judge whether AI's proposed professional rules and evaluation criteria fit. Source can be imported, saved and completed gradually. Using external tools or sharing content still calls for checking actual dependencies, compatibility, permissions and existing license notices. Importing materials does not authorize execution of their scripts.

Continue the principle that whoever generates validates and repairs from feedback. Passing structural validation proves only conformance to a structural contract, not the effectiveness of a professional method or users' understanding. Previews, real use feedback, and professional evaluation retain their own value.

The goal is to let professionals build interactive tools and collaboration experiences for their fields without first becoming platform developers. Studio's current viewing, editing, and preview capabilities can support authoring; see the [Studio guide](wiki/usage.en.md#6-studio-inspect-customize-and-check-kits) for operations.

## 5. Declarative Panels and A2UI: choose a suitable representation

The product motivation for A2UI is to express AI's professional capabilities in multiple forms and let people's responses actually influence subsequent understanding. It goes beyond turning text answers into cards.

A comparison table can support comparing proposals, a diagram can support discussing a process, and an interactive list can support adjusting priorities. Choose according to how users can understand and respond more easily, rather than interface novelty.

Stable, mature editors remain valuable. There is no need to replace every existing Panel with dynamically generated UI. Declarative Panels and A2UI are implementation tools, not requirements for every Bundle or prerequisites for cross-Host integration.

Whichever representation is used, user actions must enter the same continuing design context. One interface cannot show temporary state while files save different facts, and AI cannot ignore changes the user just saved. Technical designs should continue to reuse existing project, file, and save mechanisms.

## 6. GRA: make doubts visible, rather than making output appear more credible

Complete documents, polished pages, and fluent explanations can hide incomplete understanding. This is a major product motivation for GRA: continually finding questions worth revisiting as shared artifacts take shape.

- **Grounding**: check consistency across Design Files and propose relevant revisions.
- **Reflection**: examine doubts or questionable reasoning in the current design's knowledge, and infer whether external research is needed.
- **Alignment**: find ambiguities that remain unclarified and require user judgment, then propose targeted questions.

These are independent review perspectives, not sequential approval stages. Design Files are the entry point for facts; KAG or state summaries support retrieval. Accepting a suggestion still requires changing the actual design. Reviews target identifiable completed versions and temporarily exclude unpublished changes. For which versions may be reviewed during work and how suggestions are handled, see the [knowledge relationships and review contract](system-design-baseline.md#grounding-reflection-and-alignment).

GRA output should help users see where to verify, revise, or decide, rather than continually generating more tasks. Review can miss problems, and multiple perspectives may share false assumptions, so “reviewed” cannot promise correctness.

Results should also retain necessary evidence and uncertainty: what came from existing materials, what is provisional, and what needs a user decision. This does not imply adding uniform fields to every Bundle or making every inference a mandatory confirmation.

## 7. Model progress, multiple Hosts, and open source

### Preserve user value without clinging to technical scaffolding

As models improve, some prompt workarounds, manual orchestration, or dedicated tools may become unnecessary. The system should use the Host's and model's native capabilities and remove complexity that no longer adds value, without constraining Agents to preserve the current architecture.

What must endure is that professional methods can be used, users can understand and revise representations, saved changes carry forward, and doubts can be seen. The aim across Hosts such as DSH, Codex, and Claude Code is reuse of these capabilities. It does not mean building another Agent Runtime or promising identical UI and native capabilities in every Host.

Capabilities such as computer use can help inspect design effects, operate on design representations, or understand existing products. They do not automatically expand the system's responsibility into software development or business-function testing. Stronger technical capabilities should serve product goals.

### Explore application boundaries through open use

Open source distributes more than code. It lets people from different fields bring their knowledge, methods, and questions to test whether Kits / Bundles can support professional activities we did not anticipate.

Application boundaries can remain open while core responsibilities stay focused: help people express, understand, revise, and confirm. The possibility of more domains does not justify building a huge universal platform in advance, and success with Web App does not automatically prove effectiveness across domains.

Lasting value may accumulate through reusable professional methods, real use feedback, and creator practice. Multiple Hosts, A2UI, file structures, and open source do not automatically confer a competitive advantage; actual experience must demonstrate it.

## 8. How to judge whether an evolution is effective

When deciding whether a change is worthwhile, first consider:

- Can users express goals and tradeoffs more clearly, beyond receiving files faster?
- When they cannot answer a question, do they receive a representation that helps them judge?
- Can they discover and correct misunderstandings, and do their changes persist into later work?
- Can undecided matters be identified, and does GRA offer useful reminders without extra burden?
- Can next-step suggestions explain which current problem they address? Does the system adapt when users decline, defer, or change direction?
- Can work end or move to handoff when the design serves its current purpose, without expanding merely for scores, Panel counts, or template completeness?
- Can creators make their methods into usable Kits / Bundles with less dependence on core developers?
- When changing Hosts or introducing a domain, are existing capabilities reused without copying domain logic or adding duplicate state?

These are evaluation directions, not measured achievements, and they need not become a new composite score. Ultimately, we hope users can say:

> I did not know what I wanted at first, but after working with it, I figured it out—and this result really is what I mean.

## 9. Relationship to existing documentation

- To understand the product and start using it, read the [README](../README.en.md) and [Host guide](wiki/hosts.en.md).
- To confirm the current version and available capabilities, see the [release notes](wiki/preview-status.md) and their use records.
- To understand implementation and extension conventions, read the [architecture baseline](system-design-baseline.md), [Bundle contract](bundle-contract.md), and [declarative Panel specification](dsl-spec.md).

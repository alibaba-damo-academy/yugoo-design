# Yugoo Design Wiki

English · [简体中文](README.md)

This Wiki covers using Yugoo Design in your existing Agent application, managing projects and Git history, understanding its capabilities, and creating Kits and Bundles. Start with the shortest path for your task, then follow the relevant reference when you need more detail. Installation and runtime support depend on the release and host you choose.

[Project home](../../README.en.md) · [Documentation overview](../README.md) · [Get started](getting-started.en.md) · [Command reference](commands.md) · [Feedback](support.md)

## Where to start

- **Work on your own design:** [install and begin](getting-started.en.md) → [client-project walkthrough](web-app-demo.en.md) → [everyday use](usage.en.md). The [Kit user guide](official-kits.md) explains the available design activities.
- **Understand the system:** read the [product principles](../product-vision.en.md), [core concepts](concepts.md) and [runtime overview](architecture.md), then use the capability table below for U/S/T, KAG, GRA, saving and handoffs. The [command reference](commands.md) explains `/yugoo` arguments.
- **Turn professional methods into interactive tools:** [minimal customization](custom-kit-tutorial.en.md) → [authoring rules](extending.en.md) → [Studio](usage.en.md#6-studio-inspect-customize-and-check-kits) → [sharing with recipients](kit-sharing.en.md).
- **Contribute to the source:** [development guide](development.md) → [architecture baseline](../system-design-baseline.md) and the owning package's README → [contribution, testing and release guidance](../../CONTRIBUTING.md).

The starting guides above have English counterparts. Some deeper user and technical references are still being translated; each translated page links to its other language. Both versions are maintained in this repository.

## First use

| What you want to do | Entry point and expected result |
| --- | --- |
| Prepare a host, configure its model, and install or update Yugoo | [Getting started](getting-started.en.md), [host compatibility](hosts.en.md): find the route for your host and enable the plugin |
| Create a project and request an output | [Client-project walkthrough](web-app-demo.en.md): move from a goal to a concrete Panel and use your feedback to change the design |
| Find domain capabilities | [Kit user guide](official-kits.md), [acquisition list](kit-sharing.en.md#official-kits): distinguish the included Kit from public examples acquired separately |
| Understand interface terms | [Core concepts](concepts.md), [terminology](terminology.md): distinguish Project, Kit, Mindset, Bundle, Panel and Studio |
| Check versions and limits | [Host compatibility](hosts.en.md), [release status](preview-status.md): check the scope of the selected release |

## Everyday operations and commands

| Task | Where to look | Result and boundary |
| --- | --- | --- |
| Create, open, list, switch or close projects; choose a Kit | [Commands and arguments](commands.md), [project selection](usage.en.md#1-choose-a-project-and-goal) | Identify the current project and its Kit content; natural-language requests and supported host commands use the same service |
| Read, edit, save and reopen a Panel | [Panel operations](usage.en.md#2-inspect-and-edit-a-panel) | Saved design becomes the basis for continuing; opening a page and completing a save are different results |
| Read a suggestion and decide whether to accept it | [Handle suggestions](usage.en.md#3-handle-suggestions) | Choose revision, clarification or research; changes go through the owning Bundle, and disposing of a suggestion does not itself change the design |
| View Git history, migrate an older project, or remove its registration | [Manage and recover projects](usage.en.md#4-manage-and-recover-projects), [command reference](commands.md) | Trace earlier changes; migration creates an adapted project, while removing a registration retains its files |
| Reconstruct a design from materials or existing software | [Reconstruction](usage.en.md#5-reconstruct-a-design-from-existing-materials) | Retain observed evidence and unknowns while the owning Bundles produce design files |
| Assemble a PRD or prepare implementation tasks | [Kit user guide](official-kits.md), [development handoff](../design-development-handoff.md) | Retain source designs and organize the handoff around the task and the codebase's existing spec |

## Capabilities and principles

| Capability | Purpose and entry point | Further reading |
| --- | --- | --- |
| Interactive outputs and a gap-driven loop | AI chooses useful actions from the goal, evidence and your feedback; open questions, diagrams or prototypes when they help | [Core mechanisms](concepts.md#三个核心机制), [product principles](../product-vision.en.md) |
| Project, Kit, Mindset and Bundle | A project retains outputs and history; a Kit organizes domain methods and tools, and a Bundle supplies a focused capability | [Names and responsibilities](concepts.md#名称与职责), [Kit user guide](official-kits.md) |
| Clarity assessment (U/S/T) | Use evidence to understand what is missing, ask about the reasoning, and consider the next step | [Concepts](concepts.md#清晰度评估与下一步建议), [score explanations](../ust-score-explanations.md), [everyday use](usage.en.md) |
| Knowledge graph (KAG) | Connect independent design sources to find supporting evidence and the impact of changes | [Concepts](concepts.md#知识关联与审查), [knowledge-source policy](../design-knowledge-source-policy.md), [everyday use](usage.en.md) |
| Automatic review (GRA) | Receive suggestions about consistency, knowledge questions and intent; background, foreground and manual options depend on the host | [Handle suggestions](usage.en.md#3-handle-suggestions), [host limits](hosts.en.md#background-capabilities-and-review-fallback), [reading suggestions](../advisory-reading.md) |
| Files and Git history | Continue saved work, trace changes and migrate older projects; the package includes the Git runtime | [Project management](usage.en.md#4-manage-and-recover-projects), [project files and backup](project-files.md), [commands](commands.md) |
| Design-to-development handoff | Give a coding Agent the design evidence it needs, then return new questions to the relevant design dimension | [Handoff guide](../design-development-handoff.md), [walkthrough](web-app-demo.en.md) |
| Shared framework and host adapters | Core owns project and execution semantics; Panel and Studio share presentation; the host supplies conversations, models and native integration | [Runtime overview](architecture.md), [architecture baseline](../system-design-baseline.md), [host entry points](../../packages/companion/HOSTS.md) |

## Explore and extend

| What you want to do | Entry point |
| --- | --- |
| Design application features, flows, data, permissions, pages and AI capabilities | [Kit user guide](official-kits.md), [client-project walkthrough](web-app-demo.en.md) |
| Explore representations beyond software pages | [Non-Web examples](non-web-kit-demo.md), [community workshop delivery](../../examples/community-workshop-delivery/README.md), [field operations](../../examples/field-operations-shared/README.md) |
| Inspect Mindsets, mounts and Bundles, and check previews in Studio | [Studio guide](usage.en.md#6-studio-inspect-customize-and-check-kits): edit current content and copy an independent identity when needed; distinguish source saves, sample previews and actual trials |
| Author Kits, Mindsets, Bundles and Panels | [Minimal customization](custom-kit-tutorial.en.md), [extension guide](extending.en.md), [Panel DSL](../dsl-spec.md), [shared UIUX standard](../panel-uiux-standard.md) |
| Share, load, update or restore content | [Kit sharing and recovery](kit-sharing.en.md), [project content maintenance](../project-content-upgrade.md): save current library content in place while existing projects retain their complete Kit files |

## Development and participation

- [Development guide](development.md): environment, source layers, relevant builds and verification entry points.
- [Contributing](../../CONTRIBUTING.md): code, domain methods, documentation, translations, examples and maintainer release procedures.
- [Documentation overview](../README.md): architecture, Bundle, DSL, model integration and component references.
- [Terminology](terminology.md), [AGENTS.md](../../AGENTS.md): names, working conventions and verification scope.
- [Feedback](support.md), [security reports](../../SECURITY.md): separate ordinary questions from sensitive reports; available channels are described on each page.
- [Public document synchronization](../public-document-sync.md): one maintained source, explicit classification and export from a fixed commit; source synchronization and npm publication are separate operations.

## Runtime limits and troubleshooting

The host supplies models, credentials, tools and native Agents. Panel presentation, background review, installation and updates differ between hosts; see [host compatibility](hosts.en.md). For local knowledge processing and model preparation, see [installation details](getting-started.en.md#environment-and-installation-details).

For problems with entry points, connections, generation, saving or continuing a design, see [troubleshooting](troubleshooting.md). To check whether a capability is available in your version, see [release status](preview-status.md).

## Contracts and references

- [Product principles](../product-vision.en.md)
- [Architecture baseline](../system-design-baseline.md)
- [Bundle contract](../bundle-contract.md)
- [Panel DSL](../dsl-spec.md)
- [Host and model integration](../system-design-baseline.md#agent-host-and-user-interface-integration), [host entry points](../../packages/companion/HOSTS.md)
- [Knowledge association and review](../system-design-baseline.md#grounding-reflection-and-alignment)
- [Contributor and coding-agent guidance](../../AGENTS.md)

## Documentation and versions

Tutorial interfaces and operations can change with the host, plugin and Kit version. Current-content editing and project-owned `design_kit` files describe the development source; installed releases need the corresponding runtime, as explained in the [sharing guide](kit-sharing.en.md). Check [host compatibility](hosts.en.md) first. Examples state the versions and scope they demonstrate; see [release status](preview-status.md) for current releases.

To improve documentation, translations or examples, read [Contributing](../../CONTRIBUTING.md) and [terminology](terminology.md). The [English README](../../README.en.md) introduces the project; use the [feedback guide](support.md) for questions and suggestions. Maintenance and public synchronization follow the [document sync contract](../public-document-sync.md).

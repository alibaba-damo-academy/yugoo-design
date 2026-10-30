# Getting started

English · [简体中文](getting-started.md)

Start with an Agent Host that already has a model configured. Ask its Agent to install Yugoo Design, then create your own Design Project. Your first session follows this path: **install and enable → create a project → explore a result → edit and save → continue from the saved design**.

Installation requires **Node.js `>=22.19.0`**. For an older release, follow the `engines.node` requirement of that exact version. The plugin uses the host's existing conversational model, search and tools; you configure the services it needs. See the [compatibility guide](hosts.en.md) for host support and [environment and installation details](#environment-and-installation-details) below for initial local-model preparation. The main plugin includes the Web App Kit by default.

Reuse a compatible Node installation from your system or version manager first; adding a host adapter does not require another copy. Do not rely long term on Node from a development preview, another application's private directory or a temporary test directory. If no compatible version is available, prepare Node before continuing. The selected version's [installation guide](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary) explains how to check and specify its path. Removing plugin registration and cleaning up a runtime are separate operations; Yugoo does not delete a reused external Node installation.

The unified product package and CLI are both named `yugoo-design`. The first stable release, `0.1.0`, is available on npm; the instructions below describe normal installation. Explicitly supplied prerelease candidates still follow the [candidate preflight](#prerelease-candidate-preflight). The old `@yugoo-design/companion` package and `beta` channel remain historical records and are not the default for new installations.

## 1. Copy the universal prompt

The GitHub links provide public installation instructions; you do not need to sign in or clone the repository. Installation obtains the stable npm package `yugoo-design`, then uses that version's installation entry point to connect the host. If you selected a specific host on the website, the copied prompt should name it explicitly to avoid installing into another application.

Copy the [universal installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host) into your current host's Agent input. First installation and updates use the same entry point. The Agent selects the installation route from the actual host context; you do not need to decide whether it should install DSH or Companion internally, and it will not install into every host on your computer at once.

Use the following entries when you need to specify a host or read its steps:

| Current host | Installation or update instructions | Interface you will use |
| --- | --- | --- |
| DeepSeek Harness | [Instructions](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness) | Conversation and Design Panel in an official DSH profile; see the status page for Studio scope |
| Codex CLI | [Instructions](../../packages/companion/HOSTS.md#install-or-update-codex-cli) | CLI conversation and browser-based Design Panel |
| Codex Desktop (macOS arm64) | [Instructions](../../packages/companion/HOSTS.md#install-or-update-codex-desktop-on-macos-arm64) | Native conversation and a shared Design Panel connected to the same session |
| Claude Code CLI | [Instructions](../../packages/companion/HOSTS.md#install-or-update-claude-code-cli) | CLI conversation and browser-based Design Panel |
| Qoder CLI | [Instructions](../../packages/companion/HOSTS.md#install-or-update-qoder-cli) | CLI conversation and browser-based Design Panel |
| QwenWork (千问办公) | [Instructions](../../packages/companion/HOSTS.md#install-or-update-qwenwork) | Use after importing the expert suite and connector in the host |
| WorkBuddy | [Instructions](../../packages/companion/HOSTS.md#install-or-update-workbuddy) | Import the plugin source in the host, then refresh or update as prompted |

Codex Desktop has a separate candidate acceptance record for macOS arm64; the current Claude Code record covers the CLI only. This table lists available integration routes. See [host compatibility](hosts.en.md) for exact versions and acceptance scope; it does not mean the unified new package has passed acceptance on every host. Full installation parameters, configuration and recovery steps are in the [host integration entry points](../../packages/companion/HOSTS.md).

## 2. Ask the host Agent to install or update

The Agent first checks that the required exact `yugoo-design` release is available, records its integrity, reads the bundled guide, then registers it with the host or prepares the import materials. An explicitly requested version takes precedence. Without a requested version, it must first resolve npm's `latest` tag to an exact published stable version and keep that version throughout the remaining steps. If the tag points to a prerelease or the required version is unavailable, it should explain and stop rather than choose another version. Follow its instructions when authorization, native UI import, a restart or a new session is required. QwenWork and WorkBuddy also require confirmation in the host UI after materials have been prepared.

Installation includes the shared runtime, Design Panel, default Web App Kit and the adapter needed by the current host. Existing Node installations are reused first. The local embedding model is cached separately for the actual runtime user, so each new adapter does not install another copy.

The Agent should also check the local model: reuse a complete cache first; if a download is needed, explain the roughly 135 MB file and its purpose, prepare it with permission, and check that it can actually run on the CPU. Versions with `prepare-embedding` can do this before project creation; for the older `0.1.0`, follow its bundled guide. See [local embedding model preparation](../../packages/companion/README.md#local-embedding-model-preparation) for commands. You can still create, edit and save designs if you defer the download or the model is not ready. Semantic-search readiness is reported separately; this does not make all of KAG unavailable.

At the end, you should know the version actually enabled, how to enter a project, and which manual steps remain. The Agent reports package acquisition, host registration or import, activation, and actual usability separately. Obtaining a new package or seeing new page text does not prove the host has loaded the new version. Retain the installation directory and receipts, and use the original entry point for updates and recovery.

If the Agent cannot run commands or access host settings, it lists the unfinished steps. Follow the host-specific instructions in the table above in a terminal with the required permissions or in the native host UI, then ask the Agent to finish verification. On failure, first inspect the receipts and [troubleshooting guide](troubleshooting.md) to avoid repeated installations or overwriting existing configuration. See [preview status](preview-status.md) for installable versions and compatibility.

To stop using or remove the plugin, follow your host's route under [disabling, uninstalling and retained files](../../packages/companion/HOSTS.md#disable-uninstall-and-retained-files). Removing registration and deleting a Design Project are separate actions. Do not first delete a runtime or project directory still referenced by another host.

## 3. Create a Design Project

The following creates a new, empty practice project; it does not load the repository's existing example with the same name. To continue from the existing design instead, copy and migrate it using the [example project instructions](../../examples/design-team-delivery/README.md). Choose either path.

To begin with a new idea, make an explicit request through the installed `yugoo` entry point. If you already have a code repository, use the [reconstruction entry point](#if-you-already-have-a-code-repository) below directly; you do not need to create an empty project first.

```text
Create a Design Project named design-team-delivery using the Web App Kit.
```

The current DeepSeek Harness commands are:

```text
/yugoo new design-team-delivery
/yugoo kit web_app
```

Companion hosts use the installed `yugoo` skill; for example, Claude Code CLI's persistent registration exposes `/yugoo-design:yugoo`. The Agent should tell you the current project and selected Kit, then continue working in that project. In runtimes supporting project-owned content, the first Kit selection saves complete Kit and Bundle files in the project. Existing projects keep using their own content; library edits do not change them automatically. See the [sharing guide](kit-sharing.en.md) for version scope.

See the [command reference](commands.md) for full project operations and `/yugoo` parameters. For older installations, use the corresponding entry point in the bundled help; the current canonical subcommand is `kit`.

### If you already have a code repository

When taking over or iterating on an existing application, reconstruct its design from code first to understand existing features and conventions before discussing changes. At the installed `yugoo` entry point, provide an absolute repository path the host can access, for example:

```text
Use Yugoo Design to reconstruct the existing application's design from D:\Projects\studio-app.
First identify the features, flows and business rules involved in customer change requests,
preserving sources and unknowns.
Keep the original repository read-only; do not run or modify product code.
```

The Agent creates a new Design Project, continues reading relevant evidence and organizes editable results with a suitable Kit. "Project created" is only the beginning. Check the results using the [reconstruction guide](usage.en.md#5-reconstruct-a-design-from-existing-materials), then revise them in the Panel. For an old Design Project that already has `design_files/`, use `migrate` rather than extracting it from code again.

## 4. Request a specific result

```text
We are a six-person project delivery team. Customer requirements and change requests
are scattered across chats. We want to design a project delivery platform where AI
organizes feedback and flags impacts, while we make the key commitments.
Start by turning the handling of a customer's change request into a flow we can discuss.
Explain decisions I need to make in concrete situations.
Leave contract billing and financial management out of this round.
```

Following the Kit's methods, the Agent clarifies the context or directly develops a result you can discuss. A Design Panel may use diagrams, cards, tables or prototypes. If your request is already clear, ask for the relevant result directly; you do not have to finish a questionnaire first.

Point out something in the Panel that differs from your intent, such as "Designers can handle layout adjustments within the agreed scope directly; additions go to the project lead for confirmation." You can edit and save the available fields directly, then ask:

```text
Continue from the scope rule I just saved. Explain which flows, permissions and pages it affects.
Start with the single most useful issue to address now, so I can decide what to do next.
```

The saved design is the basis for your next discussion with the Agent. Reopening the Panel should show the saved values, and the original session should continue from the updated content. If saving or continuation fails, record which step failed and consult [troubleshooting](troubleshooting.md). Follow the [customer project delivery tutorial](web-app-demo.en.md) through this round, and use the [official Kit user guide](official-kits.md) for other design activities.

## Continue after your first session

| What you want to do now | What to say or do | Details |
| --- | --- | --- |
| Explore a design dimension | Request a specific feature, flow, data model, page or another result supported by the current Kit | [Kit user guide](official-kits.md) |
| Decide what to do next | "Given the goals and saved design, explain the most useful gap to address and the evidence for it." | [Clarity and core mechanisms](concepts.md) |
| Explore connections or request proactive review | "Which rules does this flow change affect? Check it against the existing design." | [Usage guide](usage.en.md#3-handle-suggestions) |
| Continue a project, inspect changes or migrate an old project | Open the project from the installed entry point; specify the original and target scope for migration | [Project management and recovery](usage.en.md#4-manage-and-recover-projects), [all commands](commands.md) |
| Add design materials from existing code | Give the absolute repository path and this round's scope, then ask the Agent to reconstruct the current design | [Reconstruction guide](usage.en.md#5-reconstruct-a-design-from-existing-materials) |
| Hand off to development | Specify this round's development task and code workspace, and prepare a handoff with sources | [Design-to-development handoff](../design-development-handoff.md) |
| Adjust methods or panels for future projects | Edit current content in Studio, or create an independent copy to customize | [Studio](usage.en.md#6-studio-inspect-customize-and-check-kits), [minimal customization](custom-kit-tutorial.en.md) |

## Environment and installation details

These notes support preparation and troubleshooting. For host-specific commands, follow the [unified installation entry point](../../packages/companion/HOSTS.md#agent-led-installation-and-updates).

- **Version management:** The package includes its runtime; normal design work does not require a separate Git installation. Current source supports Windows x64/MSVC, Linux x64/GNU and macOS arm64; see [preview status](preview-status.md) for specific installation candidates and host scope. DSH uses an official profile and the same product installer to select native integration. It does not require a separate Companion service or manual installation of individual internal modules. Ladybug is a third-party runtime dependency pinned to an exact version.
- **Local embedding:** KAG uses the CPU and does not require a GPU. Before first obtaining the package with npm/npx, follow the unified entry point to set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` for the installation process. This skips CUDA downloads while retaining the normal installation scripts required by dependencies. A package already obtained cannot retroactively set the environment of its acquisition process. GPU acceleration is outside the first release's support scope.
- **Local model files:** Use the complete cache required by that version, or explicitly permit a pinned-model download through a supported entry point. See [local embedding model preparation](../../packages/companion/README.md#local-embedding-model-preparation) for the model name, cache location and host-specific download limits. Skipping CUDA does not remove the need for a model; the host's conversational model cannot replace the local embedding model.
- **Host model and search:** You configure these in the host; the plugin does not provide shared keys or quota. Skipping search configuration does not establish that research works. Having a CLI installed also does not prove the current session is running in that host.
- **Versions and updates:** See [preview status](preview-status.md) for installable versions. The installer obtains the components required by that version; you do not need to manually add them using historical instructions. If the required version cannot be obtained, retain the error information rather than substituting another package or a source build.

## Prerelease candidate preflight

A local tarball verifies the exact supplied candidate before release; it is not the main stable-installation tutorial. After checking the bundled name, version and integrity, install it in a separate test directory that can be retained long term. `RECEIVED_EXACT_TARBALL` means the file received and verified for this run; do not guess its filename. The following is a POSIX shell example. For Windows PowerShell and Agent-led installation, see the [unified installation entry point](../../packages/companion/HOSTS.md#agent-led-installation-and-updates):

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact /absolute/path/to/RECEIVED_EXACT_TARBALL.tgz
npx --no-install yugoo-design --help
```

For CLI hosts, verify registration and operation using the [Companion guide](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary). For DSH, preflight the complete supplied candidate dependency list using its bundled guide. The [older official-host workspace route](../../packages/dsh/README.md#unpublished-release-official-local-workspace-route) retains the history of its own artifacts; it does not define the package count or acceptance of a new candidate. Verify desktop candidates against their host-specific materials and actual versions. Results from an older candidate do not automatically count as acceptance of the current npm release.

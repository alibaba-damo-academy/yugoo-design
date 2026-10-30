# Release status and compatibility

Use this page to choose an installation route and understand the scope of available capabilities. Start with [getting started](getting-started.en.md), then follow the [guide for your host](hosts.en.md).

## Current release and use

**Published release:** [`yugoo-design@0.1.2`](https://github.com/alibaba-damo-academy/yugoo-design/releases/tag/v0.1.2) is published. Use the [installation guide](getting-started.en.md) for your host.

Install the released **`yugoo-design`** npm package using the [shared installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host). The product CLI is also `yugoo-design`.

With no version specified, resolve npm's `latest` once to its exact published stable version and integrity, then keep that version throughout installation. If `latest` points to a prerelease, report the mismatch and stop rather than selecting another version. An explicitly requested version takes precedence; stop if it is unavailable. Check the [published releases](https://github.com/alibaba-damo-academy/yugoo-design/releases) for changes. The former `@yugoo-design/companion` package and its `beta` channel are historical distributions, not the current installation entry.

The product and its ten native DSH components share one npm release version. The installer selects DSH's exact aggregate through `release-hosts.json`; you do not need to install its internal modules separately. Native desktop suite versions and Kit/Bundle source-version metadata have their own identities and must not be replaced with the product's npm version.

**Web App Kit is included.** Select it for a new project through the installed host's `yugoo` entry. Existing projects keep their own Kit content. Current source stores a complete `design_kit` tree in the project; older releases retain their version-specific loading behavior, as described in the sharing guide. Other available content and independent Kit loading are described in the [Kit guide](kit-sharing.en.md#official-kits); historical packages do not establish current inclusion or support.

**Installation is more than downloading.** Complete the host's native registration/import and activation, then check the version actually loaded. Preserve the previous runtime and installation receipts when updating. Normal design versioning uses the bundled Git runtime; no system Git executable is required. Follow the acquired package's help for supported platforms and commands.

**Local semantic search has separate dependencies.** Local embeddings use CPU. The installation guide sets `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` for acquisition while retaining dependency lifecycle scripts; this skips the additional CUDA download, not the ONNX runtime or embedding model. Prepare the required model cache or allow its download as instructed. Conversation, design generation and reviews use the host's model configuration.

Yugoo Design is a plugin, not a replacement for the host application. It does not require host source modifications or a separate search API key. Your host owns model access, search, credentials and execution permissions.

## Host capability boundaries

| Host | What to check before use |
| --- | --- |
| DeepSeek Harness | Follow the official Web/Desktop installation route and its documented host version. Conversation and Design Panel share a workspace. |
| Codex Desktop | Use the macOS arm64 guide, complete native Plugins UI activation and enable the plugin in the conversation. Desktop setup differs from Codex CLI. |
| Codex CLI, Claude Code CLI, Qoder CLI | Use the matching native adapter, session binding and normal restart steps; a reachable MCP service alone does not establish an active design session. |
| QwenWork, WorkBuddy | Follow the Windows desktop import/marketplace steps and the host's preview and review limits. Preparing files is not the same as native activation. |

See [host compatibility](hosts.en.md) for exact versions and feature limits. Results from an older candidate, a local source build, or another host do not establish support for the version you installed. Source updates do not update an existing npm installation.

## Foreground review availability

GRA reviews may run in the foreground when the host cannot keep the main conversation available during a background task. You can disable automatic GRA and request a review manually, or explicitly choose a synchronous review for that run. A foreground review occupies the main conversation; it must not be described as nonblocking background execution.

The documented QwenWork `1.3.2-26101704` route cannot create background Agent Sessions. In the recorded WorkBuddy `5.8.3` route, asynchronous child work still occupied the main conversation. These are different host limitations. Use the [host-specific review guidance](hosts.en.md#background-capabilities-and-review-fallback) and the acquired package's actual capabilities. Receiving a suggestion, accepting it and saving a corresponding design change are separate actions.

## Studio source capabilities and installed acceptance

Studio provides tools for inspecting methods, editing current Kit/Bundle content, copying independent identities, managing mounts, previewing panels, trying methods through the native host and sharing source archives. Availability depends on the plugin version and host adapter; consult the [Studio walkthrough](usage.en.md#6-studio-inspect-customize-and-check-kits) and your installed version's controls.

Keep these operations distinct:

- In the current development source, ordinary saves update the same library identity without a local publication or version-selection step. Projects with their own `design_kit` files remain independent of subsequent library edits.
- Sample preview uses sample data and does not invoke a model. A native trial runs in a separate test project; its demonstration save does not prove durable project saving or Agent continuation.
- Current source imports ZIP files, folders or a Bundle's `SKILL.md` as editable source. Missing auxiliary definitions remain available for completion; loading and preview report their actual diagnostics. Import does not execute scripts, install models or Providers, or change existing projects. Source and license fields are optional; existing attribution remains intact.
- Exporting and sharing a copy does not publish it to a registry or establish compatibility with another host. Check the recipient's complete use/save/reopen path as described in [Kit sharing](kit-sharing.en.md).

Current source capabilities and screenshots are not a promise that every published package or host contains the same authoring UI. Design-session support does not by itself verify Studio authoring, KAG visuals or every native trial route.

## Continue into development

With a Design Project selected, use `/yugoo compose_spec [feature scope]`, or
ask the main agent to “assemble the current design into a development spec for
[one user operation].” Include the authorized coding workspace. The main agent
uses the shared `design_command` action, reads the relevant published design
files and artifacts, and writes or updates the target repository's existing
spec convention. A prepared-task receipt is not a generated spec; completion
requires actual files and checks. This does not authorize implementation or
modify Design Files. Spec and PRD outputs are not re-ingested into KAG.

Give your coding agent a concrete implementation outcome, not an instruction
to build everything in the project. The proposed handoff can start with:

```text
Use the selected Design Project to prepare a development brief for [one user
operation]. Pin the published design checkpoint and identify the relevant
records, objects, rules, flow and UI evidence. Use KAG to discover related
sources if available, then verify them in the source files.

Treat published canonical design content as the design basis, following the
Kit's actual contract. Distinguish those decisions from unaccepted suggestions
and unresolved assumptions; do not invent evidence of personal user confirmation
or ask the user to reapprove every published record.
Explain normal behavior, important exceptions and observable acceptance checks.
Flag material conflicts or missing decisions before implementation. Do not alter
Design Files with coding tools; send design changes back through their Bundle.
Wait for my approval of this brief before writing application code.
```

This keeps the original design files authoritative and limits the context to
the task. A prototype or a high clarity score is not proof that every behavior
has been confirmed. The task-scoped handoff contract is documented in the
[practical handoff guide](../design-development-handoff.md). It explains
how a fresh coding agent can find task-relevant sources, prepare a brief,
implement the approved scope, and return design gaps through the owning Bundle.
The coding agent can choose ordinary implementation details within the authorized
scope; ask the user when a material product decision is missing. Keep using the
code workspace's existing spec convention. Spec Kit is one option, not a required
Yugoo Design format. Task-scoped development handoff does not provide automatic two-way synchronization or establish every host’s behavior.

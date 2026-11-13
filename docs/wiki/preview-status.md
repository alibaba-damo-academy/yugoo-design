# Release status and compatibility

Use this page to choose an installation route and understand the scope of available capabilities. Start with [getting started](getting-started.en.md), then follow the [guide for your host](hosts.en.md).

## Current release and use

**Latest release:** install or update `yugoo-design` using npm’s `latest` tag and the [installation guide](getting-started.en.md) for your host. See the [latest release notes](https://github.com/alibaba-damo-academy/yugoo-design/releases/latest). Version numbers in the verification records below identify what was tested; they do not pin the default installation.

Install the released **`yugoo-design`** npm package using the [shared installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host). The product CLI is also `yugoo-design`.

With no version specified, resolve npm's `latest` once to its exact published stable version and integrity, then keep that version throughout installation. If `latest` points to a prerelease, report the mismatch and stop rather than selecting another version. An explicitly requested version takes precedence; stop if it is unavailable. Check the [published releases](https://github.com/alibaba-damo-academy/yugoo-design/releases) for changes. The former `@yugoo-design/companion` package and its `beta` channel are historical distributions, not the current installation entry.

The product and its ten native DSH components share one npm release version. The installer selects DSH's exact aggregate through `release-hosts.json`; you do not need to install its internal modules separately. Native desktop suite versions and Kit/Bundle source-version metadata have their own identities and must not be replaced with the product's npm version.

**Web App Kit is included.** Select it for a new project through the installed host's `yugoo` entry. Existing projects keep their own Kit content. Since `0.2.3`, projects store a complete `design_kit` tree; older releases retain their version-specific loading behavior, as described in the sharing guide. Other available content and independent Kit loading are described in the [Kit guide](kit-sharing.en.md#official-kits); historical packages do not establish current inclusion or support.

**Installation is more than downloading.** Complete the host's native registration/import and activation, then check the version actually loaded. Preserve the previous runtime and installation receipts when updating. Normal design versioning uses the bundled Git runtime; no system Git executable is required. Follow the acquired package's help for supported platforms and commands.

## Version-specific verification records

The records below identify particular releases and environments. They remain useful for understanding tested paths and failures, but do not identify the version currently selected by npm's `latest` tag. Check the acquired package and its release notes for your installation. Current source behavior is described separately under [Studio capabilities](#studio-source-capabilities-and-installed-acceptance).

**Verified use in `0.2.7`.** Checks used the actual published npm packages with
official DSH `0.2.1-rc.3` on Windows Web. An official-host update from `0.2.6`
preserved existing data and source content. After correcting CPU dependency
build configuration, a fresh runtime was also checked through native registration,
Kit import, native Agent generation, a human Panel edit and save, and reopening
the project for the original Agent to read. The Studio authoring scope is
described below. Existing design and migration evidence was reused only for
unchanged inputs; this was not a fresh run across every host or execution mode.

**Installation issues remain.** The initial managed fresh-install attempt failed
while building required CPU dependencies. The later repair does not turn that
attempt into a successful uninterrupted install. The wrapper's update-selector
dry run also failed, separately from the successful official-host update. Keep
the previous installation and ask your Agent to inspect the existing receipt
before retrying. Follow the
[DSH installation and repair guidance](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness)
for configuration, activation and recovery.

**Scope of the earlier installer investigation.** At the time of the `0.2.7` checks, environment preparation, native MCP handoff and macOS QwenWork preparation were separate source or website-development changes. Those changes did not update the `0.2.7` archive or establish a complete installed Mac Agent workflow. The recorded exact rc3/rc2 Host peers rejected rc5; a subsequent source change used a compatible rc3 API range while retaining rc2 support, with the rc3/rc5 public APIs compared. Static API comparisons and installation prompts do not establish an installed workflow. The earlier slow macOS installation investigation did not establish a cause. Preserve these original limits when consulting the record; check a newer release's own instructions and results separately.

**Local semantic search needs its own model files.** Local embeddings use CPU. The current prebuilt release includes its Node/CPU runtime dependencies and does not run an extra CUDA download script; normal package installation needs no CUDA environment variable or separate dependency build approval. Older archives such as `0.2.8` keep their original behavior; follow their bundled instructions. Prepare the required model cache or allow its download as instructed in the [embedding-model guide](../../packages/companion/README.md#local-embedding-model-preparation). Conversation, design generation and reviews use the host's model configuration.

Yugoo Design is a plugin, not a replacement for the host application. It does not require host source modifications or a separate search API key. Your host owns model access, search, credentials and execution permissions.

## Host capability boundaries

| Host | What to check before use |
| --- | --- |
| DeepSeek Harness | Follow the official Web/Desktop installation route and its documented host version. Conversation and Design Panel share a workspace. |
| Codex Desktop | Follow the Desktop installation and maintenance guide, complete native Plugins UI activation and enable the plugin in the conversation. Desktop setup differs from Codex CLI. |
| Codex CLI, Claude Code CLI, Qoder CLI | Use the matching native adapter, session binding and normal restart steps; a reachable MCP service alone does not establish an active design session. |
| QwenWork, WorkBuddy | Follow the host's import/marketplace and MCP setup guide for the actual environment, including its tested scope and review limits. Preparing files is not the same as native activation. |

See [host compatibility](hosts.en.md) for exact versions and feature limits. Results from an older candidate, a local source build, or another host do not establish support for the version you installed. Source updates do not update an existing npm installation.

## Foreground review availability

GRA reviews may run in the foreground when the host cannot keep the main conversation available during a background task. You can disable automatic GRA and request a review manually, or explicitly choose a synchronous review for that run. A foreground review occupies the main conversation; it must not be described as nonblocking background execution.

The documented QwenWork `1.3.2-26101704` route cannot create background Agent Sessions. In the recorded WorkBuddy `5.8.3` route, asynchronous child work still occupied the main conversation. These are different host limitations. Use the [host-specific review guidance](hosts.en.md#background-capabilities-and-review-fallback) and the acquired package's actual capabilities. Receiving a suggestion, accepting it and saving a corresponding design change are separate actions.

## Studio source capabilities and installed acceptance

Current Studio source provides tools for inspecting methods, editing current Kit/Bundle content, copying independent identities, managing mounts, previewing panels, trying methods through the native host and sharing source archives. Availability depends on the plugin version and host adapter; consult the [Studio walkthrough](usage.en.md#6-studio-inspect-customize-and-check-kits) and your installed version's controls.

Keep these operations distinct:

- Ordinary saves update the same library identity without a local publication or version-selection step. Projects with their own `design_kit` files remain independent of subsequent library edits.
- Sample preview uses the current source draft with isolated sample data and does not invoke a model. It can check unsaved declarative changes. A native trial reads saved methods and runs in a separate test project; its demonstration save does not prove durable project saving or Agent continuation.
- Source import accepts ZIP files, folders or a Bundle's `SKILL.md` as editable source. Missing auxiliary definitions remain available for completion; loading and preview report their actual diagnostics. Import does not execute scripts, install models or Providers, or change existing projects. Source and license fields are optional; existing attribution remains intact.
- Export reads the last saved source while retaining unsaved source, mount and conversation drafts. Save first if the archive should include those changes. Exporting and sharing a copy does not publish it to a registry or establish compatibility with another host. Check the recipient's complete use/save/reopen path as described in [Kit sharing](kit-sharing.en.md).

The installed `0.2.7` Studio authoring workflow was checked with official DSH
`0.2.1-rc.3` on Windows Web. The tested path covered Kit/Bundle creation and
editing, saved-content consumption by the native Agent, project-copy isolation,
import/export, and reopening saved work. All 48 functional checkpoints passed;
47 interface checks passed and one issue remains below. This does not establish
that every operation has passed on every host. Design-session support does not
by itself verify KAG visuals or every native trial route. Screenshots retain the
scope described beside them.

**Known interface issue in `0.2.7`:** Studio can disable Export after an edit
without explaining why. Save or revert the changes before exporting. The
explanatory feedback has been corrected in source but is not in the published
`0.2.7` npm package.

**Earlier conversation-link issue (`0.2.3`):** a Studio link returned in a DSH
Web conversation could be a relative path that was not clickable. Its correction
was recorded in development source, outside that release. The `0.2.7` checks
above used the normal independent Studio entry; they do not establish that every
conversation-returned link works. If a returned link is not clickable, use the
host's existing Studio entry.

## Historical installation verification: 0.2.3

Fresh registration and an owned update were checked using the published `0.2.3`
npm installer with official DSH/Loader `0.2.1-rc.3`, Node `22.22.3` and pnpm
`12.15.0`. Native registration, configuration readback, preservation of user
settings, and the exact versions and integrity of ten native packages passed.
The checks included explicit approval for the required native dependency build
scripts. The update started from a `0.2.2` installation registered with the
corrected adapter and a valid ownership receipt; it did not establish recovery
of a failed `0.2.2` transaction. These installation checks did not establish Host
startup, model execution or complete Design/Studio workflows. Functional checks
were still in progress at that point, and the results did not extend to other
hosts or versions. They remain historical evidence, separate from the current
release checks above.

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

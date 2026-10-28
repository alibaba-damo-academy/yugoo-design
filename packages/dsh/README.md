# Yugoo Design for DeepSeek Harness

This package owns the internal DeepSeek Harness installation bundle for Yugoo
Design. Users acquire the unified `yugoo-design` product, whose DSH adapter
installs the exact aggregate and internal modules. The first stable product
release, `0.1.0`, is published to npm; acquire the requested exact release.

Official DSH is a read-only Host compatibility target. This package uses public
Cordis, command, tool, Agent, interaction, subagent, Remote, and client-module
extension points and requires no DSH patch, fork, or Design-specific release.
Installing it adds direct Loader rows for generic Core, Panel, Studio, Design
Knowledge, the official Web App provider, and the official Web App content Kit.
DeepSeek Harness discovers each package's browser plugin through its own
`dsh.client` declaration; this distribution does not compile or hide a combined
client.

The Settings launcher source opens the full-page `/design-studio/` workspace,
which uses the same Typert Remote and storage-domain-backed Studio service
without creating a Session or Agent. These source mechanisms do not establish
current Studio authoring or visual acceptance.

`dsh-design-skills-web-app` contains one Mindset plus self-contained Bundle
files, including optional ordinary Agent-facing scripts. Generic Core confines
their execution and gives them no Design Files or Git authority.
The official Web App Kit's 15 Bundles now declare their presentations in
`panel.yaml`, using shared components supplied by `dsh-design-panel`.
`dsh-design-provider-web-app` remains in this distribution for explicitly selected
native presentations and comparison; it is not the default presentation contract
of those declarative Bundles. Neither presentation layer owns generation,
validation, repair, or publication logic. Generic Core, Panel, and Studio do not
depend on the Web App Kit or its native provider. A Kit can revise its validated
panel definition or locale content without rebuilding the Host; introducing a
new shared runtime component or native UI surface requires a runtime release.
Installed-package native-equivalence acceptance remains separate from this
source declaration and is not established by the presence of 15 definitions.

## Daily entry

DSH Web and Desktop use the same Core message producers. Plugin-authored
context, notices and delegated tasks carry the producer-owned source kind
`yugoo-design`; explicit user commands retain `kind: user`. Delivery still uses
the existing non-waking `agent.inject()` or delegated `followup()` operation.
The plugin does not rewrite Session history, replace the Host codec or translate
retired `kind: plugin` messages at runtime. UI presentation and Session protocol
version are separate compatibility boundaries.

Use `/yugoo` in the existing DSH conversation to open the project command help,
or `/yugoo new <name>`, `/yugoo open <id|name|path>` and `/yugoo status` to manage
Design Projects. These commands share the existing project service and native
conversation binding; they do not start a second host or change authentication.

`/yugoo` is the only registered project entry. Yugoo Design does not register
`/design`, even when that name is free, and does not offer it as a compatibility
alias. Another plugin's command remains untouched. A conflict on `/yugoo` fails
registration explicitly. Panel actions use `/yugoo`; internal service, tool and
package identifiers are not additional user command aliases.

### Project storage

New Design Projects default to the system user's Documents directory under
`YuGoo/Projects`, using the same Core registry as Companion. Windows Documents
redirection and Linux XDG user directories are honored; WSL uses Linux storage.
An explicit Core `projectsRoot` takes precedence. This default affects only new
projects: existing projects, registry, native conversation bindings and runtime
state stay at their original paths. DSH authentication and host integration are
unchanged.

## Installation target and current package composition

The product name is **Yugoo Design**. Source package and Loader identifiers remain
`dsh-design-*`; public npm exports use the `@yugoo-design` scope. The brand does
not rename imports or Loader identities.
Official DSH is an external, separately installed host and is not one of the
plugin's system packages. Its agents supply generative model execution, questions,
subagents and search; installing this plugin must preserve the user's existing
model/search configuration and must not ask for a plugin-specific search key.
Design Knowledge uses a separate local CPU embedding model; it does not require
a GPU or replace the host's generative models.

The source composition has six direct dependencies (Core, Knowledge, Panel,
Web App provider, Web App content, and DSH Studio integration) and ten Loader
rows. The complete Yugoo dependency closure contains the ten packages below;
transitive dependencies remain owned by their consuming packages, not added as
aggregate dependencies merely because they occur in a release inventory.
The npm aggregate additionally supplies the two required Studio/Studio UI peers
reached from this closure because DSH disables automatic peer installation.
It does not install unrelated or optional peers from the release inventory.
The selected release manifest fixes exact dependency versions.
The directory column identifies the existing source package, not an end-user
checkout or build requirement.

| Package identifier | Source directory | Role |
| --- | --- | --- |
| `dsh-design-system-dsh` | `packages/dsh` | DSH installation bundle and Loader registration |
| `dsh-design-core` | `packages/core` | Design state, Bundle execution and validation |
| `dsh-design-panel` | `packages/panel` | Shared Panel runtime and components |
| `dsh-design-knowledge-ladybug` | `packages/knowledge-ladybug` | Design Knowledge provider |
| `dsh-design-provider-web-app` | `packages/provider-web-app` | Retained, explicitly selected native Web App presentations |
| `dsh-design-skills-web-app` | `packages/skills-web-app` | Official Web App Kit content |
| `yugoo-design-git-native` | `packages/git-native` | Core's transitive in-process Git runtime; no Loader row |
| `dsh-design-studio` | `packages/studio` | Host-neutral Studio service |
| `dsh-design-studio-ui` | `packages/studio-ui` | Shared Studio interface |
| `dsh-design-studio-dsh` | `packages/studio-dsh` | DSH Studio integration |

The Knowledge provider selects the official `@ladybugdb/wasm-core` at exact
version **`0.21.1`**. This is a separately pinned third-party runtime dependency,
not one of the ten Yugoo package artifacts or a replacement DSH application.
Do not substitute the earlier WAL fork, an unpublished fixture alias, or `latest`.

### Agent-led installation and local release files

Copy the [shared installation prompt](../companion/HOSTS.md#default-prompt-any-supported-host)
into the existing DSH conversation, or explicitly use the
[DSH override](../companion/HOSTS.md#install-or-update-deepseek-harness).
The Agent checks availability of the required exact `yugoo-design` product installer,
stopping if it is missing, then acquires it
from npm and uses its `release-hosts.json` to install the aggregate and internal
modules through the official host. Users do not install the internal modules or
native helper manually.
Use the accepted public installation guide and exact release manifest; the host Agent should:

1. Identify the installed official DSH version and check the selected release's
   required host peers, including Core's Cordis minimum `^4.0.2`.
2. Resolve the selected release's complete exact dependency set, including any
   declared native Git helper and pinned Ladybug `0.21.1`, then install the
   DSH bundle through the official host's package/bundle interface. Preserve
   existing user profiles, models and search settings.
3. Confirm the Loader registrations and open a Design Project with its pinned
   Kit. Run a nonempty Bundle, edit and save its Panel, reopen it, and confirm
   the canonical data and checkpoint. Verify KAG and GRA through actual host
   execution, reporting any capability or credential limitation explicitly.

The CPU-first installation policy applies before acquiring the product installer
and its DSH dependencies. Follow the
[shared installation entry](../companion/HOSTS.md#agent-led-installation-and-updates)
to use `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` while retaining normal dependency
lifecycle scripts. Skipping extra CUDA downloads does not prepare embedding
model files: use the exact model cache or explicit download policy documented by
the acquired version. Loader registration, a database opening and a working host
LLM do not establish semantic indexing. GPU acceleration is outside the
first-release scope; this policy does not change the published
beta.2 archives or their installation acceptance.

Use the selected release's manifest and installation guide, rather than the
versions recorded in [historical release checks](#historical-release-checks).
Normal Design versioning uses the bundled native Git runtime, without
system Git, on Windows x64 MSVC, Linux x64 GNU and macOS arm64. Actual DSH
installation and functional scope still depend on the selected candidate.
System Git remains separate for source development and explicit CLI diagnostics.

If a selected release is missing, report it rather than partially installing a
guessed set. Native suite and Kit/Bundle content versions
do not change with the npm prerelease. Registry acquisition, native installation
and functional acceptance remain separate checks.
The supplied local files below are for pre-publication preflight, rather than
the main public installation tutorial. A package-manager exit code, Loader mount or
MCP listing alone does not prove that Bundle generation, Panel saving, GRA and
KAG work. The developer launcher and clone/build steps are not the user install
path; Companion hosts use their own adapters rather than this DSH bundle.

### Current DSH host admission

Official DSH Web and Desktop **`0.2.0-rc.2`** are the current release target. The affected
host peers and development SDK pins require exact `0.2.0-rc.2`. The current
Agent setup and lifecycle APIs differ from earlier releases, so older versions
are no longer declared compatible; unknown RCs, `0.2.0` stable and React 19 are
not admitted. Historical local results below
retain their original versions and are not current-host acceptance evidence.
Loader compatibility uses its own prerelease policy and is not a substitute for
the package manager's strict peer resolution.

Run Core's `test:dependency-baseline` and `test:consumer-dependency-baseline`
after building the workspace dependencies to check exact SDK pins, strict
peers and shared Cordis identity. Compilation and `typecheck` are separate
checks. The focused V4 gate requires an explicit `DSH_TEST_WEB_ANCHOR` naming
an installed Host package manifest, or `DSH_TEST_ASAR` naming the actual
Desktop archive. The content-upgrade SDK test uses the Web anchor. These
read-only SDK inputs and scripted-loop tests do not establish rendered UI,
native model execution or recovery of an already failing live conversation.

The official RC2 factory supplies `setup(ctx, agent)` with an independent
child scope. Producer and Worker adapters capture only the authorized parent
tool definitions before creation, close inherited globals, then register those
exact definitions and their own confined capabilities in the child scope.
They do not require the historical `inheritParentAgentScope` Host patch.
Initialization uses the Host's awaited `agent/created` event. These public API
adaptations replace our need for the old fork behavior; they are not a claim
that the official Host incorporated that patch.

Bundle result reporting keeps execution provenance separate from the derived
U/S/T assessment. Worker completion is reported only from the current Host's
bounded, invocation- and conversation-bound observations, with the exact child
lifecycle and Host-computed receipt checked against the accepted publication's
canonical reference and artifact bytes. A rejected call, a missing or truncated
observation, a Producer fallback, or a model's assessment text is not a successful
Worker receipt. Missing provenance remains explicitly unverified; persisted
Bundle content is not rolled back because execution reporting is unavailable.
These checks do not reconstruct lost in-memory observations after a restart or
claim that a live native-model reporting regression has passed.

Background G/R/A reviews create a native Host Agent with child-local read-only
capabilities installed before publication or model work. On the tested RC2
one-shot API, a one-run, grant-bound provider uses the public Subagent Runtime;
the Host owns parent-catalog registration and native start/end events. Provider
registration is released on disposal or a rejected start. On the tested
`0.2.1-rc.3` activation API, the adapter uses the public `agents.create` factory
directly: external activations reject existing local Agents, and local
activations do not expose the review's creation-time setup. This branch retains
real Agent/Session identity, parent lineage, native turn logs, cancellation,
disposal and structured-result validation. It does not provide Subagent Runtime
catalog/history, manager start/end events or the manager's concurrency pool, and
does not fabricate those records. Background completion does not wake the main
conversation. API capability selection happens before starting; unknown shapes
fail explicitly, and a failed start never triggers a different backend.

The adapter admits native `spawn` only; another configured provider fails
explicitly. It snapshots the parent's model route, depth and delegated policy
before asynchronous evidence loading, enforces the depth bound, and validates
the exact live parent. Initialization failure never counts as a running review.
It inherits the parent's model route,
but does not inherit shell, write, script, publication or delegation authority.
A monotonic tool guard also rejects unexpected child-local tools and same-name
replacements before execution. Nested dispatch and unverified PTC transports
are not admitted. Host-owned Session logging and advisory publication retain
their existing owners.

Review file reads use one full Git commit, including its own `project.json`
and exact Kit/Bundle overrides. Bounded source and resource reads use the
existing Git and content loaders; they do not discover files across the host
filesystem. The resource manifest distinguishes loaded method/schema
projections from raw resources and from committed project facts. Missing exact
content is an explicit error, never a latest-version or source-checkout fallback.
Structured results still pass the official profile parser and staleness check
before the existing publisher. Run Core's `test:advisory-readonly` with an
explicit `DSH_TEST_WEB_ANCHOR` for the RC2 factory/tools/loop regression or
`DSH_TEST_ASAR` for the installed RC3 archive. The RC2 catalog assertions remain
version-specific; RC3 instead verifies the actual child lifecycle and explicitly
absent manager records. Scripted-model tests are separate from native model and
installed-host acceptance.

On the current host, advisory settings use the owning plugin's live `Config`
fields and the public `SettingsForms` projection. The host owns profile entry
identity, persistence and change delivery; the plugin creates no second settings
store. The Studio launcher consumes Slots and Locale only, retaining its
`settings.section` registration without requiring the removed, unused
`settingsScope` service. Pending question cancellation reads the current
session-status projection while preserving the exact session and question id.
Only an actual cancellation channel is invoked: the current host's hide-only
tool-call card dismissal is not reported as cancellation.
Existing settings-section adapters remain in source without qualifying older
Hosts for this release; unknown interfaces fail explicitly rather than being
replaced by empty or fake services.

Public API checks and isolated lifecycle fixtures establish only their tested
boundaries. The fixed beta archives still require actual strict installation,
native activation, browser interaction and functional regression as separate
acceptance steps; this declaration does not claim those outcomes.

### Unpublished release: official local workspace route

This route verifies a received fixed local candidate before registry publication.
Its historical installation results remain tied to those archives; they do not
establish beta registry acquisition, update or native-host acceptance.
The ten-archive recipe and receipts below describe that historical set. For a
newer candidate, use its supplied complete package inventory, including any
required native Git helper, rather than reusing the historical package count.

The local delivery includes ten compiled `.tgz` packages, `PORTABLE-INPUTS.json`
(archive filenames, package identities and SHA-256), `PORTABLE-PROVIDERS.json`
(exact public dependency versions), `portable-install.mjs`, and
`PORTABLE-RECIPE.md`. Keep these files together. No source checkout, source build,
host patch, package-manifest rewrite or developer dependency tree is required.
This is the local-file route for the same product, not an additional Companion
installation inside DSH.

The checked host is official DSH **0.1.2-rc.1**. Its actual `plugin` command
forwards **pnpm 9.15.4**; verify that command rather than a separately installed
pnpm executable. React and ReactDOM remain **18.3.1**.

Have your host agent perform these steps using recipient-owned absolute paths:

1. Initialize a new `yugoo-local` profile through the official DSH CLI with an
   explicitly owned `DSH_HOME`, separate from your existing home and profiles:

   ```sh
   DSH_HOME=/recipient/owned-dsh-home node /recipient/official-dsh/lib/bin.js \
     plugin --profile yugoo-local --version
   ```

   This normal first use initializes the profile and probes the forwarded pnpm
   version; there is no separate `init` subcommand in this recipe. Preserve your
   existing model, search and credential configuration.
2. Verify every archive against `PORTABLE-INPUTS.json`. Safely extract its
   compiled `package/` contents into the profile's `packages/<package-name>`
   directory, using the unscoped name (for example,
   `profiles/yugoo-local/packages/dsh-design-core`). Reject absolute/traversing
   paths, links and special archive members;
   verify the unchanged extracted package name and version. Do not rewrite them.
3. Retain the profile workspace root (`.`), add `packages/*`, and preserve the
   official `nodeLinker: hoisted` and `autoInstallPeers: false` defaults. Use a
   separate empty npm userconfig for this isolated installation.
4. Run the supplied helper without `--execute` to validate inputs and print the
   exact official command. It compares every original regular archive member
   against staged bytes and executable modes, rejecting missing or changed
   files, unsafe archive paths and symlinked staged paths/profile directories.
   Matching package names and versions alone are insufficient. Replace all
   example paths with your own:

   ```sh
   node portable-install.mjs \
     --dsh-bin /recipient/official-dsh/lib/bin.js \
     --dsh-home /recipient/owned-dsh-home \
     --archives-dir /recipient/release-files \
     --npm-userconfig /recipient/empty.npmrc
   ```

5. Review the printed command, then explicitly add `--execute` to install. It
   uses the ten original workspace packages and exact public providers through
   the official CLI, with strict peer checking and explicit hoisted/no-auto-peer
   settings. The helper does not initialize profiles, extract packages, start
   DSH or configure models. Do not add `--no-frozen-lockfile` to `pnpm add`.
6. Check ten Loader identities, the aggregate registration, exact root providers,
   Core-local host dependencies, all declared peer ranges and all runtime entry
   resolutions. Then start the official host and perform the project/Kit and
   save/reopen checks described above; dependency installation alone is not
   functional acceptance.

The actual isolated official installation completed with strict checking:
ten Loader identities, eleven runtime entries and 52 declared peer checks passed.
The corrected helper's final ten-archive dry-run verified 1,198 original members;
eleven negative controls, including real older staging paired with final
archives, were rejected. Its `--execute` path subsequently installed those final
ten archives successfully; post-install checks retained all 1,198 original
members and matched 57 pinned providers. These results establish installation/load composition only,
not Cordis activation, all Panel interactions or another-machine acceptance.
Keep installation receipts and the owned profile for inspection and recovery;
no automatic rollback is promised.

### Host activation and content watching

For the checked official DSH 0.1.2-rc.1 composition, select the profile's public
`patchReload: startup` mode. Include the official `@deepseek-ai/dsh-web-app`
0.1.2-rc.1 carrier when opening Studio; its `webServer` service is required by
the Studio page. Keep the server on loopback and use the host's normal
authentication. An unauthenticated HTTP 401 confirms neither a usable page nor
Panel acceptance.

Install the official base and Web App carrier into that same owned profile,
after the local design packages and their pinned peers have been installed:

```sh
DSH_HOME=/recipient/owned-dsh-home node /recipient/official-dsh/lib/bin.js \
  plugin --profile yugoo-local add --workspace-root --save-exact \
  @deepseek-ai/dsh-base@0.1.2-rc.1 @deepseek-ai/dsh-web-app@0.1.2-rc.1 \
  --strict-peer-dependencies --config.node-linker=hoisted \
  --config.auto-install-peers=false --registry=https://registry.npmjs.org
```

Do not mix profile-local Agent plugins with fallback base modules from a different
installation. Matching version strings alone are insufficient: Agent loop,
presets and session controller must resolve the same physical `dsh-scope` module.
Separate module instances have different scope symbols and can reject session
creation before any model request. The checked normal profile installation
resolved all three consumers to one module; it did not patch the official host.

The setting lives in the owned profile's `package.json` at
`dsh.profile.patchReload`, not in a separate `profile.json`. Preserve the existing
bundle list when setting it. The official launcher accepts repeatable `--patch`
overlays; a recipient command has this form:

```sh
DSH_HOME=/recipient/owned-dsh-home node --expose-internals \
  /recipient/official-dsh/lib/bin.js --profile yugoo-local \
  --patch /recipient/official-dsh-web-app/cordis.patch.yml \
  --patch /recipient/owned-runtime.patch.yml \
  --host 127.0.0.1 --port 0 --no-open
```

Use your installed carrier's actual path and an owned runtime overlay for Core
project/state roots and any explicit Kit watcher settings. Do not copy test
directories or overwrite existing model/search settings. The verification below
called the launcher's installed `runProfile` implementation; it did not execute
this example as a separate CLI process.

This mode requires restarting DSH after changing host Cordis patch configuration.
It does not disable the Design Kit content watcher. To watch a package-backed
Kit, explicitly set `watch: true` on its existing Kit Loader configuration,
retaining its `packageName` and discovery settings. In the earlier validated
installation, which bundled both Web App and Decision Modeling, the installed
`runProfile` implementation started successfully, exposed those Kits and read an
existing Design Project. With that watcher enabled, an isolated same-version
Web App mindset edit became visible through the actual Kit catalog; the original
content was restored and the project's thirteen Design Files remained unchanged.
These checks used the earlier validated installation, not a replay of every
final release archive, and did not create an Agent or invoke a model.

Do not select `patchReload: live` as a workaround: the checked official
composition calls `hmr.registerConfig`, which its installed HMR 1.0.19 does not
provide. This host patch-reload limitation remains unresolved; no host patch,
fake HMR service or automatic dependency upgrade is part of this delivery.
Successful startup/content watching does not establish authenticated UI,
generation, save/reopen, KAG or GRA acceptance.

For content authors, see the existing [Creator and Panel declaration guide](../../docs/wiki/extending.md#panel-选择).
Reuse the actual generic component catalog and preserve schema bindings, stable
IDs and locale resources. Validated Kit content reload/version updates apply
Panel and locale declaration changes without recompiling the runtime; source
edits do not automatically update installed packages or switch project pins.
New runtime components or executable Provider changes require their own build
and release.

### Candidate npm installer: DSH route and recovery limits

The product CLI route is `install --host dsh`; the historical Companion
`0.1.0-beta.3` was an earlier distribution of this adapter. The unified
`yugoo-design@0.1.0` product is published. This is an installer adapter
for the separately installed official DSH
host, not a bundled DSH application or a desktop Companion runtime inside DSH.
Yugoo Design has one product installation entry. For DSH, that entry installs
the exact mapped aggregate and its internal modules automatically; users do
not install the internal packages individually. DSH itself remains an external
host. The Companion payload is not registered as a DSH bundle.

This route requires an existing isolated or user-selected DSH profile, an
absolute `--dsh-config` JSON file pinning the official Node/CLI/Loader inputs,
`--profile`, and an external `--receipt-dir`. A bound product
`release-hosts.json` supplies the exact aggregate version and default HTTPS
registry. An optional `--aggregate-selector` must match it. An explicit
credential-free HTTPS `--registry` may select a download mirror; it does not
change the exact release version or the canonical origin in that mapping.
Use the same effective registry for dry-run, apply and receipt-owned updates;
neither origin nor transport migration is implicit. The plan/receipt records
both, with no automatic fallback or global registry configuration change.
For a release set, use the exact aggregate version recorded in that product
candidate's `release-hosts.json` and its default registry or an explicitly
selected mirror with matching release integrity, preserving
the complete dependency set's exact package pins, including any declared native
Git helper. Do not substitute an earlier release or beta package.
This identifies the intended release;
it does not establish registry availability or authorize publication. Older or unbound candidates
retain the explicit selector and registry compatibility route. Use `--dry-run`
first and keep its saved plan; `--apply` consumes that exact plan. Do not pass the CLI's display
object in place of the saved plan. Output plans and result receipts are written
outside the package, host home and pinned input directories, without replacing
existing files. Codex-specific runtime and receipt flags do not apply here.

An official package operation can fail after changing host state. The adapter
reports `failed-partial-state-retained`, keeps its result receipt and exits
unsuccessfully; it does not promise automatic DSH rollback, recovery or
uninstallation. Inspect the retained state before taking another action.
Loader/configuration readback does not establish runtime or model execution.
This registry adapter has source-level contract coverage; it does not accept
local tarball selectors. Before registry publication, only the supplied local
workspace route above is available for candidate preflight. Do not substitute
fixture selectors, `latest`, or a clone/build workflow. After publication, the
host Agent uses registry acquisition and this mapped product adapter; the prior
local-install result does not establish that installation or update path.

## Automatic Kit discovery

The default distribution explicitly loads the bundled Web App content Kit
through a standard package-authority Kit Loader row, then discovers additional
content Kits under `$DSH_HOME/design-system/kits` (default
`~/.dsh/design-system/kits`). Each direct child is a Kit directory containing
`mindset.md` and `skills/`. Missing roots are optional and are not created by
the loader. Additional absolute `discoveryRoots` extend this search; they do
not replace the default root. The source-checkout `./start.sh` also configures
the repository `packages/` root for development-only content discovery.
Additional user Kits placed in the default root need no per-Kit registration
or Host source changes. Bundled Kits instead have explicit distribution dependencies
and package-authority Loader rows; neither installation path requires start.sh.

Discovery validates and registers content without executing its scripts.
The installed catalog is shared by `/yugoo kit <name>`, natural-language
selection, and Studio (`followInstalledSources: true`). Native renderer/runtime
drivers still require their own installed provider; discovery does not invent
missing capabilities. Explicit sources load first and retain their authority;
duplicate physical roots are skipped, and conflicting names are diagnosed
without replacing an installed Kit. Directory ordering is deterministic.

New Kits and valid edits are watched by default. Invalid edits or deleted
sources retain process-level last-good content, including the selection
catalog, with a diagnostic; scripts/source inspection may be unavailable after
deletion. Existing version pins remain resolvable until shutdown. Restarting
loads current files only: it does not restore a removed Kit from hidden storage.
Changing a Kit's identity in-place requires a restart. `watch: false` disables
watching and the bounded configured-root existence checks.

The Portable Kernel owns Design Projects, Kit and Bundle versions, validation, execution, DesignJournal, Design Knowledge, advisories, and the shared UI. The DSH Provider maps Host identity, model-context delivery, subagents, commands, tools, and panel transport to DSH public capabilities. It exposes `ctx.userQuestions` for an in-turn blocking question when Bundle policy or the Agent requires native ask-user. Persistent asynchronous continuation appears in the plugin continuation UI, and acceptance enters as an ordinary logged user turn; advisory dispositions remain plugin-owned review decisions. Its plugin-owned binding store maps an opaque DSH Session id to the selected Design Project. No Design Project, Kit, Design File, or clarity-specific DSH Session events or projections are required; the standard `designAdvisoryInbox` projection is only a refresh/read-model mechanism and is not Design authority.

Core owns both automatic read-only assessment and explicit main-Agent reporting.
Every successful `run_design_skill` completion remains attached while Core
synchronously evaluates U/S/T against that exact published Git commit. The
assessment is promoted to the shared project clarity authority and returned with
the completed result. A bounded evaluator failure never rolls back the Bundle
commit; it marks clarity failed so the main Agent cannot derive a next
recommendation from stale scores. `report_design_clarity` remains the explicit
main-Agent path for other meaningful checkpoints, including its existing
once-per-turn and exact-replay rules.

Meaningful Panel saves are assessed by the main Agent in the same native
continuation turn. After Git, DesignJournal and required gate settlement, the
server injects the saved diff and exact assessment input before Save returns.
The input pins the project, its selection revision, checkpoint, effective Kit
content and bounded human scope. The client retains the normal native prompt
and echo; its compatible receipt-metadata RPC is passive and starts no detached
evaluator or pending activity. The main Agent calls `report_design_clarity`
with the latest saved input before its final reply or next-step recommendation.
Several saves before continuation require one report of their latest checkpoint;
an unchanged or replayed save needs none. A valid current assessment already
returned by `run_design_skill` is used without a duplicate main report.

The explicit report requires complete input for the latest durable Panel-origin
change; non-Panel legacy callers retain optional input. It rejects obsolete
supplied input and retains the existing
currentness, cancellation, Journal and guarded authority-replacement fences in
the [architecture baseline](../../docs/system-design-baseline.md#agent-host-and-user-interface-integration).
Once-per-user-turn and exact replay remain unchanged. If another save invalidates
an already successful report in the same turn, the Agent withholds recommendations
from stale scores until the next real user boundary. No browser metadata,
displayed text or inbox claim manufactures a report or a user turn. Bundle
completion still synchronously evaluates and returns its exact checkpoint;
G/R/A stays in the background. Save, native admission, assessment and Agent
consumption need separate native Web/Desktop and installed-candidate evidence;
source or scripted lifecycle coverage is not that acceptance.

Every Design Project records the exact knowledge provider in `project.json`. This DSH composition creates new projects with `ladybug-wasm` and opens that project's embedded database below its external runtime-state root, never inside the Git repository. Project switching opens and materializes the target before replacing the binding-store selection, then releases the previous handle. Provider or materialization failures leave the prior selection active and fail visibly.

Grounding, reflection, and alignment are Kit-neutral built-in profiles. Successful Design publication automatically admits bounded KAG maintenance. GRA follows a separate project policy: auto combines Agent judgement with a configurable quiet merge window (default 30 seconds); continuous rechecks the latest published version every configurable N minutes (default 10), even unchanged; off disables autonomous GRA while explicit human rechecks remain available. Continuous scheduling runs online only, skips busy rounds without catch-up, and does not cancel an active reviewer. Legacy every-publication queues remain readable but are not offered in the new UI.

The lightbulb Design advisories entry opens its settings even with zero suggestions. Settings persist outside Design Files; Clarity and KAG are independent. Reviewers consume bounded persisted suggestion dispositions: pending/deferred issues should not be repeated, rejection is not a permanent ban, and new evidence must explain why reconsideration is warranted. The journal suppresses exact evidence/action duplicates, not fuzzy semantic matches. No suggestion is automatically accepted or rejected.

Pending targets survive restart; attempted evaluations are not automatically replayed as the same attempt. Historical results cannot update current advice, Clarity, or a newer KAG. Foreground Producer work does not block review of earlier completed designs: a running `run_design_skill` call explains editing scope, while the immutable commit boundary excludes unpublished content. The loops inherit the primary Agent's model route and credentials, never block the foreground conversation, isolate profile failures, and expose aggregate operational state through `/yugoo status`. Grounding checks deterministic cross-file consistency, Reflection recommends Research for external-knowledge uncertainty, and Alignment routes user-only decisions through the semantic Question capability. Every loop investigates committed Design Files with read-only Git commands, may use checkpoint-matched KAG as an optional discovery aid, performs its own stale checks, and publishes without waiting for siblings. There is no atomic G/R/A set or cross-profile input flow. Selecting or closing a Design Project cancels old analysis; the binding store and DesignJournal then expose only the selected project's evidence and clarity.

Design Kits are content packages managed by the Design System. They do not install or remove system capabilities. Deployment overlays may configure model providers, credentials, budgets, and other tunables, but must not reproduce this package's plugin roster.

The official DSH composition enables optional native delegation through the execution plugin's `delegation` configuration. Each candidate child receives up to four structured submissions so validation feedback can repair a complex artifact within one isolated worker context. Deployments may tune the provider and resource bounds there; disabling the group leaves the Producer serial without changing completion semantics, and a rejected candidate never settles merely because its submission budget is exhausted.

`pnpm run test:release:physical-distribution` at the repository root proves the isolated physical package closure: it packs this distribution and its internal packages, installs them in a consumer outside the source workspace, and rejects entry points that resolve back through the workspace. It does not install or boot an official DSH Host. The linked-profile composition gate against the pinned official DSH submodule is the official-Host compatibility check. Both gates are required before release because neither package closure nor Host compatibility implies the other.

Planned Codex and Claude Code Host Providers will reuse the same Portable Kernel, projects, Kits, execution rules, and shared UI. Their first implementations discriminate the capabilities published by the installed CLI version and do not assume native programmatic questions, subagents, or panel APIs. When a CLI cannot embed the UI, its provider opens a session-bound browser companion and keeps the originating CLI as the primary Agent surface. Those providers are not implemented by this DSH package.

## Historical release checks

These dated checks describe earlier artifacts, not the versions to select for a
new installation. Current source composition is listed above; installation and
functional acceptance depend on the selected release.

### 2026-10-17 UTC

The npm scope is `@yugoo-design`. At this check, metadata was verified for the
product installer `@yugoo-design/companion@0.1.0-beta.3` and all eleven DSH
packages at `0.1.0-beta.2`, including `@yugoo-design/yugoo-design-git-native`.
Their `beta` tags selected those exact versions. The set included Decision
Modeling; it is not the current source default listed above. Only the native Git
helper had `latest` at beta.2; Companion and the original ten DSH packages
retained beta.1.

Eight archives were fully downloaded and matched their digests. Four transfers
(native Git helper, Panel, Web App provider and Companion) returned HTTP 200 but
timed out after 90 seconds with partial bodies (`curl` exit 28), not digest
mismatches. Full twelve-archive verification was incomplete; this check did not
establish cold registry installation or native-host installation/update
acceptance. The separate cache-only Companion installation result is bounded in
the [preview status](../../docs/wiki/preview-status.md).

### 2026-10-14

At this check, the product installer `@yugoo-design/companion@0.1.0-beta.2` and
all ten owned DSH packages at `0.1.0-beta.1` were publicly available, with anonymous
downloads matching the reviewed archives. Companion's `beta` pointed to beta.2
and initial `latest` remained beta.1; DSH's two tags pointed to beta.1.

### Internal extension validation

Decision Modeling is an independent internal extension-validation Kit, not
included, automatically loaded, or published by the default DSH/Companion release.
Its internal validation uses explicit installation/import without changing the
generic Core; it is not a public installation step.

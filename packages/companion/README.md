# Yugoo Design — Companion host integration

For host-specific installation, startup and maintenance, start with the
[host integration entry points](HOSTS.md).

- Install or update: use the [shared host prompt](HOSTS.md#default-prompt-any-supported-host).
- Inspect the released package: read the [maintained npm guide](#maintained-npm-package-guide).
- Develop an adapter: use [build and verification](#build-and-verify-repository-checkout); source commands are not extra installation steps.

The [Mac Codex Desktop guide](hosts/codex-desktop/README.md) starts with
npm-backed plugin preparation and native activation, followed by the existing
source development route. Both keep the original conversation and use a
host-launched notification bridge. Runtime checks, native loading and actual
design use have separate verification boundaries.

New projects use the system Documents directory under `YuGoo/Projects`, shared
with the native DSH integration. Windows honors Documents redirection/OneDrive;
Linux honors XDG user directories (WSL uses its Linux user); macOS uses
`~/Documents`. Missing, disabled or invalid Linux declarations use `~/Documents`.
`--projects-root` overrides creation storage for both CLI commands and the MCP
server. Registry, selection, connection files and caches keep their existing
locations. Previously registered projects remain at their exact roots; they are
not moved, and opening them does not require the new Documents destination.

Each configured Design Project owns one editable definition tree at
`design_kit/`: Kit files in `kit/` and complete mounted Bundle trees in
`bundles/`, alongside its existing `design_files/`. Methods, schemas, Panels,
resources, scripts and CLI validation all use those project files. A library
edit initializes future projects; it does not change existing projects. Ask the
Agent in the ordinary conversation to compare or apply library changes when
wanted, preserving project customizations and design data through the existing
edit, validation, save and Git paths. Saving requires no content release,
version selection, upgrade wizard or remount.

Old projects initialize this tree once from their actual retained closure.
Missing or invalid existing project sources report their real error instead of
falling back to library content. Subsequent reads refresh changed definitions;
a concurrent edit during execution cannot silently substitute a different
schema at settlement. Design Files publication, Git history, human handoff and
npm package versions retain their separate responsibilities.

The released npm product package and CLI are `yugoo-design`. Companion names the internal
host integration and shared browser runtime, not a second product to install.
The former `@yugoo-design/companion` package and its beta versions remain historical
records; no compatibility package or beta default is provided for this release.
Retain the required exact version and integrity for acquisition and updates.
Source changes, publication and installed-host acceptance remain separate. See the
[shared installation prompt and registry status](HOSTS.md#agent-led-installation-and-updates).
The browser mounts the shared `DesignWorkspace` and project sidebar. Panel
presentation follows the installed Kit: shared declarative components, retained
A2UI, or an explicitly selected native renderer. It does not start DSH or another
model runtime.

Standalone `serve` owns terminal SIGINT/SIGTERM cleanup. It waits for startup,
then closes the Companion service (including project database handles, HTTP and
its connection file) before calling the Knowledge runtime's public terminal
shutdown. Repeated signals join one close operation; cleanup failure exits
nonzero. The CLI verifies the `@ladybugdb/wasm-core@0.21.1` entry/dispatcher bytes
and synchronously initializes its reviewed `threads@1.7.0` worker
selector and replaces only its two verified auto-exit callbacks, which otherwise
terminate the database worker before asynchronous service cleanup. Unknown bytes
or an implementation already loaded outside this lifecycle fail startup rather
than removing unowned listeners. Other process listeners remain installed.
This policy is confined to standalone CLI `serve`; reusable `startCompanion` and
the reloadable DSH provider retain their own host lifecycle and worker ownership.
Packaging emits this Companion-owned adapter as the fixed
`knowledge/cli-lifecycle.mjs` asset, in both directory and portable packages.
Its database load uses the existing Knowledge dependency closure. Service
scripts still reject every external npm dependency; only the exact sibling
asset is admitted and physically checked. Source execution uses the same
Companion module directly.

The sidebar can collapse to an icon rail. Its conversation button toggles the
message column without discarding the draft or reading position. The native
project header stays at the top; connection details live inside the conversation.
Enter sends a message; Shift+Enter inserts a newline, and input-method composition
does not send. Confirmed user-input or queue acceptance notices disappear after
five seconds, independent of host name. Unverified delivery, Hook-only receipts,
resume-required queues and failures remain visible for follow-up. New actionable review suggestions automatically
open the card above the composer. Expanded details grow above the composer to
fit their content, bounded by the conversation region with a scrollable list;
unchanged polling does not reopen a dismissed card.

### Embedded host panel-only view

Embedded adapters declare startup `browserDefaultView: "panel-only"`; the Mac
Codex desktop entry (`--codex-desktop`) sets it explicitly. Opening its returned
browser URL without a `view` parameter then opens the Panel directly. Other
entries default to `"full"`. A page can override the default with
`?view=panel-only` (`view=design` remains an alias) or `?view=full`.
The panel-only page keeps the design workspace, project tools, settings, review
status and suggestions. It omits history/composer and the conversation toggle.
Its right sidebar starts collapsed. The workspace omits the project header;
Bundle tabs start at its top edge. A "Current project" entry in the right sidebar
opens on hover/focus and pins on click, showing the shared U/S/T assessment,
project name and full wrapping path. Score explanations remain keyboard accessible;
Escape, the close button and outside click dismiss the information popover.
This is an embedded-browser scene-specific layout, not the default
for DSH, full Companion or Studio. Native/full header layout remains unchanged.

Design suggestions use that same sidebar's lightbulb: the existing inbox opens
beside the actual button in a bounded, non-modal popover, without a full-workspace
backdrop. The design stays visible and usable. Outside click or Escape closes
the popover; an open review-settings dialog handles its own Escape first.

The adapter default applies only when `view` is absent; explicit Studio and
trial-panel routes retain their own presentation. It is not inferred from browser
access policy, user agent or window size, and is not a global preference. The
same service can have a panel-only host page and an independent `?view=full`
browser window. Changing layout does not restart, select a project, rebind a
conversation or grant access.

### Browser access policy

Startup `browserAccess: "token" | "local"` (CLI `--browser-access`) controls
browser admission; URL parameters and tool arguments cannot change it. Existing
CLI callers default to `token` and retain their fragment/session-storage entry.
The WorkBuddy local package explicitly selects `local` in its runtime config.
Local mode serves `/browser/<instance>/` without a bearer token or storage:
refresh, history-back and a second browser work for the life of that service.
The public instance id rejects stale pages after port reuse; it is not a secret,
project id or substitute for exact native conversation binding.

Local mode treats the local browser as the user's application. It retains exact
Host/Origin checks, JSON plus a custom request header, no CORS, and an explicit
UI-operation allowlist. Native execution/tool operations still require the
separate connection-file token; the message relay has a separate key. DSH native
integration continues to use the DSH Remote and its own access policy. This mode
is not a remote or multi-user authentication system; select token admission when
that access boundary is needed (token admission itself is not multi-user roles).

WorkBuddy's original widget automatically connects after both exact metadata and
host-channel readiness. It does not send a fabricated message or navigate merely
to bind. In panel-only, "其他打开方式" keeps "在系统浏览器打开" as a collapsed,
optional full-view action. Full-view entry still exposes that button directly;
connection recovery remains directly visible in either view. Failure stops
rather than replaying an uncertain save/message. Keep the original control alive
for routing; a browser being visible alone does not prove host receipt.

Foreground-history polling runs only while the conversation column is visible.
Collapsing it pauses its subscription and child-log rendering while retaining
the composer draft; expanding it reads the latest native records immediately.
Design-view pages make no foreground-history requests. Review-operation records
are requested separately only while their dialog is open; its response omits
foreground messages. Workspace refresh, native run verification, KAG and the
existing save/notification transport remain independent. This saves browser
history requests/rendering, not every native transcript read needed for execution
verification. Two visible full-view pages still each own a history subscription.

WorkBuddy can open the returned local Panel URL through the native `present_files`
tool. After a successful open-panel result, pass `nativePreview.arguments` unchanged
to that native tool once; it is not an MCP wrapper call. The host controls the
preview container and toolbar, so this route does not guarantee an address-bar
browser tab. Reuse a successful navigation result and the same live project/service.

If native navigation is unavailable, use the live Panel's browser-opening or
copy-address action. The browser-access URL may be passed unchanged to an authorized
native navigation tool; the separate message-relay credential remains in host-only
metadata. A connected relay, page navigation, a durable save and consumption by the
original Agent are separate outcomes. See the [WorkBuddy guide](hosts/workbuddy/README.md)
for current setup and host-specific limits.

The simplified widget uses "连接当前对话" / "已连接当前对话", with no view dropdown.
Its connection lets "保存并继续" send saved results to the original conversation;
file persistence itself is independent. Opening a browser and consuming saved-edit
notifications remain separate acceptance boundaries. Full view still opens via
the widget, and CLI and DSH integration behavior is unchanged.

See the [shared entry contract](HOSTS.md#connection-page-presentation-and-access)
for project/session binding, page presentation and transport admission. Loading
a URL in a native browser does not establish embedded lifecycle APIs. Existing
loopback authentication, Origin checks and frame restrictions remain in force;
DSH retains its own native Remote and authentication.

## Native Bundle execution mapping

Model-facing MCP and CLI `call` responses are compact views, not new authorities.
Status carries one full assessment under `services.ust.assessment` and one review
list, without conversation history or canonical Design Files. Read
`design_status` with `details: true`, or CLI `call --full-response`, only when the
complete workspace/Host protocol is needed. Browser API reads are unchanged.
Preparation retains the complete version-pinned Bundle method and shared native
instructions once, structured file ownership/validation arguments, cooperation
and knowledge guidance; unsupported WorkBuddy Workers add no Worker method.
U/S/T context remains available from `design_main_context`, not duplicated in
every Bundle preparation. Finish receipts retain commit, acceptance, repair and
recovery diagnostics and generated-Panel follow-up, without retransmitting the
whole state/diff. Accepted, committed, and completed remain different facts.

When Runtime publishes a pending `user_continue` action, Companion presents the
shared continuation bar above the conversation composer. In Panel-only view,
or while the conversation is collapsed, the same single entry appears in Host
chrome above the design workspace. Continue sends the declared action label
through the ordinary native conversation path. Adjust focuses an available
composer without changing its draft; it is absent when there is no composer.
Later dismisses that invocation locally across polling and conversation toggles;
a different invocation can appear again. Read-only access, unresolved edits and
save/notification work disable Continue with a reason. A submission attempt is
not replayed by polling or view changes; an uncertain receipt must be checked in
the original conversation. Reloading never submits automatically. Studio trial
Panels do not expose this execution entry.

Save continuation reuses the actual saved diff. It is a change record, not a
claim to contain the whole state. Read missing relevant evidence, finish the
authorized revision, then assess U/S/T at a meaningful task boundary. Prepare
manual reviews after planned edits, not before a known subsequent rewrite.
Neither due reviews nor an unavailable derived service inserts a mandatory
assessment/review stage into ordinary design work. Uncertain delivery is never
an automatic retry signal, including through the local CLI bridge.

Every `prepareBundle` response includes the same shared `executionContract` and
prefixes its `method` with that contract before the unchanged, version-pinned
Bundle method. Main and Producer placement use the same mapping: the native Host
file tools author only the active Bundle's working files; installed CLI `validate`
provides a preflight with the exact entry, Kit and content-store context when
all are available; `design_finish_run` or
`design_finish_main_bundle` performs authoritative validation and publication.
Bundle references to DSH tool spellings are operations to map, not a requirement
to discover additional MCP tools. Forward the complete prepared method and
contract to the actual executor, including on same-Agent resume.

This mapping does not grant native permissions, spawn an Agent, change placement,
make Workers/GRA available, or allow main to repair a Producer's files. An actual
missing native file/command capability is reported with the executor's tool and
permission evidence. Source regressions do not establish installed-host usage.

## Verified scope

Studio trial results reuse the child runtime's `?view=trial-panel` presentation:
the normal `DesignWorkspace`, without the host
sidebar or conversation column. Only an owned trial child permits this exact HTML
route to be framed by its trusted parent origin. Other routes retain frame denial;
the child API still checks its own origin and token. Trial-only demonstration save
flushes the existing editor barrier and accepts a browser-local baseline, so the
Panel shows its saved UI state without filesystem writes, publication, knowledge
refresh or Agent continuation. Undo restores that local baseline; refreshing the
page restores the actual generated result. Normal Panel saving is unchanged.

Studio opens from Settings in a separate browser tab (`?view=studio`) using the
same Companion service, authorization and native binding. Its token is carried
only in the initial fragment, then removed from the address; the Studio route is
retained on refresh. The page mounts the shared Studio workspace without a second
conversation poller or runtime. The launcher uses `noopener noreferrer`, and
unsaved authoring changes retain the shared browser-unload guard. This aligns the
page presentation with DSH's existing full-page launcher, not the hosts' optional
authoring/trial capability availability.

The main conversation exposes `design_studio_customize` over that same private
connection and working-copy service. It discovers installed pins, copies or
reopens Kit/Bundle content, reads source, prepares a diff/preview and saves
authorized changes with the existing revision and digest checks. Use
`prepareChanges` to inspect a candidate, then explicitly authorize `saveChanges`
in draft or validated mode. These operations customize reusable authoring
content; they do not edit a Design Project, publish a version or start a model.
The shared editor's **Refresh working copy** action reads saved conversation-side
changes.

Studio catalogs and installed read-only content do not open or poll a conversation.
Explicit **New** or **Edit** enters the object editor, with source files selected
first and the same bound Host conversation inside the content area. Product
navigation, the top bar, object name, Back action and full file tree remain
available. The editor omits its descriptive information pane. Kits expose source
and mounts; Panel preview belongs to Bundles. Existing draft recovery remains
available. The conversation displays only records after this editing entry;
content-only handoffs never probe the Host message channel or read conversation
history.
The user can read or edit source, submit a customization request, inspect its
proposed diff and preview, and explicitly save through the existing working-copy
service. Source edits must be saved or restored before a new request is sent.
Switching files, opening review and cancelling Back preserve the conversation
input. Confirmed exit discards that object's unsent input and stops its history
polling; the next object starts a fresh display interval in the same native thread.
Late responses cannot change the next object's notices, candidate or input.

AI submission requires an available result from the existing bounded native
connection check, plus usable conversation history. Binding metadata or readable
logs alone do not establish message reachability. If the Host is unavailable,
its state remains unconfirmed, or history cannot be read, Studio explains the
limit and keeps manual source editing, saving, import and export available through
their existing local services. These actions still require the local Companion
service to be online and retain their revision and validation checks.

Use **重新检查宿主连接** to check again after restoring the Host. This keeps unsent
input and never submits a test message, starts a trial, or replays a previous
request. A confirmed non-submission is distinguished from unknown delivery.
When delivery is unknown, inspect the original Host conversation before any
explicit retry; a later successful connection check does not clear that warning.

Connection failures, unreadable proposals and component-example failures use the
shared Studio error card. Recovery actions remain beside the explanation;
technical details open only when requested. A failed handoff uses the same theme
even before the workspace opens. Rechecking its connection never sends a message.
Reloading a failed component example affects only that example. A component with
no standalone example instead shows a neutral empty state and keeps its reference
documentation available.

Requests include the saved object's display name and may carry create/edit intent
and the current source file. The bound service checks that file against the same
working-copy revision. These hints do not change the candidate identity, edit
permissions or save checks. Authoring reads the current source/methods and uses
`design_list_panel_components` for actual component contracts, docs and examples
when needed. The existing browser and `design_studio_customize` create operations
produce a real blank working copy before authoring begins.
A changed service, working-copy revision or selected preview Bundle cannot reuse
an old request for another target; uncertain delivery is not retried automatically.
Studio does not create a model, another conversation, or a source repository.

Candidate review uses the original request ID plus the exact working-copy
revision and preview pin. The Host prepares it with `design_studio_customize`'s
top-level `authoringRequestId`; ordinary conversation-side preparation may omit
that optional locator. The service retains only bounded, temporary correlation
metadata and the original S2 receipt, not another source or execution history.
Preparing never saves, and message acceptance is separate from Agent consumption
and persistence. Unsupported Host submission remains visible; an emitted page or
registered MCP tool alone does not establish actual native-host acceptance.

Studio's optional `previewInstalled` authoring-client method reads exact installed
Kit/Bundle pins into a bounded request-local memory snapshot and reuses the shared
declarative Panel compiler. The default sample comes from the Bundle-owned
`reference/preview.json`, falling back to `initial_values` only when that file is
absent. Explicit caller JSON takes precedence. Invalid authored samples fail
validation rather than silently falling back. A missing usable sample produces
diagnostics, not a fabricated Panel.
Caller-supplied sample JSON remains isolated preview data. Merely viewing a Panel
creates no persistent draft, invokes no model or validation driver, and does not
read or write a Design Project. Native-only Panels report unsupported. Consumers
must match Kit/Bundle pins and the request revision before rendering with the
existing sample-only `renderPreview` ports. This API is not Bundle execution or
publication, and does not grant full-file editing, mount or instance management.

Studio browses the global library independently of the project's private
sources. Installed source projections can be reused across detail reads;
current library edits live in the existing S2 store and use its revision/CAS
save path. Existing saved objects remain editable when an installation is
missing. A new project's initial Kit reads the current library closure.

- One explicitly selected existing Design Project and matching installed Kit.
- One exact Codex thread UUID; never select a conversation by “latest” or name.
- Live Design Files drive Panels independently of Git publication.
- Existing Core schema validation, attachment parsing, file/Git save and save
  notes are reused. Save retries reuse Core's Git audit event IDs.
- Runtime versioning uses Core's library-backed Git executor by default, including
  immutable review snapshots. Snapshots read only regular committed Design Files,
  exclude derived experiences and retain metadata, file-count and byte limits.
  The explicit `YUGOO_GIT_BACKEND=cli` diagnostic path is not an automatic fallback
  when a native binding or repository operation fails.
  Companion builds the unchanged Core worker from source as the fixed sibling
  `scripts/git-native-worker.js`, bundling its JS imports and retaining the
  binding's original `git-native/index.cjs` and relative `native/` lookup.
  Release payloads include the three SOURCE-pinned native Git addons for GNU Linux
  x64, Windows MSVC x64 and macOS arm64, together with build sources and original
  notices. Other targets fail explicitly. Native Git availability does not establish
  acceptance of every host on those platforms.
  New npm candidates declare this required Git runtime. `check-runtime` executes
  Core publication and immutable reads in an isolated project with no system
  Git on PATH, even with `--disable-embedding`. Both installer gates require its
  successful receipt. This diagnostic is separate from native Host/MCP or model
  acceptance, and collected dependency notices do not establish license acceptance.
- Publication uses the same raw-blob identity and HEAD transaction as DSH.
  A deferred ordinary-index update does not reject a committed Bundle; its bounded
  maintenance receipt accompanies the finish result. A post-commit Journal,
  diff or host-binding persistence failure returns `accepted: false`, `committed: true`, the original
  settlement receipt and an explicit recovery stage. Retry the exact same finish
  once without rewriting files, changing Git settings or deleting locks; report
  a repeated failure. Completed native and main finish retries return their saved
  receipt, and Journal replay does not append the same committed design fact twice.
- Local POST API checks the loopback Host, same Origin and per-start token.
- Start an ordinary Codex TUI conversation and exchange a message before opening
  its Panel. Bind the exact original thread UUID and native working directory;
  never select a thread by name or “latest”. The installed skill instructs the
  Agent to obtain identity from trusted host context or the user; a development
  CLI caller must supply it explicitly.
- Codex notifications use the native app-server proxy with initialization and
  one `thread/queue/add`. A successful receipt means `queued`, not Agent
  execution/completion. The original TUI owns consumption, approvals and turns;
  Companion never resumes a thread or calls `thread/queue/start` to deliver a
  notification. An offline TUI may leave an accepted notification unconsumed.
  The original host must expose a reachable app-server connection. Proxy,
  handshake or initialization failure reports setup as unavailable and confirms
  that no message was submitted. Check the original host connection settings;
  Companion does not start a daemon or restart the host. Once queue insertion
  has been attempted, a lost or invalid receipt remains unknown and is never
  automatically retried.
- A failed notification leaves the file save intact. The notification
  action can be used after checking the original conversation; it does not
  rewrite files. There are no automatic delivery retries.
  Save event IDs, immutable checkpoints, exact Kit pins and native project/session
  bindings persist as private delivery metadata under the Companion state root;
  Git/DesignJournal remain the design authority. Reopening the same binding reads
  these receipts without sending anything. Only proven not-submitted receipts
  expose **Recover notification only**, which rebuilds the existing save note
  from the immutable diff without saving again or running a Bundle. Uncertain
  sends and accepted native queue/Hook/task receipts are never replayed; queue
  acceptance is not Agent consumption or completion. An interrupted save with no
  settled checkpoint remains unconfirmed and requires checking the original
  conversation. Metadata failure does not undo an already published design.
  Same-binding services serialize metadata mutations using an atomic directory
  lock. A crash-left lock fails closed; stop its services before clearing only
  that binding's empty lock directory, never clear a live writer's lock.
- Browser save receipts wait for the authoritative validation, publication and
  handoff, but not KAG acquisition or review-summary reads. They opt out with
  `includeDerivedStatus:false`; independent status reads report those results.
  Publication still admits maintenance once per checkpoint. Legacy tool receipts
  retain their enriched status, and none of these presentation options skips
  save authorization or native message binding.
- Optional `--transcript /absolute/native-rollout.jsonl` mirrors native recorded
  messages into a conversation column beside the shared Panels. UUID and cwd
  must match the bound conversation and project. For Codex, synchronization starts
  at the durable boundary captured when this project's design conversation first
  activates; it does not backfill the host's earlier conversation history.
  Refreshing or reopening with the same project, native binding and state root
  preserves that boundary. An independent, read-only conversation poll uses the
  same native observer and verified foreground/review bindings, so history does
  not wait for project, Panel or knowledge reads. Workspace/tool reads retain
  their full projections. The reader keeps an incremental offset and at most 200
  rows from after that boundary.
  This is a retention ceiling, not a request to synchronize 200 historical turns.
  If native metadata is initially unavailable, the UI reports a pending boundary;
  messages before the first verifiable boundary are not guaranteed to be included.
- Public summaries and Markdown messages are shown with top-level tool entries,
  not tool parameters/results or raw reasoning. Turn status is explicitly a
  **recent recorded event**, not process liveness. API disconnect shows unknown
  while retaining the last received rows; successful polling restores the view.

Adapter tests must distinguish simulated transport from actual native conversation delivery. Verify the acquired host version, project binding, durable save and Agent consumption separately.

## Discover Bundles before execution

Call `design_list_bundles` with the current Panel's exact connection to read the
selected Kit's Bundle IDs, execution declarations and `mindsetMethod` path. Read
that Mindset method, then pass a returned ID to `design_prepare_bundle`. Kit names
and panel component names are not Bundle IDs. A declaration of subagent execution
does not establish host support: unsupported placements still fail before execution.

## Discover panel components before authoring

The new `design_list_panel_components` MCP source entry reads the shared Core
catalog without a project, connection file, model request or filesystem search.
Call it with `{}` to list the vocabulary, or with
`{ "name": "question_workspace" }` for one exact component. Each result includes
its purpose, `sourceBound`, `ownsWorkspace`, and `generated` flags. Unknown names
are rejected rather than guessed. The catalog is composition guidance, not a
complete parameter schema or a standard A2UI specification; existing schema,
panel validation and save authority still govern authoring and edits.

This increment has passed the source MCP regression, compiled-server calls, and
actual stdio calls after an ordinary tarball npm installation outside the
checkout (38 catalog entries, exact-name filtering and unknown-name rejection).
Earlier checks used diagnostic candidates; the earlier fixed local candidates
used `@yugoo-design/companion@0.1.0` and were unpublished. Their identity is a
historical record, superseded by the unified `yugoo-design` product target below;
these checks do not establish that product's native-host acceptance.
Check the installed server's `tools/list` before relying on it; an older
package does not gain this tool merely because the checkout has changed.

Packages built with the authoring-reference resource also support on-demand
queries through the same tool. An exact component name is required:

```json
{"name":"record_form","reference":"contract"}
{"name":"navigation_workspace","reference":"contract","type":"ComponentNode.navigation_map.edges"}
{"name":"record_form","reference":"docs"}
{"name":"record_form","reference":"examples"}
```

Pass a returned `read` object as the arguments of the same tool to follow a
contract or documentation reference. `type` is valid only for `contract` and
must name a declared local type or nested property. These queries read the
matching package's `authoring/panel-components.json`; they need no checkout,
TypeScript loader, project connection or model request. Missing or incompatible
material is rejected without a source-checkout fallback; the plain catalog
query remains available.

Documentation reports whether it has a dedicated component section or only a
shared reference. Examples report existing structurally validated usages, or
`no-existing-usage`; neither is proof of Kit binding, rendering or saving.
New authoring materials also return `documentation.sharedStandards` with the
same package's [Panel UIUX standard](../../docs/panel-uiux-standard.md) as bounded
plain text. Read it once before composing a view; it guides expression, typography,
controls and feedback without adding component names or edit rights. Older
packages may lack it; a checkout update does not update an installed package.
Shared declarations are not complete per-component parameter schemas. Host
`RenderOptions` callbacks describe trusted runtime integration, not DSL event
handlers or permission to execute scripts. Source file/line references are
provenance, not promises that those source files exist in an installed package.

The reference queries have also passed actual default-reader stdio calls from
an ordinary npm-installed diagnostic tarball outside the checkout: contract and
documentation follow-ups, a nested navigation declaration, existing examples,
unknown-name rejection, and missing-material rejection followed by restoration.
This does not establish complete parameter schemas, new-component authoring,
all Panel interactions, or final release acceptance.

## npm candidate and native installation boundary

### Maintained npm package guide

The product package README derives this section from the formal Companion README.
Replace `<package-selector>` with the exact package identity printed by the
release or installed package. The assembler records the source and section hashes;
this guide does not grant publication approval or complete host acceptance.
The guide below describes the maintained installation routes; the acquired
version's bundled help determines its actual commands. The dated npm checkpoints
and current installation boundaries are described in [release status](../../docs/wiki/preview-status.md).
Published beta.1 retains the saved-plan Codex/DSH routes and standalone
`prepare-desktop`; follow that acquired version's README and help.

<!-- npm-package-guide:start -->
Yugoo Design (语构设计系统) is an interactive design plugin for native Agent Hosts.
It combines domain methods, Design Projects, versioned Design Files and shared
Panels. The Companion provides those Panels for hosts outside the native DSH UI;
it uses the host's own models and conversation.

Native installation, tools, Panel saving, KAG and GRA must be verified for the
actual host version and platform. A successful package
installation or runtime-load check does not establish all of those capabilities.

Use Node.js `>=22.19.0` and a durable npm or pnpm installation directory.
Older package versions retain their own `engines.node` requirements. The current
payload uses the packaged native Git library for normal Design versioning without
system Git. Its supported targets are Windows x64 MSVC, Linux x64 GNU and macOS
arm64; host acceptance remains version-specific. System Git is separate and
needed only for the explicit CLI diagnostic backend and development fixtures.
Missing native support is reported rather than silently spawning system Git.
Resolve the required product release to its exact version and integrity before acquisition;
keep the previous installed version available during updates. Stop if that exact
release is missing; do not substitute another package, channel or arbitrary version.
If a retained installation already matches that exact release and provides the
required host adapter and runtime, reuse it after checking its help and runtime
receipt. A stale catalog or old host session is not a reason to download the
same runtime again. A different required release gets a new retained directory;
do not overwrite an installed runtime or copy only part of its dependency tree.

Node is a shared prerequisite, separate from the retained product package.
Reuse an existing user/system Node installation or a Node version manager;
installing another host adapter does not download another Node. New installer
plans select `--node-executable` or `YUGOO_NODE_EXECUTABLE` first, then inspect
PATH and standard Node installation locations. They verify the real executable,
version, platform, architecture and SHA-256, and bind the same absolute path to
the owned MCP/Hook configuration. An invalid explicit choice fails rather than
silently switching to another Node. Preview directories, plugin caches,
application resources and temporary runtimes cannot become shared prerequisites.

If the acquired release lists `resolve-node` in its help, inspect the selection
without registering a host or changing configuration:

```sh
npx --no-install yugoo-design resolve-node
```

If no compatible Node exists, prepare it once through the system's Node installer
or a version manager and rerun the installer. This route does not download Node,
change global PATH, or own/delete an external Node during plugin removal. It does
not implement a product-managed Node download or garbage collector. DSH Desktop
continues to use its official pinned Electron/Loader entry; do not replace that
host-internal executable with the Companion's standalone Node selection.
Windows desktop preparation validates an existing Node on Windows. Preparation
from another operating system requires an explicit Windows path and reports that
locator as unverified; it does not establish target runtime acceptance.

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact <package-selector> --registry=https://registry.npmjs.org
npx --no-install yugoo-design --help
```

Alternatively, use an existing pnpm 11 installation (npm remains supported).
In the dedicated, empty version directory, create `pnpm-workspace.yaml` with
these local settings before acquisition:

```yaml
nodeLinker: hoisted
allowBuilds:
  onnxruntime-node: true
  protobufjs: true
  sharp: true
```

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm add --save-exact <package-selector> --registry=https://registry.npmjs.org
pnpm exec yugoo-design --help
```

Run either acquisition in its own retained version directory, not the Design
Project or host profile. Do not mix npm and pnpm lockfiles in that directory.
The hoisted layout is the compatibility route for Companion's current native
dependency inspection; other pnpm layouts are not certified for every host.
pnpm's explicit build permissions above allow the current native dependencies'
installation scripts; do not disable all scripts or enable all future dependency
builds. Review any newly reported build requirement before allowing it. Retain
the complete pnpm installation layout; do not copy just a linked
package directory or invoke Node with `--preserve-symlinks` flags.

An explicitly selected HTTPS npm mirror is supported, for example
`--registry=https://registry.npmmirror.com`. Use it both when acquiring this
package and when invoking `yugoo-design install --host dsh --registry=<url>`
with the required host inputs. The latter controls the official DSH CLI's
package download registry; it does not replace that CLI with npm or pnpm.
The exact aggregate version still comes from `release-hosts.json`, whose registry
remains the canonical release origin/default. The plan and receipt separately
record the effective mirror and bind it through apply and owned updates. There
is no automatic registry fallback or global registry edit. Verify the exact
mirror version and integrity against the selected release before installation;
missing or stale mirror packages are not permission to change version or source.
Registry selection does not redirect separate embedding-model or upstream
installation-script downloads to that mirror.

First-release local embedding runs on CPU. Set the supported
`ONNXRUNTIME_NODE_INSTALL_CUDA=skip` environment before acquisition to skip ONNX
Runtime's extra CUDA download while retaining normal dependency lifecycle
scripts. Preserve the upstream packages and other environment values. The
installed package cannot configure its acquiring parent npm/npx process; a bare
npm/npx acquisition does not apply this policy automatically. Keep the same
policy on later host-installation children that acquire dependencies. The
maintained DSH adapter passes it to the official CLI in Web and Desktop; older
installed adapters may need the caller to supply it. This does not establish
installation success or remove the separate
[embedding-model preparation step](#local-embedding-model-preparation).
The default product does not provision GPU runtimes; optional GPU support and
configurable or user-local model selection are future work.

In Windows PowerShell, scope the setting to acquisition and restore its previous
process value:

```powershell
$previousOrtCuda = [Environment]::GetEnvironmentVariable('ONNXRUNTIME_NODE_INSTALL_CUDA', 'Process')
try {
  $env:ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'
  npm install --ignore-scripts=false --save-exact <package-selector> --registry=https://registry.npmjs.org
} finally {
  [Environment]::SetEnvironmentVariable('ONNXRUNTIME_NODE_INSTALL_CUDA', $previousOrtCuda, 'Process')
}
```

### Local embedding model preparation

The current provider pins `Xenova/multilingual-e5-small` at revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`, with quantized `q8` weights and CPU
inference. Its default cache is `.cache/design-system/embeddings` under the home
directory of the **user running the runtime**, not the npm installation or Design
Project. Windows Node uses that Windows user's home; WSL uses its Linux user.
An offline installation needs the complete model cache in the library's expected
layout. A tokenizer or one weight file alone does not establish a usable cache.
Use the acquired version's model identity; changing the model/revision or copying
an arbitrary cache is not a supported repair.

When the acquired `yugoo-design --help` lists `prepare-embedding`, run it from
that installation directory under the actual runtime user and OS:

```sh
npx --no-install yugoo-design prepare-embedding
# Only when downloading the fixed model has been allowed:
npx --no-install yugoo-design prepare-embedding --allow-download --probe
```

The default command is an offline size/hash inspection: it creates no cache,
lock or network request. `--allow-download` prepares the four pinned files
(about 135 MB total), reusing verified files and resumable downloads. `--probe`
performs real local CPU inference with fixed synthetic text; use it without
`--allow-download` to test an existing cache. An explicitly selected cache can
be passed as `--embedding-cache /absolute/cache`; use that same cache for the
runtime. No Design Project or host registration is needed for preparation.

`assets-ready` means the files passed integrity checks and CPU inference has not
been tested; `ready` means the CPU probe also passed. `unavailable` reports the
resource or inference failure and exits unsuccessfully. None of these results
proves semantic KAG is current for a real project. Respect an explicitly disabled
embedding configuration. Preparation does not change DSH's provider or model
settings; it is relevant only when DSH uses this same default local model/cache.

Published `0.1.0` does not include this command. Follow that package's existing
runtime route below, or update to a published version whose help includes it;
do not pass the new command to an older installation.

For the shared runtime's `scripts/design.mjs serve` entry used by Codex, Claude
Code, Qoder and QwenWork, the default is **local-only** model loading. Its runtime
help documents `--allow-embedding-download`: when explicitly allowed, this permits
fetching the pinned model files if absent. Apply it only to that exact owned Panel
startup with its existing host/session/project arguments. It is a runtime `serve`
option, **not** a `yugoo-design install` or `check-runtime` option. Conversely,
`--disable-embedding` on that runtime entry keeps structure/evidence without
semantic embeddings. Neither option changes host model credentials. Model-file
download and CPU inference do not upload Design text.

WorkBuddy's `yugoo_workbuddy_open_panel` service currently fixes `localOnly: true`
and exposes no model-download parameter. It requires a complete cache
for its Windows runtime user. A package with `prepare-embedding` can prepare that
cache before the service starts; the older runtime `serve` flag does not add a
WorkBuddy download route. If preparation is unavailable or fails, report the
semantic-index diagnostic. Do not change host identity or start another host's
service to bypass it. Authorized design work can continue from Design Files
and structural evidence; do not report semantic KAG as ready. DSH follows its own
provider configuration rather than these Companion `serve` flags.

`yugoo-design check-runtime` verifies the declared runtime dependencies and its
isolated native-load/Git checks. It does **not** fetch or validate the complete
embedding model, run semantic inference or prove that KAG is current. After cache
preparation, verify the real project's semantic status separately. Preserve the
reported model/runtime failure and existing Design Files rather than clearing the
database or reinstalling the host to make the status appear successful.

While embedding is unavailable, use `design_knowledge_context` and preserve its
project, checkpoint, graph revision and `coverage.basis` (as query `basis`) for
`design_query_knowledge`. This keeps the view stable when a later publication
becomes available. If source
projection has completed and still matches the pinned sources, context remains
available with `coverage.basis: source-projection`: records, explicit references
and literal-text queries work without semantic inference. Its coverage excludes
embedding candidates and other non-file interpretations. The returned `status`
still shows the semantic maintenance failure and any older latest-complete
publication; basic context availability does not mean semantic KAG is current.
These reads do not retry maintenance. An unprojected, incomplete or stale source
view remains unavailable; use bounded reads of the Design Files in that case.
Legacy queries without a basis retain their historical-snapshot behavior when a
publication exists; their returned coverage does not assert semantic completeness
or compatibility with the current projection policy.

### Install in the current native host

Ask the Agent in your current host to install or update Yugoo Design as one
product. It should identify the host from its actual execution context or your
explicit choice, not from which CLIs happen to be installed. If identity is
unclear, ask only for the missing host choice. Follow this acquired version's
CLI parameters and host requirements; a newer source guide does not add commands
to an already published package. Users do not install DSH and Companion separately:

| Host | Native installation route |
| --- | --- |
| Codex | `install --host codex`: run the existing plan, runtime check and apply transaction, retaining each receipt. |
| Codex Desktop | `install --host codex-desktop`: prepare a small npm-backed local source and owned personal catalog; install or update it through the native plugin UI. |
| Claude Code | `install --host claude-code`: native user-scope registration. |
| Qoder CLI | `install --host qoder`: native user-scope registration and independent readback. |
| QwenWork | `install --host qwenwork`: prepare the expert suite and its MCP configuration; import and enable through the host. |
| WorkBuddy | `install --host workbuddy`: prepare the stable marketplace and plugin; import or update and enable through the host. |
| DSH | `install --host dsh`: run the existing plan/apply transaction with the bound aggregate, official CLI/Loader and an explicitly selected existing profile. |

For a fresh WorkBuddy preparation, the native suite example is `0.3.30`
(`--suite-version 0.3.30`), with the verified Node executable and a persistent
external preparation destination. Import the returned `nativeImport.market` directory and
enable its `yugoo-design` plugin. The fresh market is also named `yugoo-design`;
no previous test market or preparation receipt is required. An owned update with
`--previous-receipt` retains its original market name and directory, including
historical test markets, rather than migrating a registered installation.

The QwenWork native suite example is `0.1.5` (`--suite-version 0.1.5`). These
numeric versions were used with the recorded local Companion beta.18 candidate;
they are separate from the published Companion npm version. Use the selected
package's guide and an explicitly chosen suite version. An owned update must
advance beyond its previous receipt's suite version, even when an example here
uses the old value. Desktop preparation writes that explicit version into the
import; it does not prove the host loaded it.

Supply the required host inputs shown by `yugoo-design --help`. Without a host,
the entry returns `host-selection-required`; missing inputs return
`inputs-required`, both with exit code 2 and no installation attempted. The
Agent should obtain supported native facts itself and ask only for missing
choices. Explicit saved-plan and `prepare-desktop` routes remain available.

For Codex Desktop, choose a new `--destination` inside the intended user's home
with an existing parent, an external `--receipt-dir`, and optionally an existing
public `--node-executable`. Keep the exact npm installation at its acquired path:
the small prepared source points to its shared runtime. An owned update uses a
new npm directory and source destination with the old `--previous-receipt`,
retaining the old inputs. `--dry-run` saves a source-bound plan; apply that exact
`--plan` from the same package without choosing a new Node or destination.
The returned catalog preparation still reports the plugin as not installed or
loaded. Complete the native UI action, and return to the current conversation
after a normal user-controlled restart if the host requires one.

The Agent completes executable steps and reports only the required human
authorization, import, enable, restart or new-session action. Report acquisition,
registration/import, activation and verified use separately; do not report an
untested phase as complete. DSH uses its native integration, not a second
Companion runtime inside the host.

Desktop preparation alone does not register or activate a plugin. Native suite
versions are separate from npm versions. Preserve unrelated registrations,
models, credentials and Design Projects; do not overwrite an owned previous
installation path or automatically repeat an uncertain operation.
Same-version retries and updates must follow the owning adapter's receipt rules;
this entry does not introduce a universal replacement or rollback mechanism.

Start the host normally, then invoke Yugoo Design in the intended conversation.
Confirm the actual loaded skill and tools, open a project, edit and save a Panel,
and check that the original host conversation receives the saved result. Report
unsupported Workers, GRA or other host capabilities explicitly. Follow the owning
host's supported diagnostics, update, recovery and uninstall routes and retain
their receipts; availability differs by host.
<!-- npm-package-guide:end -->

The marked npm guide above remains the assembler's maintained source, with
`<package-selector>` replaced by the exact candidate identity and version. The
unified product's release preparation and publication are separate operations.
Assembly defaults to candidate copy. The current `--distribution stable` mode
uses the maintained guide for the exact non-fixture product name and stable
version, and sets public access with the `latest` tag. It neither publishes nor
marks runtime, registry or release validation complete. Historical beta assembly
records retain their original options; beta is no longer the current release mode.

Directory development packages and npm releases use different installation
routes. Use the acquired release's README and help for native installation;
the [release and compatibility guide](../../docs/wiki/preview-status.md#current-release-and-use)
explains version selection and host activation boundaries.

yugoo-design uses one product CLI entry, with `--host` selecting its existing
host adapter. Companion is the shared runtime within that distribution; users
do not install a second Companion product after installing yugoo-design.
For DSH, the installer reads the product's `release-hosts.json`
and installs the mapped aggregate and internal modules automatically into an
existing DSH host; users do not separately acquire each internal module.
DSH remains an external host. DSH installation still requires an existing
`--profile`, official `--dsh-config` pins and an external `--receipt-dir`.
Use `--dry-run`, inspect the saved plan, then `--apply --plan <saved-file>`.
An optional aggregate override must equal the bound product mapping. An explicit
credential-free HTTPS `--registry` selects a download mirror without changing
that exact aggregate or the canonical release origin. Pass the same choice to
dry-run and apply; existing receipt-owned updates must retain both their origin
and effective registry. Registry migration is not implicit.
The maintained DSH mapping keeps the internal
`@yugoo-design/dsh-design-system-dsh` identity and `https://registry.npmjs.org`
origin. The unified release preparation derives its exact aggregate version from
the product version; always inspect the acquired package's own
`release-hosts.json`. Earlier packaged mappings selected aggregate
`0.1.0-beta.2` with eleven owned DSH packages, including
`@yugoo-design/yugoo-design-git-native`, at that same beta version. Those frozen
maps remain historical evidence rather than the unified product's release set.
Native suite and Kit/Bundle content versions are separate.
These target values do not establish
registry availability or an accepted public installation. Older
or unbound candidates retain the explicit aggregate/registry compatibility
route, while malformed mappings fail before invoking the host CLI.

`scripts/companion-npm-candidate.mjs` accepts an explicit `fixture` boolean.
A non-fixture candidate requires an explicit npm `packageName`, a canonical exact
`version`, and the official exact `@ladybugdb/wasm-core@0.21.1` dependency.
Fixture scopes cannot identify that
candidate; scoped names must match the explicit scope. Stable mode requires the
product name/version and matching DSH mapping. Assembly leaves `publishReady` and
`releaseValidated` false; it does not install a host or establish runtime, model
or platform acceptance.

Maintainers preparing a new npm release should use the
[current preparation and publishing guide](../../CONTRIBUTING.md).
Use the current release tooling and declared product version; historical beta build commands are not the default acquisition route.

### Registry acquisition by the host Agent

Use the [shared prompt in the current host](HOSTS.md#default-prompt-any-supported-host).
The Agent first checks the required exact `yugoo-design` version,
records the exact release and integrity, then acquires it in a durable,
version-specific directory. The GitHub guide describes the procedure; the
runtime is acquired from npm. With no version specified, resolve `latest` once
to an exact published stable version and keep its integrity for the remaining
steps. If the tag points to a prerelease, report the mismatch and stop rather
than choosing another version. An explicit version request takes precedence;
do not substitute a historical example version.

```sh
yugoo_version=$(npm view yugoo-design@latest version --registry=https://registry.npmjs.org) || exit
node -e 'if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(process.argv[1])) { console.error("Expected an exact published stable npm version"); process.exit(1) }' "$yugoo_version" || exit
npm view "yugoo-design@$yugoo_version" version dist.integrity engines.node --json --registry=https://registry.npmjs.org || exit
```

Record that metadata. Reuse a matching retained installation when its runtime
and host receipt satisfy the request. Otherwise select a new durable directory
for this exact version, outside the user's project, and run the following from
that directory in the same shell. A missing release stops installation;
metadata alone does not prove archive acquisition or native activation.

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --ignore-scripts=false --save-exact "yugoo-design@$yugoo_version" --registry=https://registry.npmjs.org || exit
npx --no-install yugoo-design --help
```

This current acquisition example applies the CPU policy from the
[package guide](#npm-candidate-and-native-installation-boundary) without changing
the published package. Use that guide's PowerShell form on Windows. Keep the
same policy on host-installation children; new source behavior is not evidence
that an older installed adapter supplies it automatically.

Continue through the host's real registration adapter below. On update, acquire
the new exact version in a new durable directory, retaining the old package and
owned receipts; follow that adapter's supported update or uninstall/re-registration
route. Normal host startup, the actually loaded version and the design cycle need
their own verification. A received exact tarball can replace registry acquisition
for pre-publication checks only. Neither this example nor the prompt publishes
a package or establishes installation acceptance for every host.

### Claude Code and Qoder CLI: persistent native registration

First acquire the exact release as above, then register the plugin once using
the package's `yugoo-design` executable.
These examples run from that npm installation directory; replace each absolute
path with your actual native executable and a separate receipt directory:

```sh
npx --no-install yugoo-design install --host claude-code --claude-executable /absolute/claude --receipt-dir /external/receipts
npx --no-install yugoo-design install --host qoder --qoder-executable /absolute/qodercli --receipt-dir /external/receipts
```

Run registration from the intended native user's environment. Qoder optionally
accepts `--qoder-config-dir /absolute/profile` for an explicitly selected profile;
otherwise the native CLI resolves its normal configuration directory, including
`QODER_CONFIG_DIR`. Do not substitute a test profile when claiming installation
for your actual account.

Successful registration persists in the selected user's native plugin registry.
After it succeeds, start Claude Code or Qoder CLI normally in your intended
project workspace and use `/yugoo-design:yugoo`; you do not need to repeat
`--plugin-dir` on every start. Restart an already running host to pick up its
new registration. Keep the exact npm installation directory available: the
installed plugin's shared runtime entry points back to it. Moving or removing
that directory breaks the registered entry.

For Qoder, an unchanged owned same-version registration is a no-op. A different
version or modified registration is refused rather than silently replaced;
follow the reported native uninstall/re-registration guidance explicitly.
Foreign same-name registrations are not taken over. Inspect any failed receipt
before deciding how to proceed; a failed operation is not successful
registration and does not authorize deleting unrelated host state.

Registration and separate native-list readback do not establish MCP startup,
runtime dependency loading, model execution, panel saving/reopening or GRA/KAG
success. Use `yugoo-design check-runtime --host HOST --receipt-dir /external/diagnostics`
for dependency diagnostics, then check the tools/skill in a new ordinary native
conversation and verify the intended design cycle separately. This is not
all-version or all-platform certification.

### Desktop npm package preparation

Desktop preparation creates QwenWork expert suites and a stable WorkBuddy
market from an already acquired exact npm version. Use `prepare-desktop`, or
`install --host qwenwork` and `install --host workbuddy`, which delegate to the
same preparer. Historical beta.1 archives expose their original standalone
preparation command and help.
Neither route contacts npm, registers a host, edits a native profile, launches a
model or verifies that the imported Skill is loaded. Native import and activation
are still required, and the user's host starts normally.

First acquire the reviewed exact release in a durable dedicated npm directory
using the package's declared Node engine and the
[existing npm acquisition route](#registry-acquisition-by-the-host-agent).
Set the supported CPU environment before acquisition and keep dependency
lifecycle scripts enabled. A received verified tarball is the preflight
alternative. Do not select an unreviewed `latest`. From that installed package:

```sh
npx --no-install yugoo-design prepare-desktop --help
npx --no-install yugoo-design prepare-desktop --target workbuddy --package-name yugoo-design --package-version EXACT_NPM_VERSION --suite-version EXACT_NATIVE_RELEASE_VERSION --node-executable ABSOLUTE_WINDOWS_NODE --destination EXTERNAL_PREPARATION_DIRECTORY
```

QwenWork uses `--target qwenwork` plus `--qwenwork-runtime ABSOLUTE_JSON`.
That JSON contains only `executable`, `worker`, `nodeExecutable`,
`executableSha256` and `workerSha256`, from the intended native installation.
By default the expert ZIP already contains its MCP configuration; the emitted
`design-system-mcp.json` describes the same connector. Enable only one
`design-system` connector. Import the separate JSON only when that entry is
permitted and the suite's connector cannot be enabled. `--separate-mcp` prepares
a suite without its connector for an organization requiring that arrangement;
it does not alter the organization's policy or acquire another runtime.

On native Windows, npm and destination paths must match their actual roots.
Cross-platform preparation additionally requires `--npm-root-windows` and
`--destination-windows` as explicit target mappings; those target paths and
native byte pins remain unverified until tested there. No drive mapping is
guessed. Preparation rejects native-profile destinations and package/resource
drift, and leaves the acquired npm package unchanged.

QwenWork keeps machine-specific pins outside the npm runtime. Its generated
connector loads a preparation-owned bootstrap file URL through Node `--import`; the
prepared Skill explains the same prefix for shared CLI commands. Native Hooks
retain their own configuration and protocol. The external configuration locator
does not grant admission: exact native process, executable/worker bytes and
conversation checks remain mandatory, with the prior default retained when
no external configuration is specified.

For an owned update, acquire a new exact npm version in a new stable directory,
use a greater native suite release version and pass
`--previous-receipt ABSOLUTE_SUCCESSFUL_PREPARATION_RECEIPT` with the same
destination. The previous package, runtime and prepared artifacts must still
match their receipt. WorkBuddy retains one market path, atomically updates its
manifest and preserves the old suite/runtime; QwenWork emits a new versioned
ZIP/configuration. Never overwrite the previous npm directory or silently
reuse a stale receipt. An interrupted preparation may leave bounded partial
outputs: retain them for inspection rather than importing or blindly retrying.

Use the host's supported importer/Refresh/Update route for the prepared output.
For WorkBuddy, refresh the market catalog, confirm its listed version, then
update the suite. For QwenWork, import/enable the new versioned suite and retain
only one permitted connector to the prepared runtime. Restart the host normally
or open the new session it requires, then verify the actually loaded `yugoo`
version, tools, original conversation and saved-edit consumption. Updating the
npm runtime, preparing materials, refreshing/importing them and reloading the
host are distinct steps; an old session can still hold an earlier runtime.
Current registration may require the native GUI; preparation is not evidence of an Agent-callable registration API.
The existing preview suite version and npm version are distinct exact pins.
The old fixed candidate does not gain this command without a new separately
identified build and installation.

The old session-only route remains an optional diagnostic command:
`yugoo-design plugin-directory --host claude-code` or `--host qoder`.
It returns `launch.executable` and `launch.args` for native `--plugin-dir`
loading without persistent registration. `plugin-directory-ready` means only
that required files are present, not that the host or runtime has run. This
diagnostic route is not a substitute for the persistent installation above.

### Persistent registration transactions

#### Codex Desktop: prepare from the acquired npm package

Run the package's own command from a durable installation of an exact version:

```sh
npx --no-install yugoo-design install --host codex-desktop --destination /absolute/user-home/plugins/yugoo-design/EXACT_VERSION --receipt-dir /absolute/external/receipts --node-executable /absolute/existing/public/node
```

Choose an existing parent for the new source directory. The destination must be
inside the intended user's home, outside the acquired npm package, and unused.
The command reuses the existing public Node, checks the acquired runtime, and
prepares a small immutable plugin source plus the personal marketplace entry.
Its launchers retain exact references to that npm installation; runtime files,
dependencies and Node are not copied. Keep both the npm directory and prepared
source at their recorded paths. `--user-root` selects an explicit profile root
for preparation, including an isolated test profile.

Preparation returns `hostRegistered: false`, `installed: false` and
`loaded: false`. Install or update that exact local source through Codex Desktop's
native plugin UI. If the host needs a normal restart, keep and return to the
current conversation, then verify the loaded version and original-conversation
save receipt. Preparing the catalog does not establish native activation.

For an owned update, acquire the next exact npm version in a new stable directory,
choose a new source directory, and pass the previous successful
`--previous-receipt /absolute/receipt.desktop-marketplace.json`. The same selector
is updated while the old source, npm version and receipt remain intact. Modified
sources, runtime inputs or a conflicting Yugoo catalog entry are retained and rejected.

`--dry-run` prepares the source and saves a plan without updating the catalog.
Apply it using `install --host codex-desktop --apply --plan /absolute/saved-plan
--receipt-dir /absolute/external/receipts` from the same acquired npm package.
Do not add a new destination, Node selection or previous receipt during apply;
the saved plan already binds them. An existing exact `--runtime-receipt` may be
supplied during preparation instead of repeating its runtime check.

#### Codex CLI registration transactions

The Codex persistent npm installer currently admits only the reviewed local-plugin JSON protocol
for Linux x64 `codex-cli 0.160.0` and `codex-cli 0.162.0`. The executable may reside
at a different installation path, but its actual path and bytes are pinned and its SHA is
checked before and after commands. Unknown versions, architectures or plugin
list formats are rejected. Production registration requires the actual user
profile, a non-fixture package and the matching installed-runtime receipt;
protocol admission alone is not release-payload acceptance.

The 0.162.0 qualification used the actual binary in isolated mount, process and
network namespaces with synthetic local plugins. It verified JSON registration,
cache/configuration ownership, repeat installation, upgrade, failure compensation,
fresh-process recovery and rejection of foreign edits. It did not read real
credentials, invoke a model or establish native Agent consumption of the product.

Use the saved plan JSON file unchanged for apply. The CLI's returned display
object includes `planFile` and is not the saved plan body; passing that object
or editing a plan without a matching digest is rejected before installation
effects. Recovery and uninstall require the matching owned transaction receipt
and preserve unrelated registrations, project data and shared npm files.
Claude Code's explicit user-scope plan/apply/recovery/uninstall routes remain
available; the normal persistent entry above delegates to that native adapter.
Qoder uses its native local-directory install and independent registry readback,
not the Codex transaction protocol. Synthetic or isolated registration checks
do not establish a complete user design cycle or arbitrary upgrades. The separate DSH
aggregate route and its partial-state limits are documented in the
[DSH installation guide](../dsh/README.md#installation-target-and-current-package-composition).

DSH package installation waits for the official CLI to finish; it has no default
120-second probe deadline. Programmatic callers may supply a cancellation signal
or an explicit deadline. The npm entry forwards cancellation through the Desktop
bridge rather than killing that bridge before it can retain an installation
receipt. A cancellation request or a parent CLI exit does not prove that Windows
pnpm descendants have stopped: interrupted receipts mark that state unverified
and never authorize an automatic retry or takeover of a partial aggregate.
Command output is bounded to 1 MiB per stream and retained in private files beside
the external receipt, with paths and hashes rather than raw output in the JSON.
On Windows, an existing receipt directory must pass the shared owner, protected
DACL and safe-ancestor checks; its permissions are never silently repaired.
New receipt directories receive the shared private-storage protection. An unsafe
existing directory is refused before native installation or raw output writes;
choose a new owned receipt directory instead of modifying old evidence.
Receipts distinguish timeout, cancellation, output limit, launch and native exit
failures. `userConfigurationStatus: unverified` means readback failed, not that
user configuration was proven changed. Workspace and foreign-ownership checks
remain strict; native exit zero alone cannot establish registration success.
Configuration readback accepts each profile Bundle's current official single-file
or ordered multi-file patch declaration through the pinned Loader's
`bundlePatchPaths`. Each file retains package containment, realpath and regular-file
checks; composition still rejects skipped-patch warnings. This parses configuration
without activating plugins or changing the profile.

These are current source capabilities, not a claim that the final npm payload
has been installed or that every host, platform or recovery scenario passed.

## Build and verify (repository checkout)

### Hot development UI (HMR)

Install the workspace dependencies with the checked-in pnpm version/lockfile,
then use `pnpm dev:companion -- --help`. Supply explicit existing project, isolated
state, installed Kit, host and exact native session identity. The development
command starts the same Companion backend with Vite middleware on its loopback
port (default 41593); no second API proxy, model client or user-profile changes.
Use the private startup connection's token once in the URL fragment as usual.
Studio remains at `/?view=studio`; trial children inherit the development factory.
React components use Fast Refresh and plain CSS updates without a page reload.
Non-component exports can invalidate a boundary and reload the page, so protect
unsaved work; backend, Kit/schema and build-configuration changes require restart.
The source/optimizer cache is reused, not a repeatedly copied release tree.

```sh
pnpm dev:companion -- --project /absolute/design-project \
  --state /absolute/isolated-state --kit /absolute/installed-kit \
  --host claude-code --thread <exact-existing-session-id> --port 41593
```

For a development worktree intentionally reusing another worktree's unchanged
dependencies, use `pnpm --config.verify-deps-before-run=false dev:companion -- ...`
after checking the required dependencies explicitly; do not let an automatic
install replace the shared dependency directory. Initial optimizer startup can
take longer than subsequent launches; wait for the UI before editing.

The isolated live-Hook UI runner also accepts `--serve-ui --hmr --port=41593`
and its existing `--reuse-root=<retained isolated root>` option. That runner starts
an explicitly isolated native Claude session; the general development command
only binds the supplied existing native session. These are not interchangeable
claims about installed-host coverage.

Development is opt-in. The ordinary HTML/assets, authentication and release
build are unchanged; development files and Vite dependencies do not enter the
plugin payload. Stop only the development process you started. Run the normal
build and relevant checks before delivery; HMR is not packaging verification.
Implementation follows [Vite backend integration](https://vite.dev/guide/backend-integration)
and its [server options](https://vite.dev/config/server-options).

Focused checks cover real React/CSS transforms and synthetic child transport,
not native trial completion:

```sh
node --import tsx --test packages/companion-dev/test/frontend.test.mjs \
  packages/companion/test/dev-frontend.test.mjs
```

### Normal build

The standalone Studio can expose a same-build Component Library alongside Kits
and Bundles. It reads Core's real catalog and uses the shared DSL renderer for
trusted isolated examples; it does not run a model, save a project or load
third-party executable components. Full example declarations and a source-only
extension prompt can be copied. The prompt embeds the canonical
`plugin/design-system/skills/design-component/SKILL.md`, also carried by the
existing Codex, Claude Code and Qoder package slots. WorkBuddy's separate package
and installed-host Skill activation require their own acceptance.
Focused checks (no installation or host credentials):
`node --import tsx --test test/component-skill-package.test.mjs test/component-skill-resource.test.mjs`.

Use the repository's existing installed dependencies. Build Core before the
browser, and finish building before starting tests/the companion.

```sh
pnpm --filter dsh-design-core build
cd packages/companion
../../node_modules/.bin/tsdown --config tsdown.config.ts
../../node_modules/.bin/tsc --project tsconfig.typecheck.json
node --test test/companion.test.mjs
node test/browser-smoke.mjs
node --test test/codex-transcript.test.mjs test/style-loader.test.mjs
node test/browser-conversation.mjs
```

## Build a relocatable Codex development package

### Build from an independent public-source checkout

Use Node.js `>=22.19.0`, Git, and the pnpm version declared by the source root's
`packageManager` (currently `pnpm@11.7.0`). Run these commands from that root:

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm run build
node packages/companion/build-plugin.mjs /absolute/existing-parent/yugoo-design
```

Install dependencies in this checkout normally; do not copy a development
checkout's lockfile or `node_modules`, or link to its workspace. The public
source uses the exact public npm dependency `@ladybugdb/wasm-core@0.21.1`
and includes the existing offline DSH pure JSON snapshot and license inputs
used by the build. It does not require historical Ladybug vendor inputs.
The root build builds the declared workspace packages;
it does not itself build Companion. The existing `build-plugin.mjs` command
then builds Companion's browser and server entries and packages its Knowledge
runtime, authoring reference, Web App Kit, and host overlay. Companion does not
need a new workspace `package.json` for this entry.

The output parent must already exist. Use a new `yugoo-design` directory; the
legacy name `design-system` is also accepted. The command refuses to overwrite
an existing target. Omitting the output argument
creates a new directory under `packages/companion/dist-plugin` and prints its
exact path. `--qoder` or `--claude` before the output argument selects the
corresponding overlay; the default is Codex.

Before packaging, build or obtain all three native addons matching
`packages/git-native/SOURCE.json`; generated binaries are not public source.
By default they are read from that package's `native/` directory. Pass
`--native-git-artifacts /absolute/pinned-package-root` before the output argument
to use an existing artifact set without copying a Rust build cache. The ordinary
npm candidate builder accepts the same flag. Both paths verify the current
loader, source inputs, notices and exact prebuild hashes, and refuse missing or
changed materials. They never download a substitute Git executable or fall back
to one when a binding cannot load.

Normal browser builds give the reviewed Pica 7.1.1 and image-blob-reduce 3.0.1
module `//#region` comments stable `node_modules/` labels when reusing a dependency
directory outside the checkout. Only parsed line comments matching these exact
bundled module identities change;
executable strings, original notices, physical module evidence and exact loader
checks remain intact. This avoids path-only chunk hash drift without admitting
changed worker code or borrowing older compiled output.

Normal static Pica inspection uses the captured web output-module map to locate
the two source roles, rather than historical chunk names. It checks the actual
parent bindings and Worker strings against the pinned source, existing compiler
bytes and AST contract, including the static manifest. The bounded expected
parent normalization runs in memory with `write: false`; it does not rebuild
the product or change the retained candidate. Historical Blob fixtures and
probes keep their own exact byte pins and cannot certify this static branch.
Both static Worker tasks remain pending actual runtime evidence; compilation
does not establish browser execution, installed-host support or release acceptance.

This produces a directory-style development plugin, not a portable npm release
payload. Its packaged local inference dependencies are specific to the build
machine's platform and architecture; model weights are not included. Building
does not register or install a host plugin, start a host, or run a model.

The directory includes its own root `LICENSE` and `NOTICE`, plus
`licenses/DSH-LICENSE`. Existing font and icon materials are under
`licenses/third-party/whiteboard-fonts/`, `licenses/third-party/bpmn-font-0.12.1/`
and `licenses/third-party/lucide-react/`; ELK materials are under
`licenses/third-party/elkjs-0.10.2/`. Existing bundled JavaScript materials are
under `licenses/bundled-js/`. These materials retain their original licenses
and do not establish complete dependency inventory or release acceptance.

These are existing source-entry instructions, not a claim that an independent
clean build or final release acceptance has passed. In particular, an earlier
exploratory build using development dependencies is not that evidence.

### Install or update in Codex

Build from this checkout, then pass the **exact directory printed by the build**:

```sh
node packages/companion/build-plugin.mjs
node packages/companion/install-codex.mjs /absolute/build-output/design-system
```

For a distributed, already-built package, its included installer is equivalent:

```sh
node /absolute/design-system/install-codex.mjs /absolute/design-system
```

The installer places the package under the personal marketplace at
`~/plugins/yugoo-design`, preserves unrelated marketplace entries,
and invokes native `codex plugin add yugoo-design@<personal-marketplace-name>`.
Updates use the same command; builds carry a unique version suffix to avoid stale
plugin caches. Prior package files remain in a named backup directory reported by
the installer. It does not delete Design Projects, edit project-local `.codex`
configuration, or replace old test skill shortcuts. If a same-name registration
points elsewhere it stops rather than taking over that installation.

After installation, start a **new ordinary Codex TUI conversation** in your
workspace and exchange a message before opening a Panel. Use a workspace without
obsolete manual skill/MCP overrides. Check
that the `design-system` MCP tools and `$yugoo` skill are available, then use
`$yugoo new <name>`. Do not install duplicate project-local MCP/skill entries.
Native installation failure retains the package and prints a retry command;
installation success is not proof of model execution or GRA correctness.

Legacy workspace shortcuts can shadow a correctly installed plugin. Before
retesting an old workspace, inspect its `.agents/skills/design` and
`.codex/config.toml` for manual references to `dist-plugin/build-*`. Retire only
confirmed obsolete entries into a recoverable backup outside skill discovery;
do not replace them with another temporary build path or touch Design Files.
Restart the native session to reload both Skill and MCP from the installed package.

The Codex CLI entry resolves the main transcript by the exact thread UUID under
`CODEX_HOME/sessions` (default `~/.codex/sessions`) and validates its metadata
against the native working directory. `--transcript` is an explicit override,
not a requirement to search logs manually. Ambiguous or mismatched evidence is
rejected; absent evidence is reported as unavailable. Native agent tools belong
to the host session: Companion's inability to spawn foreground agents says
nothing about whether that session exposes native subagent tools.

Prerequisites: Node.js `>=22.19.0`, Git and a Codex CLI with `plugin add` support. Individual
Kit scripts can additionally require their declared browser/npm dependencies.
This remains a local development distribution, not a published marketplace release.

From repository root:

```sh
node packages/companion/build-plugin.mjs
node --test packages/companion/test/plugin-package.test.mjs
COMPANION_BROWSER_TEST=1 node --test packages/companion/test/plugin-package.test.mjs
```

The builder prints a new `packages/companion/dist-plugin/build-*/yugoo-design`
directory. It contains the manifest, launcher skill, compiled server/browser and
raw Web App Kit resources. An optional output argument must be a **new** directory
named `yugoo-design` (legacy `design-system` is also accepted); existing directories
are never overwritten. It does not
install or change personal marketplaces/configuration. The manifest source under
`plugin/design-system` is not itself runnable before packaging.

Run `node scripts/design.mjs --help` from the generated package. Its Panel server,
file inspection and shared validation run without repository `node_modules` or
an installed DSH. Builds still use this checkout and its pinned DSH pure JSON
snapshot helper; this is a build dependency, not a second runtime. The copied
Kit scripts keep their own declared npm/browser requirements.

The relocated-package test starts the **compiled** server outside the checkout,
uses real Git/file/schema operations, and captures a test-only `codex` subprocess's
argv. The earlier optional browser test edited a native question Panel and verified
the saved bytes. Neither test contacts a real Codex conversation. See
[verified scope](#verified-scope) for the acceptance boundary.

The browser test requires `agent-browser` and its local browser. It creates and
removes only temporary fixture projects and its own named browser session. It
does not open a user's browser or send a real Codex message.

From the built directory package, for an **isolated test project and dedicated
Codex thread**, use the exact package path printed by the builder:

```sh
node /absolute/build-output/design-system/scripts/design.mjs serve \
  --host codex --project /absolute/design-project \
  --thread 00000000-0000-4000-8000-000000000001 \
  --host-cwd /absolute/native-conversation-workspace
```

First open an ordinary Codex TUI in the intended native workspace and exchange
a message. Replace the UUID with that exact dedicated thread ID and pass the
actual native workspace as `--host-cwd`, independently of the Design Project
path. The repository-only `scripts/start-companion.mjs` helper has no
`--host-cwd` option and defaults native cwd to the project path; use the packaged
`serve` entry above when these directories differ. The command prints a
local authenticated URL. Do not share it. Optional `--kit` selects a local Kit
directory, `--transcript` selects the exact conversation's native log (not the
latest log), `--state-root` selects machine runtime and cache storage, and `--port`
sets a fixed loopback port. Ctrl-C stops this companion, not DSH.

## KAG / GRA trigger model (shared with DSH)

Companion's main Agent reads `design_main_context` and reports evidence-based
U/S/T with `report_design_clarity`. The ordinary report checks the selected
project, exact Kit content and saved Git Design evidence; it does not inspect
native call logs or enforce one report per user turn. Identical current reports
are reused; changed intent or corrected reasoning can produce another assessment
on the same Design checkpoint. Missing or failed assessment does not block
continuing authorized Design work.

Choosing **Save and assess next step** requests U/S/T through that existing main
Agent continuation before its next question, Bundle recommendation or closing
reply. Multiple saved edits can share one report of the latest state; unchanged
or replayed saves and an applicable current assessment need no duplicate score.
Later user stop/cancellation takes priority. Unavailable or failed reporting is
disclosed, without rolling back the saved Design or starting another model.

Persistent assessment scores/reasons and GRA suggestions/dispositions live under
`design_records/` in the project and are committed through the shared Core Git
path. The project is their sole durable authority, including after copying or
restoring Git history. Assessment display and main-Agent context read the
Git-published `design_records/clarity.json`. If a new report's publication fails,
the previous committed assessment remains visible; without one, the project
remains unassessed. The local replacement stays available for an explicit report
retry, and reads never commit or repair it. Native requests, run handles,
notifications, locks and rebuildable caches remain in machine runtime storage. Historical acceptance or
execution records never replace current native binding and permission checks.
There is no automatic migration or second read/write authority for old storage.
Save notifications remain independent: saved, sent and consumed are separate
facts, and an uncertain send is not automatically replayed.

Native project `help`, `status`, `list` and Spec preparation do not acquire the
project-command write lock or retain the mutable installed Kit. Explicit Kit
selection and content installation/upgrades still validate immutable content
and their write ownership.

WorkBuddy 5.8.3 background review support is conditional on a verified native
background descriptor created after the current Companion connection opened.
The public `run_in_background` parameter alone can fall back to synchronous
execution. Unverified background capability keeps detached review requests pending; a content-free
readiness bootstrap is distinct from dispatching a real review. Structured
`TaskOutput` receipts establish terminal state. Source protocol fixtures do not
claim installed-host acceptance or permission to change Host settings.

Derived Design Knowledge (KAG) and GRA combine successful-publication defaults
with Agent judgement and explicit human requests. The runtime owns single-flight,
immutable version pins, stale-result fencing, atomic latest-complete publication,
save-first ordering, and finite attempts without busy-polling or automatic retries.
Each project's Design advisories settings provide GRA `continuous`, `auto`, and `off`,
plus `autoMergeWindowMs` (default 30 seconds) and `continuousIntervalMs` (default
10 minutes, configurable 1–1440 minutes). The lightbulb entry opens settings even
with no pending suggestions. Continuous runs online only, skips busy rounds, and
never accumulates catch-up jobs. Clarity and KAG are independent. Reviewers receive
bounded existing disposition records; rejection does not expire automatically or
forbid findings supported by new evidence. Exact repeated evidence/actions are
suppressed at the shared journal boundary; semantic similarity is not a discard rule.

Shared defaults on every host (DSH and Companion):

- **Open/activation never auto-indexes.** Opening a project samples cheap
  durable state only. DSH injects a compact `<design-knowledge-status>`
  notice into the next main-conversation boundary; Companion exposes the
  same snapshot through `design_knowledge_status` (MCP) / `knowledgeStatus`
  (HTTP) and merges it into save/finish tool responses.
- **Successful save settlement auto-indexes.** Panel saves and successful Bundle
  publications admit bounded KAG maintenance even without graph visualization.
  Worker drafts, status reads and advice publication do not trigger maintenance.
- **GRA follows the user policy.** Auto coalesces publication rules over its
  configurable quiet window, with useful Agent initiative allowed immediately;
  continuous checks the latest published version every configurable N minutes (default 10), even unchanged; off forbids autonomous GRA but
  explicit human `design_recheck_reviews` remains available. Active work is not
  cancelled on each publication. Historical results cannot update current KAG.
  Managed Codex owns process execution; other native adapters queue exact review
  notices to their bound main Agent, which launches native children when supported.
  Notification acceptance is not execution; uncertain delivery is not replayed.
- **Explicit bounded entries remain.** `design_refresh_knowledge` (MCP) /
  `refreshKnowledge` (HTTP) admits at most one maintenance pass for the
  current generation and returns a structured `accepted | noop | rejected`
  result with the exact target checkpoint/generation. A failed generation
  stays failed until an explicit request re-admits it once; the runtime
  never loops on its own. Native GRA reviews keep the existing
  `design_prepare_review(s)` / bind / submit native flow.
- **Honest state vocabulary.** One closed union shared by all hosts:
  `current | due | queued | running | failed | disabled | unavailable |
  unknown`. `current` derives only from the durable latest-complete
  publication matching the authoritative Design Files head; `due` keeps the
  latest complete generation readable and always reports both heads;
  `running` requires a real pipeline/subagent, never a mere queue entry.
  Ordinary Companion context also reports its read basis and coverage. A verified
  source-only view can be available while semantic maintenance is `failed`;
  its pinned queries use the same source-only view. Complete publication and
  advisory review capture keep their existing stronger guarantees.
- **`knowledgeAutoRefresh: true`** is an explicit host opt-in that restores
  the legacy on-open indexing behavior. The default is `false`. It never
  waits for the open response and never sends an implicit prompt.

### Explicit foreground GRA fallback

Background capability and the ability to review a design are separate. The
shared source implementation asks the user to choose **Disable automatic GRA**
or **Run this review synchronously in the main
conversation** when background execution is unavailable or a native asynchronous
run still occupies the main conversation. Explain that the latter
occupies the conversation. Without a selection, change no policy and start no
review. Disabling automatic GRA reuses `off` and preserves manual review.

With background execution that leaves the main conversation available, manual
review retains its asynchronous route. Otherwise, confirmation authorizes only
the requested foreground batch: the main Agent
reads the same Grounding, Reflection and Alignment profiles and submits their
results through the shared review path. It does not need to bootstrap a
synchronous child, supply a background descriptor, or enable a permanent
automatic foreground policy. Existing input pins, schema validation, stale-result
checks and Git-backed advisory records remain. U/S/T is main-Agent assessment;
KAG has its own lifecycle. Neither is disabled by unavailable background GRA.

Read the full existing policy with `design_read_review_policy`; choosing `off`
changes only its mode through `design_update_review_policy`, retaining the
other settings. A confirmed one-time request uses `design_recheck_reviews` with
`executionMode: "foreground"`; the default stays `background`. The main Agent
uses `design_read_review` and `design_submit_review` without `nativeRun` only
for that explicit foreground request. Background launch/binding checks remain
unchanged. `foregroundReviews: true` does not establish background readiness.

QwenWorkCN `1.3.2` disables native background Agents, while a reported WorkBuddy
`5.8.3` run launched asynchronously but still held the main conversation. The
shared choice applies to both conditions, without treating either report as a
permanent limit across hosts or versions.

The inspected
QwenWorkCN `1.3.2-26101704` desktop deliberately disables background Agent
Sessions; an ordinary restart or `.env` change is not a supported repair. See
the [version-specific assessment](hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy)
and [current fallback status](../../docs/wiki/hosts.md#后台能力与评审降级).

## Deliberate limits / next acceptance gates

- Do not run concurrent DSH/companion/native Agent writers against the same
  project in this preview. There is in-process serialization but no shared
  cross-host writer coordination yet.
- Native observation currently reads the recorded item format of Codex 0.153.4.
  It is not a stable official subscription interface, may lag until items are
  recorded, and is not a per-token live stream. The browser never writes native
  logs or starts/resumes a thread. Missing, malformed or mismatched logs show
  unknown/unavailable, not completed. Approvals and questions remain in Codex.
- Native Producer/Worker binding, per-artifact recorded logs, Bundle settlement,
  background GRA/U/S/T results and accepted-action receipts are implemented.
  The plugin's native-execution reference coordinates actual Codex children;
  by default the companion does not launch a model. Opt-in `serve
  --background-reviews` uses service-owned Codex evaluations after settlements,
  without main-conversation prepare/spawn/bind/wait calls. This consumes the CLI
  account's quota. `--review-model` selects the evaluator explicitly; it does not
  inherit a model temporarily selected in the interactive conversation.
  API tests use native-format fixtures, not real model fanout.
  Real end-to-end native generation/review is still an acceptance gate.
- Project commands reuse Core selection and lifecycle operations through the
  host skill/CLI. A successful selection change can require reopening the Panel.
  Claude Code and Qoder have separate native-hook adapters; their existence is
  not complete host/version acceptance. There are no fabricated DSH tools or
  automatic external agent spawning APIs. Native agents use the documented
  local bridge.
- Save-event metadata, checkpoints and delivery receipts persist for the exact
  project and native binding. Reopening that binding reads the saved state without
  sending anything. **Recover notification only** is available only for a proven
  not-submitted save; it rebuilds the note from the saved checkpoint without saving
  again or rerunning a Bundle. Accepted or uncertain submissions are not replayed.
  Check the original conversation when delivery is unknown; these receipts do not
  establish exactly-once Agent execution.
- Only the current worktree is served, not historical artifact browsing.
- Public distribution and its full license/dependency inventory remain separate
  release work. Genuine native-host loading and this new conversation observer
  are further acceptance gates; a valid manifest and test transport do not prove them.

DSH's entry, mounting, Agent tools and execution path remain unchanged. Shared
code reuses worktree projection, attachment decoding and the message renderer.
CSS injection now distinguishes source paths so two `design.tw.css` files do
not suppress each other; it preserves existing HMR ownership. No Bundle rules
were added for this companion change.

## Isolated Studio authoring services

Complete local instances additionally expose `studioInstancePrepareChanges` and
`studioInstanceSaveChanges` through the existing protected RPC. They delegate to
the same instance service and source repository as single-file editing. Preparing
a candidate returns a source-bound digest, exact file diff and same-revision real
Core preview without saving. Batch save defaults to recoverable `draft`; an
explicit `validated` save requires that digest and rechecks the exact source and
sample under the existing atomic CAS lock. Invalid drafts remain recoverable,
while a failed or stale validated request leaves the current revision intact.
The operation changes one local working-copy record, not installed content,
publication, user projects or Agent execution. The
[Studio domain contract](../studio/README.md#edit-current-content)
records file budgets, declarative-preview scope and process-interruption recovery.

The shared `createStudioAuthoring` factory, also available through the compatible
`src/studio-authoring.mjs` module, narrows those ports to one
host-bound instance revision and an explicit set of source paths. Its `read`
operation returns coherent source text and the actual shared component catalog;
`prepare` returns the existing S1 diff, preview, digest and full replacements for
the user's existing save path. Concurrent edits invalidate the binding. The
adapter grants no save, deletion, publication or native dispatch capability.
Hosts must authenticate the invocation and supply the binding themselves; this
adapter alone does not connect a Studio UI or establish native Agent execution.

`studioInstanceEditCurrent` opens the same library identity for editing;
explicit Copy creates a separate identity. Source imports enter that same
editable instance service, including incomplete definitions that need repair.
The old Kit/Panel draft confirmation, lock/fork and content-upgrade routes are
removed. Bundle trials retain their existing native execution boundary; the
internal repository can still read historical trial source records.

`studioContentExport` exports an installed source or an exact saved instance.
`studioContentReadArchive` is a stateless format, path, byte and digest check
for a previously exported archive, returning `StudioContentArchive`. It creates
no import record, performs no full definition validation and grants no execution
or native-provider trust. Its files enter `studioInstanceImportSources` for
ordinary editing and saving. The old prepare/read/list/adopt import workflow
and immutable content publication are no longer exposed.

The existing HTTP request cap stays 12 MiB including
the JSON request wrapper, even though offline archive functions support a larger
envelope. Oversized HTTP requests return 413 rather than being truncated. These
service endpoints do not by themselves establish complete browser authoring,
new-Kit scaffolding, Bundle trial execution or installed-package acceptance.

`createStudioTrials` in `src/studio-trials.mjs` supplies the isolated trial backend
port: an exact installed Bundle or saved Panel draft revision is retained and
materialized byte-exactly into a private trial Kit, compiled with the existing
loader, and given a new Core Git project and an owned Companion server. The host
injects the existing native connection and `startCompanion`; no model client is
created. `start`, `read`, `list`, `stop`, `remove` and `close` are backend methods,
not proof of a wired HTTP/UI or live native execution. Child startup carries
`studioTrial: true`; the host must disable nested trials for that instance.
Records retain the complete source identity and are limited to 100, never evicted.
Queue acceptance is only `queued`. A trusted child `readTrialEvidence` must bind
both trial ID and isolated project ID to actual execution evidence; absent or
unavailable evidence is `unknown`, not failure or completion. Output files alone
never prove termination. This slice explicitly rejects `stop` until a verified
host interruption port exists, and rejects removal of active/unverified trials.
Parent closure closes every owned Panel server without claiming to stop native
execution or deleting retained projects. Reopened records do not automatically
restart servers or resend tasks; stale result links are withheld. Focused tests
use real snapshots/projects with fixture host ports, not a live native Agent.

`studioTrialStart` accepts optional `task`. Omitting it requests a generated first
input: the existing native turn reads the Bundle method, generates concrete
synthetic test input including the tested Bundle name, records that actual text
once through `design_submit_trial_input`, then executes it through the existing
Bundle protocol. `preparing` means input is pending, not successful execution.
The public record exposes `inputMode` (`generated` or `manual`) and `task` when
recorded. A supplied task must be nonempty and at most 32 KiB; it is used exactly
as edited and is not regenerated. Each run uses a separate isolated project.
Same-source preparing/queued/running/unknown trials prevent redispatch. Waiting
permits another isolated round without claiming the previous run terminated.

Studio's title-row trial entry first calls `studioTrialAvailability`. This checks
the injected connection's optional non-generating `probe`; configured host/thread
metadata is insufficient. Nested trial children are unavailable; an absent or
invalid probe is unknown, and probe errors return unavailable without exposing
raw host details. Hook transports use the existing empty probe/ACK, which never
enters model input. Codex initializes its native proxy and reads the exact thread
without turns, queue insertion, resume or turn start. This proves API reachability,
not TUI liveness or execution; queue/evidence and unknown-delivery rules are
unchanged. Unavailable or unverified UI checks do not dispatch a new trial.

`studioTrialStart` also accepts optional `locale: "zh-CN" | "en-US"`. It is an
explicit run-language contract, retained in the record and read/list responses;
invalid values are rejected before project creation or native dispatch. Omitting
it preserves compatibility with older callers and records without inventing a
language. Changing language does not bypass the same-source active-run guard.
The native instruction asks for generated input and human-facing Panel content
in that language, including delegated execution, while preserving technical IDs,
schema keys, paths, version pins and user-edited task text. The authenticated
child `info.trialPanel` exposes the same locale for the session-bound UI; it does
not change a global browser language preference. This contract does not infer or
rewrite a locale from natural-language task text, and does not claim model
compliance merely because the queue accepted the instruction.

Input receipt is restricted to the exact owned child Companion connection and
trial ID, not native-agent authentication or a new model client. Ordinary project
connections and manual trials reject it; recorded input cannot be overwritten.
Before a generated input receipt, child begin/register execution is rejected,
while method preparation remains readable. Missing receipt cannot be reported as
completed. Source MCP/HTTP tests verify these boundaries with a fixture queue;
automatic input generation by a real native host requires separate verification.

## Windows native foundations

The shared native Hook module includes Windows process identity and private-storage helpers. Normal directory packaging and npm candidate staging copy both helpers alongside the native transport; installation readiness rejects a missing dependency. Source tests cover exact worker identity, applicable user permissions and rejection of replaceable storage ancestors. The original user-level `.local/state/design-system` location is retained; existing directory permissions are never repaired automatically.

These foundations do not establish QwenWork integration, a positive production private-storage initialization, default-timeout performance, or DSH Desktop GUI installation. A real QwenWork import and original-session notification require their own official-host verification; no separate model client supplies that evidence. The Linux/WSL Qoder acceptance below retains its stated scope.

## Qoder CLI preview

Build with `node packages/companion/build-plugin.mjs --qoder` from the repository
root. It prints a new, self-contained plugin directory; it does not overwrite
an installed plugin. From the intended native workspace, start:

```sh
qodercli --plugin-dir /absolute/path/from/build/yugoo-design
```

Then use `/yugoo-design:yugoo new My Project`. The skill creates/selects the
project, selects a relevant mindset, and opens the existing Panel. Notifications
use native Hooks; cross-session messaging is not required. Restart Qoder with the
updated plugin and reopen the Panel when testing an update. The current native
process-binding implementation is Linux/WSL, verified on Qoder CLI 1.1.48.
Model selection remains yours; the plugin does not change it.

The native cwd contains a small `.design-system-qoder-notify` signal file. Its
contents are not messages; notifications reside in private local state. The
CwdChanged Hook keeps watching the original signal path when the agent changes
working directory. Restarting Qoder still requires reopening the Panel against
the new native process. A missing/disabled Hook fails the
connection probe instead of pretending browser messages were delivered.
See [verified scope and remaining acceptance limits](#verified-scope).

Studio trial verification has separate layers. `studio-trials-http.test.mjs`
checks real local HTTP, isolated project/server creation and source preservation
with a fixture native queue. The opt-in `studio-trial-native-smoke.mjs` uses
`claude-qwen --thinking disabled`, an isolated CLI configuration, the compiled
MCP entry and real Bundle generation/settlement. It delivers the captured trial
dispatch to that CLI: it does **not** prove automatic hook wakeup of an already
running host. KAG indexing is outside this focused check. Current native ports do
not expose verified interruption, so Stop reports that limitation and retains
the trial instead of pretending it stopped. A service restart retains trial
records but cannot assume ownership of the previous runtime server.
## QwenWork Windows preview

The [QwenWork owning guide](hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy)
records the inspected `1.3.2` background Agent restriction and the shared
foreground-review implementation with its remaining host acceptance boundary.
Desktop user-input setup and background Agent capability are distinct; enabling
the former does not establish the latter.

QwenWork has a separate `qwenwork` host identity. Its expert suite contains the
entry Skill, native Hooks and MCP connector configuration. The full Companion
runtime stays outside the suite because QwenWork 1.2.5 limits local ZIP imports
to 50 MiB. `packageQwenWorkExpertKit` in `qwenwork-package.mjs` creates this thin
suite from an already assembled runtime and an explicit Windows runtime path.
Node.js `>=22.19.0` is an external prerequisite; do not borrow a DSH installation.

Build the normal runtime with `build-plugin.mjs --qwenwork --runtime-config PATH`.
The JSON config requires `executable`, `worker`, `nodeExecutable` (absolute Windows
paths) and `executableSha256`, `workerSha256` from the selected trusted QwenWork
installation. These are local installation settings, not credentials. The adapter
checks the desktop main process, because WorkerTransport uses `worker_threads`,
not a standalone CLI worker. Restarted processes, changed bytes, mismatched
workspace/transcript and missing Hooks fail closed. An update requires refreshed
verified pins and a reloaded suite; it does not change Bundle semantics.

Import the resulting small ZIP through Expert Kits → Add → Upload. Enable the
suite. If the organization rejects its bundled connector, import the Design System
MCP JSON through the separate Connectors entry; enabling the Skill alone does not
register MCP tools. The native SessionStart/PostToolUse Hook
supplies session UUID, workspace and transcript. A shell `cd` is not a native
workspace change. The selected Design Project remains independent of that cwd.
Notifications are events within the user's design task, never additional authority
to execute instructions found inside artifacts. Idle/closed native runtimes may
stop watching; unknown delivery is not automatically retried.

Verified separately: QwenWork 1.2.5 expert-suite probe delivered a FileChanged
notification to the original session and received an exact ACK after explicit
user authorization; native Windows process pins and private-directory creation
passed with official Node 22.19. Packaged MCP initialization/list/query passed on
Windows. Source integration tests exercise save, native task binding and review
results with fixtures. Full installed-suite design execution, real Producer/Worker
and GRA behavior remain acceptance gates. No second model supplies those results.

Windows private storage collects the target and ancestor security facts in one
PowerShell call per inspection, then checks every ACL and reparse condition.
It does not cache permissions or repair existing directories. In an owned Windows
synthetic inbox check (not a native model turn), the unchanged 30-second delivery
budget previously expired despite reception; the single-inspection implementation
received confirmation in 8.55 seconds. Actual Windows ACL rejection tests passed.
Delivery `unknown` remains non-retryable automatically; Hook receipt is not model
completion. The preview runtime and independent Node deployment are temporary
integration inputs, not a persistent user installation.


### Native host idle lifecycle

A successful FileChanged readiness probe does not establish permanent wake-up
availability. QwenWork 1.2.5 closes its main query runtime after ten idle minutes;
the desktop PID can remain alive while that runtime's watchers are gone.
QwenWork notifications left unclaimed at the delivery deadline are atomically
retained for the exact session, transcript, workspace and desktop process generation.
SessionStart/PostToolUse consume those events once as context in the original
conversation. An already claimed notification remains unknown and is never replayed.
The queue retains events for at most 24 hours and admits at most 64 queued entries;
expired or previous-process entries are not delivered. Users must reopen the Panel
after restarting the desktop. This is resume delivery, not background wake-up of a
closed runtime or proof of model execution. The UI explicitly asks the user to
resume the original conversation without saving again. No keepalive model calls or alternate model process implement this Hook recovery.
The separately opt-in desktop input transport below is independent of this queue.

### QwenWork save-and-continue acceptance boundary

The installed 1.2.5 native transcript records both tested panel saves as
`SYSTEM NOTIFICATION - NOT USER INPUT`. FileChanged/asyncRewake did start
responses and the original agent inspected the saved changes, but explicitly
refused to treat the second notification as authorization to continue beyond
the prior user instruction. Hook delivery is therefore **not** a verified
user-input transport. The browser keeps a manual continuation instruction visible;
this is a fallback, not completion of automatic save-and-continue integration.
Do not remove the host's system-event classification, rewrite transcripts, or
claim that a receipt is user-input acceptance. The experimental desktop input transport below provides a separate original-session
input entry; Hook-only connections retain the manual fallback.


### Experimental QwenWork desktop user input

The product entry remains normal QwenWork startup followed by Design System in
that existing conversation. Do not install a dedicated QwenWork launcher. The
following launch flag describes the completed experiment; it is not a required
replacement entry for users. See [preconfiguration findings and current limits](hosts/qwenwork/README.md).

With explicit user opt-in, launch QwenWork with
`QWENWORK_DESKTOP_CONTROL_ENABLED=1`, then use the existing `serve` command with
`--host qwenwork` (desktop input by default; the explicit `--qwenwork-desktop`
alias remains supported). Startup fails if verified user input is unavailable;
it never silently selects Hook events. `--qwenwork-events-only` explicitly opts
into the limited event transport, which is not automatic user input. Startup
reports the selected `inputMode` and actual capability rather than inferring it
from whether a flag was supplied. This is a version-pinned preview of the
installed desktop control protocol, not a claim of a stable public QwenWork API.
A normal app restart may disable the entry; reopen the Panel against the new
native process. The flag does not change Bundle execution or model selection.

The adapter authenticates to the private loopback desktop endpoint and uses
`task.submit` for Companion composer messages and the existing post-save user
intent. Both use the same `project.sendPrompt` path. It resolves the native
transcript UUID to exactly one desktop subchat using a read-only database query,
then verifies the native process generation, executable/worker pins, workspace,
transcript and desktop instance. It never changes QwenWork databases, transcripts,
authentication or app bytes. A database/protocol change must fail closed and be
reviewed against the updated host; the mapping is not a portable public contract.

Background review notifications remain system events via `sendEvent` and the
native Hook transport. They never become synthetic user authorization. Busy
sessions reject a new input without submitting it. An uncertain submission is
not retried or replayed through Hooks. Acceptance means QwenWork created the
native task; it does not mean the model finished. Previously saved files remain
saved when delivery fails.

Verification boundaries: pure transport tests cover exact-session submission,
busy/changed bindings, uncertain delivery without retries and invalid input.
Scheduler tests ensure background review events avoid the user-input route.
The installed Windows desktop entry and the actual Companion browser composer
each returned an exact native ACK in the original conversation. The browser
cleared its input after acceptance and displayed the native reply. A separate real user save then triggered native `design_status` on the exact
connection and an accurate reply describing the persisted answers, without a
manual host message. Further design progression is not verified: the agent still
misclassified the explicit continuation request as artifact text and declined
advancement (the prior task was also limited to requirements). No alternate model
or shell-driven conversation simulates these results.

## Performance and lifecycle boundaries

WorkBuddy renews its authenticated widget lease independently of message polling
and native RPC. Expired/disposed widget generations cannot settle another
generation's claimed message. Full terminal relay receipts are bounded, while
bounded tombstones reject evicted IDs instead of replaying them; the 33rd message
does not exhaust a cumulative submission limit. A claimed message that loses its
owner remains unknown and quarantines that old relay. The existing explicit
**Restore design Panel** action asks the original conversation to call
`yugoo_workbuddy_open_panel` once with the same exact parameters. That MCP call
starts a fresh owned service (it does not reuse a cached relay), retains private
unknown/accepted receipts, and permits distinct new events only. It does not
resend the old event, restart design work or kill the Host. The old service still
expires under its existing idle/lifetime bounds. Source/VM/temporary-project
fixtures verify these boundaries; native Host behavior remains a separate
acceptance check.

Companion separates presentation observation from operation authority. A visible
page has one shared one-second clock; each reader permits one in-flight request.
Hidden pages stop scheduling reads, and a folded conversation or `panel-only`
page does not subscribe to foreground history. Workspace and history reads time
out after ten seconds so a stalled request cannot hold a reader forever. This
read recovery never retries a save or message submission. A send first displays
its in-progress state; only the native receipt permits an acceptance notice.
Recorded history remains the host's durable projection, not a fabricated echo.

Display workspace reads verify current project metadata and publication through
the existing display path, without adding a full Git project-open on each tick.
Operations still revalidate the project; UI `writable`, revisions and cached
projections grant no authority. Review status, clarity and advisories share one
existing project lock per display snapshot. Public review APIs and writers retain
their own locks and currency checks. This consistency covers review storage; it
does not turn an external native agent or a workspace into a transaction snapshot.

Windows process inspection offers a reusable, owned helper for adapters. It
accepts only bounded PID or literal-path ACL requests, queries fresh OS facts and correlates
every response. The queue is bounded, its deadline starts at enqueue, and an
error, mismatch, exit or timeout fails closed. Disposal ends the owned helper.
QwenWork is the first adapter using it for desktop sends and within one Hook's
ancestry and private-storage verification. An explicit Hook scope shares one
interpreter across registration and receipt, then closes it in `finally`; every
ACL request still inspects the target and ancestors and runs the same permission
and reparse checks. No scope is retained between Hook processes. Its before/after process snapshots, full executable and
worker hashes, endpoint instance, unique session mapping and submit receipts
remain mandatory. Hashing streams file chunks instead of allocating both whole
programs; helper reuse is not an identity or installation-trust cache. Other
Windows adapters can adopt this mechanism after their own native verification.

KAG is driven by publication/explicit maintenance, not a display timer; failed
maintenance does not silently retry at idle. Display work still includes bounded
HEAD checks, changed-file projection and Journal/review reads. Conditional
responses reduce transport, not all server computation. Large journals, many
completed agents and multiple visible windows therefore remain separate load
cases to measure. Performance reports distinguish cold/warm native verification,
submit acknowledgement, host log availability, browser rendering and idle work;
a fast helper probe alone is not an end-to-end host acceptance result. DSH native
Remote and UI lifecycle remain owned by the DSH adapter.

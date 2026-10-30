# WorkBuddy integration

Yugoo Design uses WorkBuddy's existing conversation, models and tools. Its
Design Panel opens through the native preview or in your system browser; saved
Design Files remain in your Design Project.

Start with [installation and updates](#stable-installation-and-updates), then
[open and use a Panel](#open-and-use-a-panel). For a disconnected page, use
[connection recovery](#connection-recovery-and-service-lifetime). The
[adapter reference](#adapter-reference-for-maintainers) describes protocol
constraints and is not an additional installation checklist.

This guide distinguishes the current adapter source from installed-host results.
Use the acquired package's own help and supported native version. Windows
WorkBuddy 5.7.x checks established main-mode design, serial foreground Producers,
Panel saving and original-conversation readback for their tested candidates.
Workers remain unsupported. In WorkBuddy 5.8.3, background review is conditional
on a verified native launch; an observed asynchronous review still occupied the
main conversation. Manual foreground GRA was user-confirmed, which does not
establish nonblocking background execution or acceptance of every npm release.
See [host compatibility](../../../../docs/wiki/hosts.md#workbuddy).

## Stable installation and updates

Use the [WorkBuddy installation prompt](../../HOSTS.md#install-or-update-workbuddy)
in your existing desktop conversation. The Agent should inspect the requested
exact `yugoo-design` npm version and integrity, reuse a matching retained
installation or acquire the new version in a separate persistent directory.
The [shared package guide](../../README.md#npm-candidate-and-native-installation-boundary)
covers Node selection, CPU dependency installation and model preparation.

1. Prepare materials from that acquired package with its
   `yugoo-design install --host workbuddy` entry. Supply the verified Windows public
   Node path, an external persistent preparation destination and an explicit numeric
   native suite version, using the actual options in the package's help.
2. Import the returned `nativeImport.market` directory through WorkBuddy's
   marketplace importer and enable its `yugoo-design` suite and MCP connection.
   In the inspected 5.7.6 desktop, the entry was **Skills → Skill Market → Suites
   → + (Add Marketplace)**; use the equivalent native control in your version.
   A full plugin belongs in the marketplace importer, not the standalone Skill
   ZIP importer.
3. Complete only the required native activation or normal new-session/reload
   action. Confirm the actual installed version, loaded `yugoo` Skill and tools.
   Preparing files or seeing a success notice does not prove native loading.
4. Continue with the first-project request below when you are ready to start a
   design task. Verify a meaningful Panel edit/save/reopen and the original
   Agent's consumption separately from installation.

The acquired manifest selects the Node range; current packages use Node.js
`>=22.19.0`. Product npm versions and numeric native suite versions are
independent. Select a native version for the acquired package; an owned update
must exceed the previous preparation receipt's suite version. Historical test
suite numbers are not version recommendations for a new installation.
Preparation from WSL or another OS must use the explicit Windows path mappings
in the [desktop preparation guide](../../README.md#desktop-npm-package-preparation);
preparation there does not verify the target Windows runtime.

A fresh market is named `yugoo-design`; it does not need a prior test market or
`--previous-receipt`. For an owned update, keep the old npm directory and receipt,
acquire the next exact npm version in a new directory, and use the same
preparation destination with `--previous-receipt` and a greater suite version.
The preparer preserves the registered market name and path, including an older
test-market identity, instead of silently migrating it. Keep one active Yugoo
Design integration; duplicate Hooks or MCP copies can interfere with delivery.

Use the market-name menu **Refresh**, confirm its listed new version, then
**Update** the installed suite. These are separate actions: the inspected desktop
keeps a marketplace list cache, and Update can use that old list. Check the
actual loaded Skill and tools after the host's normal refresh or new-session
action; an existing conversation may still hold the old runtime. Do not promise
hot reload or silently restart WorkBuddy.

Keep the acquired npm runtime, preparation output and selected public Node at
their persistent paths. The small installed suite does not contain the complete
runtime, and a market refresh cannot restore deleted dependencies. Do not edit
WorkBuddy's plugin cache or register a separate host launcher. To remove the
integration, use the [native removal instructions](../../HOSTS.md#disable-uninstall-and-retained-files)
while preserving Design Projects and any runtime still needed by another host.

## Open and use a Panel

After activation, select the installed `yugoo` Skill in the original WorkBuddy
conversation. For a new project, you can say:

```text
Use Yugoo Design to create a Design Project named my-first-design with the
Web App Kit. Help me describe one useful workflow, then open its Design Panel
so I can inspect and change it. Do not generate the entire application yet.
```

For an existing project, ask the same conversation to reopen it. The Agent uses
`design_command` with the current WorkBuddy identity and then
`yugoo_workbuddy_open_panel` for the selected project. You do not need to find a
connection file, type a session UUID or create another project to reopen a page.

The current native connection widget connects automatically after its exact
metadata and host channel are ready. The host may render it before opening the
Panel; connection readiness does not prove a page is visible. Keep the widget
in the originating conversation: opening a browser alone does not establish
the route for **Save and continue**. Saving files is independent of notification
and remains valid if the message cannot be delivered.

Edit one useful field, save it, reopen the Panel and ask the original Agent to
explain the saved change. Check those outcomes separately: a visible page, a
connected relay, persisted files and native consumption are different states.
The [first design cycle](../../../../docs/wiki/getting-started.md#3-创建设计项目)
and [project commands](../../../../docs/wiki/commands.md) give the next steps.

### Host-side design view (automatic opening and connection control)

The Agent passes the returned `nativePreview.arguments` unchanged to WorkBuddy's
native `present_files` tool once. This is a direct native tool call, not an MCP
wrapper call. Reuse an already successful open-panel result; navigation does not
require another service startup, new project or regenerated Bundle. The tool
opens the actual local HTTP page, not an HTML redirect artifact.

WorkBuddy owns the preview container and toolbar. In the inspected 5.7.7 desktop,
local URLs without a native-browser binding use a preview that hides the address
input; public URLs can show it. The `present_files` schema exposes no browser
container selector. Automatic opening in an address-bar browser tab therefore
remains unverified. A `previewed` receipt alone cannot identify the visible
container or establish save-notification delivery.

If native navigation is unavailable or fails, reuse the same live Panel through
**其他打开方式 → 在系统浏览器打开**, or the connection help's copy-address action
and WorkBuddy's native **打开浏览器** entry. A browser URL can open that existing
service; it cannot select a new project or rebind the destination conversation.
Do not repeat navigation to prove a different container, change URL hostnames
to influence the toolbar, invoke private IPC or install an unrelated browser
extension as a substitute for native support.

The embedded `panel-only` view omits history and the composer, starts with the
right rail collapsed, and puts project information and U/S/T under **当前项目**.
Hover/focus previews that information; click pins it. Outside click or Escape
closes the popover. Design suggestions and project settings remain available.
The same live service can also open a full browser view with history and input.
Changing presentation does not create another token, service or native binding.

## Connection recovery and service lifetime

If delivery is uncertain, check the original WorkBuddy conversation before any
retry. Accepted interface delivery is not proof that the Agent read or completed
it. Do not send the same saved edit again or regenerate a Bundle merely because
a browser receipt is missing.

For an unavailable Panel, use **Restore design Panel**, or explicitly ask the
original conversation to reopen the same existing project once. That request
uses the ordinary original-session user-input route; it does not authorize a
new project, Bundle execution or replay of the old message. Check the new native
reply and use the returned page and current widget, which connects automatically.
An accepted recovery request is not yet successful Panel startup.

Host restart or worker recycling can invalidate a service while historical
widgets remain visible. A plugin update does not replace those saved widget
snapshots. The earlier widget `tools/call` recovery path failed in the tested
host; use the current original-conversation recovery above. Unknown startup or
message submission must be inspected rather than automatically attempted again.
A security-policy rejection is not a reason to recreate a service or bypass CSP.

Current services allow one hour without widget pulses or authenticated Companion
API activity before idle shutdown, with an unchanged four-hour maximum lifetime.
These settings apply to newly started updated runtimes, not an old running
service. Static or unauthorized requests do not extend the lifetime. Service
activity is not proof that a person is editing, and a browser cannot send through
a missing native widget. Closure leaves saved Design Files intact. Reopen against
the new native process after restarting WorkBuddy; a browser refresh cannot
restore a service that has stopped.

Bridge failures distinguish `WB_BRIDGE_NETWORK`, `WB_BRIDGE_TIMEOUT`,
`WB_BRIDGE_POLICY` and `WB_BRIDGE_RESPONSE`. A policy diagnosis requires an
observed violation for that exact origin; a network error alone does not prove
idle shutdown or its cause. Retain the existing failure and inspect its own
connection. Do not search for a latest/global connection or remove unrelated
runtime state to recover one Panel.

## Reviews, clarity and knowledge

U/S/T reports and KAG have their own lifecycles. They do not require a native
background GRA capability. Review policy, a background launch, a completed review
and a user's decision to change Design Files are also separate states.

WorkBuddy 5.8.3 can expose a native background descriptor, but its public
`run_in_background` option can fall back to attached execution. The observed
asynchronous review still occupied the main conversation. When the current host
cannot keep the conversation available, choose either **Disable automatic GRA**
(`off`, retaining manual review) or **Run this review synchronously in the main
conversation**. The latter requires an explicit choice for this batch and uses
the shared review validation path; it does not enable permanent automatic
foreground review. Without a choice, the Agent does not change the policy or
start the review. User-confirmed foreground use is not nonblocking background
acceptance. See the [host review choices](../../../../docs/wiki/hosts.md#后台能力与评审降级).

Local semantic indexing needs dependencies built for the actual Windows runtime
and the fixed model in that Windows user's cache. A Linux/WSL dependency tree or
cache does not establish Windows readiness. Use the acquired package's
[model preparation guide](../../README.md#local-embedding-model-preparation),
not another host's service or a copied foreign-platform dependency closure.
Unavailable embeddings do not prevent basic design work; report structural and
semantic readiness separately. Do not clear a user's database or rewrite Design
Files to hide a model-loading failure.

In the earlier 5.7.x KAG path, installed checks covered a nonempty project's
refresh, matching-checkpoint query and canonical readback. They do not certify
every current package or query mode. The recorded text filter matched substrings
rather than expanding natural-language synonyms; embedding readiness alone is
not evidence that a paraphrased query will return an expected record. Use the
actual query's source pins and coverage. Recovery and query failures remain
visible, and explicit refresh is bounded rather than an automatic retry loop.

## Adapter reference for maintainers

The remaining sections explain runtime identity, delivery and execution
contracts. Ordinary users follow the installation and usage sections above;
source tests, isolated probes and a successful package build do not replace
installed-host acceptance. The [shared host contract](../../HOSTS.md#shared-contract-host-specific-adapters)
owns the domain boundary, and the WorkBuddy adapter owns its native protocol.

### Current source: main U/S/T and conditional native background GRA

The current source exposes ordinary `design_main_context` /
`report_design_clarity` over project records and Git. Reports check the selected
project, Kit content and saved Design evidence without native-log or user-turn
proof. Identical current reasoning is reused; corrections on the same checkpoint
are allowed. An assessment failure does not block authorized work. KAG and GRA
remain independent of saving and notification delivery. Scores/reasons and
suggestions/dispositions are durable project records; native handles, claims,
notifications and caches stay local to the runtime.

WorkBuddy 5.8.3 exposes a structured background descriptor and TaskOutput status
route. Real GRA dispatch requires `design_status.hostCapabilities` to report
`backgroundReviewReadiness: ready` and `backgroundReviews: true`, proved by a native
descriptor created after this exact Companion connection opened. Without it,
requests remain pending; the public background parameter alone can fall back to
synchronous execution. A content-free explicit readiness bootstrap is separate
from a real review. Native task IDs, parent calls and status receipts are checked;
unknown state is not running or completed. Workers remain unsupported.

Capability and project policy are separate. The adapter returns `state`,
`canDispatch`, `executionMode`, `reasonCode`, `observedMode` and bounded
`diagnostics`. A verified current launch selects `cooperative-background`:
WorkBuddy's main Agent cooperates by calling its own native Agent tool. This is
not `native-detached`, which requires a programmatic Host spawn facility outside
the main tool call. Unverified capability selects `unavailable`; queued requests
remain intact. Project GRA policy may still forbid dispatch when capability is
ready. Neither readiness nor a completed spawn call means a Reviewer completed.

Readiness distinguishes the actual 5.8.3 `attached` / `completed` descriptor from
a background launch. Valid session/root/parent/call IDs alone cannot promote it.
An attached result remains usable as a foreground Producer receipt only when
its native `lastId` matches the completed child message; the descriptor alone
does not replace that cursor. It is never background GRA proof. The ordinary
serial Producer uses `Agent` without `name` or `team_name`, then resumes that
same actual `agent-...` task ID. A named/team receipt is not a reason to poll for
`lastId` or to replay generation. The installed `yugoo` Skill gives the minimal
ordinary foreground call and caller-owned final settlement sequence.

Foreground binding errors first identify a named/team or descriptor-only shape
without `lastId` (`workbuddy-foreground-receipt-shape`), including a `running`
result. Other unfinished parent results use `workbuddy-native-result-incomplete`;
a completed ordinary call missing its cursor uses
`workbuddy-foreground-cursor-missing`. A confirmed READY-only bootstrap with no
file/command work, explicitly rejected before binding, may be corrected once to
the ordinary unnamed foreground call without fresh user permission; the new ID
still requires full native verification. Running/unknown status alone does not
prove no work. Real generation, unknown outcomes or uncertain binding acceptance
must preserve existing files and report the native outcome, without replaying
work, switching executors, scanning another session or waiting for one receipt
format to become another. Stop if the corrected bootstrap is also unusable.
These diagnostics do not weaken parent/session/cwd/cursor checks or establish
that a file settlement failed. After a foreground Producer returns, main
normally settles its registered run once; an already accepted settlement is
retained. File validation/publication and observed native execution remain
separate facts.

| `reasonCode` | Meaning and next evidence |
| --- | --- |
| `native-background-ready` | Current structured background launch verified; use the existing exact review binding protocol. |
| `native-background-not-observed` | No current launch observed; the initial optional content-free bootstrap is not a real review or an instruction to keep probing. |
| `native-attached-result` | The existing Agent result is attached. Inspect its mode/status; it does not identify a disabled Host setting. |
| `native-synchronous-result` | Legacy terminal child ID/`lastId` with no descriptor proves an attached synchronous result. |
| `native-background-descriptor-invalid` | Inspect the listed field/type/expected value mismatches; do not collapse them into a Host settings diagnosis. |
| `native-background-transport-missing` | No complete structured observation; absence does not prove synchronous fallback or revoke an already valid proof. |
| `native-background-stale` | The descriptor is older than the current connection/request; it cannot authorize a new binding. |
| `native-session-unavailable` / `native-connection-boundary-missing` | Exact bound records or the current connection boundary cannot be verified. |

Diagnostics include only bounded call/receipt/task identity and failing
mode/status/time/type checks. Content-like fields retain only type/length;
prompts, description text, native paths, configuration and tokens are excluded.
Once an attached, invalid, synchronous or incomplete attempt is observed,
`canAttemptReadiness` is false and no new bootstrap is offered. A later attached
or malformed descriptor revokes older readiness; an incomplete transport alone
does not. Inspect the existing receipt instead of asking the user to repeat
READY or changing settings. These diagnostics do not enable native background
execution or establish permanent Host non-support.

A read-only check of the installed WorkBuddy 5.8.3 runtime on 2026-10-19 confirmed
the native Agent conditions in `cli/dist/codebuddy-lite-wb.mjs`: the team system
is enabled unless `CODEBUDDY_CODE_EXPERIMENTAL_AGENT_TEAMS` equals `"0"`;
`CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS` disables background tasks for the
case-insensitive values `1`, `true`, `yes` or `on` (surrounding whitespace ignored).
Single-shot print blocks background execution when `options.print` is true and
`options.inputFormat` is not `stream-json`. These are runtime startup inputs,
not verified names for desktop Settings controls. Observing a synchronous result
does not identify which condition is active. Companion does not read or change
the Host environment, settings, or launch mode to bypass these conditions.

The exposed Agent schema's `run_in_background: true` explicitly **requests**
background execution. Its `mode` argument controls permissions, not execution
attachment; do not send `mode: background` or invent a force-detached parameter.
The installed schema omits the background option when background tasks are
disabled, and the executor may still fall back under the other gates above.
Named teammates are also gated and are not an automatic bypass. The inspected
5.8.3 success path constructs `mode: background` / `status: running`; only the
actual bound native receipt verifies that path. Source inspection or an attached
result cannot prove the current effective gate or permanent lack of support.

The same installed desktop's `main/cli-prewarm-pool.js` resolves the team flag
from `expertType` and `disableAgentTeams`: a `team` expert enables it; other
sessions disable it unless `disableAgentTeams` is explicitly false. The desktop
app-config getter also defaults that key to true when absent or not boolean.
The desktop filters inherited `CODEBUDDY_*` environment entries before applying
its explicit child environment, so changing an unrelated terminal environment
does not establish the desktop session's capability. This startup inspection
does not read the current session's effective settings.

A separate read-only check of the installed 5.8.3 renderer confirms the ordinary
Chinese desktop entry: avatar at the bottom left → 设置 → 智能体 →
智能体团队管理 → 开启. The `settings-agent-teams` selector maps 开启 to
`saveDisableAgentTeams({enabled:false})`; it is shown only when the desktop
adapter exposes that operation. See the official [settings entry guide](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting).
This is a user-controlled Host setting, not a Companion flag. Explain that it
allows WorkBuddy to split complex tasks across native agents; never change it,
an expert manifest or an environment variable silently. Neither the UI setting
nor documentation's general immediate-effect statement proves that an existing
CLI process has acquired the capability. Verify the actual current-connection
background receipt after setup. After enabling it, start a new ordinary WorkBuddy
conversation and open the same Design Project. Reopening the existing conversation
or its Panel may retain the old CLI configuration. Keep the existing installation
and project; this path alone does not establish background capability. Do not
prescribe a full application restart without a concrete reason, repeat a failed
probe or call GRA accepted from the switch alone. Foreground design, KAG and main
U/S/T do not depend on this switch.

The standalone suite copies the maintained shared native execution reference
beside its actual installed `skills/yugoo/SKILL.md`, which links to it. This is
source/protocol implementation, not installed-host acceptance or a new release
claim. Earlier 5.7.x results retain their tested scope; they do not permanently
disable the new conditional 5.8.3 route or establish its native acceptance.

### Native identity and foreground execution

Use the current Hook's exact session UUID, native cwd and transcript path.
`design_command` selects the Design Project; `yugoo_workbuddy_open_panel` takes
that selected root and native identity explicitly and starts only an owned
Companion service. A configured installed runtime supplies code and Kit paths;
model arguments cannot choose arbitrary executable code. A shell `cd` is not
proof of a native workspace change, and a supplied Hook marker is not by itself
authenticated execution authority.
WorkBuddy uses its owning open-panel tool; there is no generic
`serve --host workbuddy` entry to substitute for it.

WorkBuddy's observed foreground Agent results use
`providerData.toolResult.subAgent.sessionId`, `afterId` and `lastId`. The returned
Agent ID differs from the child JSONL's internal UUID. The adapter checks the
exact main dispatch/result pair, structured Agent ID, canonical child location,
parentage, cwd/session consistency and terminal child cursor. A filename or an
assistant's pasted ID cannot establish that binding. Resume stays running until
the native parent result confirms its child cursor; unbound later activity is
unknown. These identity checks do not claim OS-level filesystem sandboxing.

The serial Producer flow bootstraps without writes, registers the actual native
receipt, then resumes that same Producer with the complete Bundle method,
resources, exact connection and scoped task. Main-mode Bundles stay main-mode;
missing Workers or background GRA are not bypassed by changing Bundle placement.
After the Producer returns, main settles the registered run through the shared
validation/publication path. It does not repair the Producer's files or replay
already accepted settlement. A committed publication with deferred ordinary
index maintenance remains committed; follow the existing bounded
[publication recovery contract](../../README.md#verified-scope) for an unfinished
receipt rather than changing Git settings or deleting locks.

### Native message route and browser admission

WorkBuddy's documented [MCP Apps contract](https://www.workbuddy.cn/docs/cli/mcp-apps)
separates `ui/message` user input from `ui/update-model-context`. The originating
MCP App supplies the conversation route. The observed native callback is guarded
by the active App for that conversation, so switching or closing the conversation
is not a verified delivery scenario. The local-assistant Open API and cloud-task
ACP examples do not establish delivery to an arbitrary existing desktop session.
Do not create another conversation/cloud task, use private application IPC or
reuse account credentials to simulate original-session input.

Current local packages explicitly select `browserAccess: local`. The returned
`/browser/<instance>/` URL carries a public service generation, not a bearer
credential or a project identity. Refresh, history-back and an additional full
view remain valid for that service. Host/Origin checks and the UI-operation
allowlist still apply. Browser access mode is a startup declaration, not a model
tool argument; CLI defaults and DSH's native access remain separate.

Browser admission and the native relay have separate credentials and authority.
The MCP App relay retains per-instance credentials in host-only metadata,
requires the exact original widget, and declares its endpoint in resource CSP.
Sandbox Origins may be opaque; that does not remove relay authentication. The
browser-access URL may be passed unchanged to an authorized native navigation
tool, but do not extract tokens, print private connection files, publish the URL
in reports or send it to unrelated services.

Widgets renew their lease independently of polling and native RPC. Stale,
competing, expired or disposed generations cannot claim or settle another
instance's message. A claimed message whose owner is lost remains unknown;
old accepted/unknown receipts are retained during explicit recovery, never
replayed into a new service. Late replies cannot reactivate an old widget.
Unclaimed expiry and uncertain claimed delivery remain distinct. Source fixtures
for these guards do not establish unattended delivery in every desktop version.

### Recorded history and shutdown diagnostics

The 5.7.x native observer uses WorkBuddy's flat JSONL `message`, `function_call`
and `function_call_result` grammar, not QwenWork's Claude-style records. It reads
the exact Hook-provided transcript and verifies session/cwd. First activation
captures a durable byte boundary for the bound project/session; reopening it
reuses that boundary without backfilling earlier conversation history.

Only public user/assistant text and top-level tool names/status are projected.
Reasoning, tool arguments/results and private provider metadata are excluded.
The reader is incremental and retains at most 200 rows. History reads are
independent of project/Panel refresh, but native transcript persistence can lag.
Hidden or collapsed history stops its subscription and catches up when reopened;
sending does not fabricate an optimistic native reply. Neither polling nor a
fast fixture establishes an end-to-end desktop latency guarantee.

Normal service closure writes a bounded, credential-free
`<connection>.closed.json` beside the existing connection file, then revokes the
live file. The diagnostic records the exact project/session, times and
idle/maximum/explicit reason; it grants no routing or execution authority. A
write failure does not prevent cleanup, and forced OS termination cannot promise
this receipt. Inspect a recorded reason rather than assuming every missing
listener was an idle timeout.

### Packaging and official extension surfaces

The [WorkBuddy package builder](../../workbuddy-package.mjs) owns the native
suite/market material. Keep source/runtime assets outside temporary directories,
retain old versions and receipts, and use the npm preparer's normal owned-update
route. Do not rewrite installed caches or host registry/settings. The
[installed Design Skill](design-SKILL.md) and its shared native execution
reference carry the runtime instructions; a packaging check does not prove that
a running host loaded them.

The existing low-level `packageWorkBuddyProbe` and
`packageWorkBuddyProbeMarketplace` APIs retain their historical code names.
They emit `.codebuddy-plugin/plugin.json`, `.mcp.json`, Skills and Hooks, with
the marketplace's `.codebuddy-plugin/marketplace.json` pointing to a versioned
relative plugin source. The builders refuse an existing output directory.
`packageWorkBuddySkillConnector` is the separate standalone Skill/MCP fallback;
it does not install Hooks. These source APIs do not register a native profile
and are not extra commands required after the npm installer.

The official [plugin system](https://www.workbuddy.cn/docs/workbuddy/Plugins),
[expert package](https://open.workbuddy.cn/docs/expert),
[connector formats](https://open.workbuddy.cn/docs/connector) and
[marketplace format](https://www.workbuddy.cn/docs/cli/plugin-marketplaces)
define distinct surfaces. An expert is not an arbitrary directory of Skills.
A Node-launched MCP server does not require simultaneously importing both MCP +
Skill and CLI + Skill formats. A standalone Skill/MCP fallback does not install
Hooks or establish original-session identity and delivery. A separate design
expert or model conversation is not a prerequisite for this integration.

The official [Skill format](https://open.workbuddy.cn/docs/skill) uses `SKILL.md`
with YAML frontmatter. This integration does not require GitHub Secrets, a Claw
Webhook, or unrelated memory/security Skills. The
[Hook reference](https://www.workbuddy.cn/docs/cli/hooks) specifies Git Bash
commands on Windows; the adapter's actual desktop checks remain authoritative
for its supported version. Do not borrow QwenWork's PowerShell or `asyncRewake`
behavior without independent host verification.

For protocol work, the [context probe](../../src/workbuddy-context-probe.mjs)
provides bounded identity fields without a binding registry, transcript reads
or profile writes. Probe suites and ACK messages are diagnostics, not normal
installation prerequisites. The [package tests](../../test/workbuddy-package.test.mjs)
cover packaging and identity boundaries; real native discovery, user input,
save/readback, restart/idle behavior and each execution mode still need their
own evidence. The [Open API](https://open.workbuddy.cn/docs/openapi) does not
supply proof of exact original-session access merely because it can send a
message.

Return to the [host integration entry points](../../HOSTS.md).

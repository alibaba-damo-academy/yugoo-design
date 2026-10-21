# WorkBuddy integration

## Current source: main U/S/T and conditional native background GRA

The current source exposes ordinary `design_main_context` /
`report_design_clarity` over project records and Git. Reports check the selected
project, Kit content and saved Design evidence without native-log or user-turn
proof. Identical current reasoning is reused; corrections on the same checkpoint
are allowed. An assessment failure does not block authorized work. KAG and GRA
remain independent of saving and notification delivery. Scores/reasons and
suggestions/dispositions are durable project records; native handles, claims,
notifications and caches stay local to the runtime.

The Companion Panel service now waits one hour without widget pulses or
authenticated Companion API activity before idle shutdown. The four-hour
maximum service lifetime remains unchanged. The new idle timeout applies to
services started from an updated runtime; it does not alter a running service.

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
claim. Historical acceptance and limitations below remain pinned to their tested
versions; they do not permanently disable the new conditional route.

## 0.3.20 connection card and secondary browser action

The user confirmed installed 0.3.19 panel interaction/save reached the original
WorkBuddy conversation: one exact-connection status read, with no duplicate write
or new Bundle. That is native consumption evidence, separate from local fixtures.

The MCP App regains its own bounded border. In panel-only its initial state shows
connection status, with the external full browser button collapsed under
"其他打开方式". There is no delay or second binding click. Full-view opening and
explicit recovery retain a directly visible action. Host-owned tool-result card
ordering is unchanged: the card can arrive before `present_files`. Relay readiness
is not evidence that a browser page is visible; no timer or fabricated readiness
claim is added. This change does not alter browser admission, persistence, message
transport, the Companion page, CLI entry or DSH. The installed Skill also corrects
the stale recovery instruction to click the replacement widget: since 0.3.18 the
new original-conversation widget connects automatically, so recovery reuses that
opening flow and does not ask for an obsolete binding click.


## 0.3.19 current-project sidebar information

The user's installed 0.3.18 report and `捕获4` screenshot confirm automatic
`present_files` navigation, the panel-only layout and the compact project header.
That report opened the page only; refresh and save-notice consumption remain
separate native acceptance checks.

The user then requested removal of the Companion project header in this view.
Version 0.3.19 places the same U/S/T, project name and full path under the right
sidebar's "当前项目" entry. Hover/focus previews it; clicking pins it for reading.
Keyboard score explanations, closing and narrow-window wrapping are retained.
This is shared panel-only presentation, not a WorkBuddy-specific field projection.
Full Companion and DSH retain their existing headers. The host-owned preview
menu/toolbar above the webpage is separate and is not removed by this change.

## 0.3.18 local browser and panel-only preview

The preview package now explicitly selects `browserAccess: local` in
`scripts/workbuddy-package-runtime.json`. The server still binds the selected
project and original native conversation before returning a URL. Its public
instance URL contains no browser bearer and does not require storage: refresh,
history-back and an additional full browser remain valid during that service.
Changing the runtime config to `token` before startup restores token admission;
this setting is not an Agent tool argument. Existing CLI defaults and DSH native
Remote authentication remain unchanged.

Use `view: panel-only` (`design` is a compatibility alias). The right rail starts
collapsed; U/S/T and project name share one header, with a focusable path tooltip.
History/composer are absent and not polled. The original MCP App automatically
connects after host readiness and exact metadata, without sending a synthetic
message. Its primary button opens a full view in the system browser. An external
window failure does not disable the connected save relay. The host still owns
its browser chrome; no address-bar change is claimed.

Source/isolated browser verification and native installed acceptance are separate.
The final WorkBuddy check must verify the actual loaded 0.3.18 Skill, automatic
connection, refresh/back, and one saved notification consumed in the original
conversation. No new Bundle is needed for that check.


Read-only comparison on 2026-10-07 found WorkBuddy desktop **5.7.6** installed
on Windows (`@genie/workbuddy-desktop`). Initial discovery established suite
installation, a real MCP catalog call and a visible identity Hook marker;
0.3.0 then added the shared Companion for explicit main-mode Bundles.
Later checks verified serial foreground native Producers through 0.3.8.
Workers and detached GRA remain unavailable, and no generic
`serve --host workbuddy` entry is supplied.

### Host-side design view (automatic opening and connection control)

Version **0.3.17** attempts automatic opening of the local Companion. After obtaining the panel result,
the Agent calls native `present_files` with `nativePreview.arguments` unchanged
once. A successful result already obtained for this request is reused instead
of restarting the service. This is direct HTTP navigation, not an HTML artifact.
Manual URL copying and discovery of another browser Skill are not prerequisites.
The address-bar difference below is a separate host UI limitation, not a reason
to refuse automatic page opening.

On 2026-10-11, the user returned a real-session execution report confirming
the installed `0.3.17/skills/design` path, reuse of the existing WorkBuddy test
project, one successful `open_panel(view: design)`, and automatic opening of
the local design page through `present_files`. Its result had `files: []`, the
loopback URL in `previewed`, and `Successfully opened 1 preview(s).` The report
also confirmed that no Bundle ran and no Design Files were changed. This is
user-supplied native-session evidence, not another independently observed UI run.

The same report exposed a routing mistake: an initial call through an MCP tool
wrapper said `present_files` was unavailable. Calling it directly as the native
top-level tool then succeeded once. `present_files` belongs to the host's native
tool catalog, not an MCP server's catalog. Invoke the native tool directly with
the returned arguments; a failed MCP lookup does not establish its absence.
Reuse the successful panel result when correcting the tool route rather than
starting another service. This evidence covers the native tool call and preview
navigation only. The user subsequently rejected completion: the page still did
not open in the required built-in browser tab. The original address-bar/browser
requirement was never waived. Automatic opening in that target remains unfinished;
the report also establishes no new save-notice delivery. The current widget must
still be connected to the original conversation.

The 0.3.15 real-session test successfully loaded the local Companion through
`present_files`, using its existing browser-access URL. The user's latest
screenshot (`捕获3.PNG`) shows a preview surface without an address bar and with
unwanted space above the page. The user requires the actual address-bar browser
shown by their earlier manual navigation (`捕获2.PNG`). Automatic opening of that
specific container is **not accepted**. A `previewed` tool receipt proves neither
browser chrome nor native rendering. The user's public-URL test opened Baidu
with an address bar. Both observations are valid: this host distinguishes the
display of public and local URLs even on the same preview path.

Read-only inspection of installed WorkBuddy 5.7.7 found that `present_files`
emits a generic `openBrowser` request, whose renderer path opens a preview. In
`renderer/assets/ui-docs-viewer-CREovSeD.js`, the `qDe` toolbar treats a URL as a
local preview when there is no `nativeBrowser` binding and it starts with
`file://`, or matches the HTTP(S) `localhost` / `127.0.0.1` pattern. That branch
hides Back/Forward and replaces the address input with a local-file title while
keeping the toolbar. A public URL such as Baidu does not match and retains the
address input. A real native-browser binding also avoids this local-preview
branch. This explains the address-bar difference and the retained top region;
it is not a token, query parameter, or Companion layout decision.

The inspected `present_files` schema has only `files`, `cwd`, and `explanation`;
its handler forwards no browser-container selector. The native session browser
has a separate tab-opening path. The app contains a browser-control runtime,
but that does not prove a public browser control tool or Skill is installed and
available in the current conversation. A successful `previewed` receipt alone
does not identify which toolbar branch rendered. These findings are specific
to the inspected 5.7.7 installation, not a claim about every host version.
Do not invoke private IPC, patch the host, change URL hostnames to influence
classification, or substitute an external/headless browser to claim acceptance.

A separate candidate was identified by read-only inspection on 2026-10-11.
The installed host's BrowserRuntimeHost supports Windows and macOS and, by
default, registers an Electron session-browser provider named `WorkBuddy Browser`
with type `desktop`. Its tab-open operation calls the existing BrowserManager
with the product conversation ID. The first-party `browser-use` runtime receives
this provider endpoint when the host prepares that conversation's runtime.
The official Windows runtime feed supplies browser-use 1.1.0 for app versions
at least 5.6.0; its packaged Skill names `mcp__browser__browsers_list`,
`mcp__browser__browser_info` and `mcp__browser__tabs_new`.

This is a candidate, not a verified replacement. The official Skill primarily
describes external Chrome, Edge and QQ extensions. The settings UI is also gated
by the BrowserUse product feature, and the first-party MCP entry is gated by
the conversation's enabled browser capability. Neither current-conversation
availability nor selection of the desktop provider has been demonstrated.
Do not install an external browser extension just to claim the internal-browser
requirement is satisfied. An eventual native check must enumerate the actual
providers, verify that the selected provider is the WorkBuddy session browser,
and check its visible tab after opening the existing Companion URL. No private
endpoint may be manufactured or invoked to bypass host preparation.

The design-view adapter returns `nativePreview` for automatic native navigation.
It contains the actual local service URL, not an HTML artifact. If the native
tool is unavailable or navigation fails, reuse the running service and
"连接帮助" → "复制页面地址" with the native new-tab "打开浏览器" entry as recovery.
No further service startup, project creation or binding is needed to navigate.

The browser-access URL can be model-visible in authorized native navigation,
as it already is in CLI startup. Do not extract its token, read the connection
file, echo the link in reports or send it to unrelated services. The separate
message-relay token remains exclusively in host-only widget metadata. Existing
Host/Origin/token checks are unchanged. Credentials did not cause the wrong
container; removing them would not choose the correct native browser path.

The compact widget has no view dropdown: layout is selected at entry. Click
"连接当前对话" so the Panel's "保存并继续" can send the already saved result to
this conversation. It then reads "已连接当前对话". Saving files itself does not
depend on the relay. Copy fallback and lifecycle details are under "连接帮助";
full view retains its "打开设计面板" button. Opening a page does not connect the
relay, and a successful relay receipt is not proof of agent consumption.

The design page retains project navigation, settings and GRA surfaces and has no
history or composer. A full-view browser can use the same service. Hidden history
subscriptions and child logs pause; opening them again catches up. CLI, QwenWork
and DSH adapters are unchanged by this widget/host-instruction correction.

Instruction correction: 0.3.16 gated automatic `present_files` navigation on
finding a distinct address-bar browser capability. Version 0.3.17 restored the
direct URL call after incorrectly interpreting the user's clarification as
relaxing that target. The user explicitly rejected that interpretation. Keep the
successful preview evidence, but do not accept it as completion or ask the user
to repeat the same call to prove a different container. The
URL handoff, credential boundary, exact connection, original-session save route,
no-retry rule and main/subagent execution protocols are retained. No Bundle
methods or output contracts are changed.

Diagnostic correction: do not generalize the local-preview result to
"present_files never displays an address bar". The user observation and the
installed toolbar condition supersede that interpretation. Public URL success
also does not establish an argument for forcing the local URL into a native
browser. Repeating the same local URL call cannot select a different container.
For a future host regression check, compare a public HTTP(S) URL, a reachable
loopback HTTP URL through the same tool, and that exact loopback URL entered in
the native browser. Record visible toolbar controls separately from navigation
receipts. A local test page without credentials can reproduce the classification;
no project creation, Bundle execution, or binding replacement is needed.

The 0.3.14 widget binds connect, polling and host-receipt continuations to one
transport generation. Disposal or replacement retires that generation; late
replies and old timers cannot enable controls, claim another notice or join a
later explicit reconnect. Requests already sent to the host cannot be withdrawn.
If disposal precedes their receipt, delivery remains unconfirmed and is not
automatically acknowledged or retried. Switching between full/design is a
presentation choice and does not replace the original-session route.

Automatic rendering in the required address-bar tab remains unverified. Existing
manual rendering and earlier consumed-save acceptance retain their stated scope;
source fixtures cannot establish a new native navigation path. Neither layout
nor browser handoff enables Workers or detached GRA.

Earlier installed acceptance: **0.3.10** separates recorded conversation polling
from project/Panel reads. The user confirmed improved perceived delay in the
real WorkBuddy test, and the bound native log recorded the 0.3.10 Skill path and
test-message reply. This is qualitative native acceptance, not a measured
desktop latency guarantee. Version **0.3.9** moved the test deployment to
persistent paths, retaining the shared publication fixes verified in **0.3.8**.
The Windows test package records its publication source, adapter source and complete
build-tree pins separately; this remains a bounded preview.

Version **0.3.7** requests same-project recovery through an explicit
user message in the original conversation, replacing the failed 0.3.6 widget
`tools/call` route after a host worker restart. This follows 0.3.5's actionable bridge failure diagnostics and the
verified serial foreground native Producers introduced in 0.3.4.
Windows-native embedding dependencies and the fixed model cache remain from 0.3.3. Native save and
notification passed with the user in 0.3.1; conversation history passed in 0.3.2.
See the final acceptance sections for the remaining installed-session limits.

| Boundary | QwenWork evidence | WorkBuddy evidence and next check |
| --- | --- | --- |
| Distribution | Tested suite Skills/Hooks and separately imported MCP; the tested organization rejected the suite connector | Official plugin ecosystem supports Skills, MCP, Hooks, Agents and Rules; prefer its supported distribution format rather than copying Qwen's organization-specific workaround |
| MCP dependencies | Independent JSON import reached the real catalog tool | The user installed the native test suite and reported a successful real `design_list_panel_components` call; separate MCP import was not needed for this test |
| Shared local runtime | Existing local Companion with native session binding | Official connector documentation permits local stdio MCP; reuse the shared local runtime and Panel, subject to actual host discovery and path checks |
| Original-session input | Experimental desktop control passed actual composer reply and save readback; ordinary restart is still unverified | Public local-assistant API sends messages, but its documented body has no existing desktop session selector; it does not establish exact original-session delivery |
| Agent execution | Report each actual supported mode separately | Expert/Agent packaging does not prove isolated Producer, optional Workers, detached review or their authority boundaries |

Official sources:
[plugin system](https://www.workbuddy.cn/docs/workbuddy/Plugins),
[expert package and MCP dependencies](https://open.workbuddy.cn/docs/expert),
[connector formats](https://open.workbuddy.cn/docs/connector), and
[Open API](https://open.workbuddy.cn/docs/openapi).
The connector guide distinguishes MCP + Skill from CLI + Skill; do not combine
both connector formats merely because our MCP server is launched with Node.
The expert format defines an Agent with optional Skills and dependencies; an
expert is not just an arbitrary directory of Skills. An expert listing may be an
optional discovery surface, but must not replace the existing host conversation
with a separately created design agent as a prerequisite to using Design System.

The public local-assistant message API requires a registered third-party
application and user OAuth authorization. Its documented request contains
`content` and `msg_type`; cloud-task ACP examples instead address cloud tasks.
Neither proves access to an arbitrary existing local desktop conversation.
Do not create a cloud task, route to an unrelated local-assistant conversation,
or reuse the host's private account credentials to simulate original-session
input. First establish a supported exact-session route and its authorization.

Installed-code inspection corroborates package parsing, not runtime acceptance:
`main/module.app-server.js` reads expert MCP dependencies and recognizes both
`.codebuddy-plugin` and `.workbuddy-plugin` manifests. Its SHA-256 is
`8317127ccef27621c3c493872ff0dcf68b58331f14656a9fe7d4fd690ee95e93`.
`main/conversations.js` contains native prompt handling, and `main/server.js`
contains session queue methods; these internal symbols are investigation leads,
not a public external API or permission to invoke a diagnostic execution server.
CodeBuddy CLI documentation alone is not acceptance evidence for WorkBuddy desktop.

Next acceptance should establish, in order: plugin/MCP discovery, trustworthy
current-session identity, one composer input with a native reply, then one durable
Panel save with exact native readback. Check idle, busy and restart behavior before
claiming automatic notification. Keep background Hook context distinct from
explicit user input. No WorkBuddy user profile or installed plugin was changed
during this comparison, and no separate host launcher is proposed.

## Owning discovery entry

- [Probe package builder](../../workbuddy-package.mjs): creates one separate local
  `yugoo-workbuddy-probe` package using `.codebuddy-plugin/plugin.json`, Skills,
  `.mcp.json`, and Hooks. It refuses an existing output directory.
- [Context probe](../../src/workbuddy-context-probe.mjs): emits bounded native
  identity fields only; no binding registry, transcript reads or profile writes.
- [Source tests](../../test/workbuddy-package.test.mjs): packaging, Bash quoting,
  overwrite rejection, bounded identity, and exclusion of tool-response contents.

The user confirmed the actual WorkBuddy 5.7.6 entry after local renderer inspection:
**Skills > Skill Market > Suites > + (Add Marketplace)**. The official
[changelog](https://www.workbuddy.cn/docs/workbuddy/Changelog) records plugins
moving into the Skills page in 4.7.3. Absence of a separate sidebar Plugin item
is not evidence that full plugins are unavailable.

`packageWorkBuddyProbeMarketplace` creates a `.codebuddy-plugin/marketplace.json`
with one versioned relative source under `plugins/yugoo-workbuddy-probe-<version>`. Add the
market directory, then install that named suite. This follows the documented
[marketplace format](https://www.workbuddy.cn/docs/cli/plugin-marketplaces);
the user subsequently reported actual desktop MCP loading and a visible Hook marker.
Both manifests and plugin source are self-contained in the small test market;
Node and the shared MCP runtime are explicitly selected existing test inputs.
Remove the test suite/market through WorkBuddy to undo installation.

`packageWorkBuddySkillConnector` is an optional fallback for an environment
without suite access. It produces a standalone `SKILL.md` directory and separate
MCP JSON; neither installs Hooks. Never import a full plugin into the Skill ZIP
importer or infer that skill import establishes native identity or reverse input.
All builders refuse existing output directories and do not install into a profile.

Official [Skill format](https://open.workbuddy.cn/docs/skill) uses `SKILL.md` with
YAML frontmatter, not a required `skill.yaml` entrypoint. Local Skill/MCP discovery
does not require GitHub Secrets, a Claw Webhook, a memory Skill, or a security
Skill. Such third-party automation instructions do not define this adapter.

The [CodeBuddy Hook reference](https://www.workbuddy.cn/docs/cli/hooks) specifies
Git Bash commands on Windows, unlike the tested QwenWork PowerShell path. The
probe follows that syntax, but only WorkBuddy's actual execution can verify its
applicability to this desktop version. It declares SessionStart/PostToolUse only,
not QwenWork's unverified-on-WorkBuddy `asyncRewake` property. A received context
marker is not an authenticated runtime binding or a proven reverse message path.

Return to the [host integration index](../../HOSTS.md).

## Reported desktop discovery result (2026-10-07)

After installing `yugoo-workbuddy-probe` from `workbuddy-test-market-v1`, the user
forwarded the host's result: `design_list_panel_components` with
`{"name":"question_workspace"}` returned the real component vocabulary, and
`YUGOO_WORKBUDDY_IDENTITY_PROBE` was visible with a session UUID and native cwd.
This is user-reported real host evidence, distinct from our four package/source
tests. The probe did not create a project, open a Panel, run subagents or read a
transcript. The marker is diagnostic identity, not authenticated runtime binding.

At the initial discovery stage original-session transport was unverified. The documented local-assistant
Open API has no target desktop-session parameter. Installed `server.js` contains
an internal `session/enqueue_message` client, but its presence does not establish
an externally callable authorized route. The desktop `/workbuddy/probe` server
only reports application/version/platform over GET; it cannot send messages.
Do not treat any of these as a successful composer or save-notification test.

## Native MCP App message probe

The documented [MCP Apps message contract](https://www.workbuddy.cn/docs/cli/mcp-apps)
uses `ui/message` for a user message, separately from `ui/update-model-context`.
Installed WorkBuddy 5.7.6 renderer code corroborates a desktop implementation:
`desktop-sdk-setup-Bmlg9Ea7.js` handles `onUserMessage` by calling
`requestSendPrompt({ sessionId: currentConversation.id, prompt: contentBlocks })`.
This is stronger evidence than an internal queue method, but still needs actual
native consumption. It also depends on the app remaining mounted and the correct
conversation being active; do not infer unattended external Companion delivery.

The fixed `yugoo-workbuddy-probe` suite includes the native message diagnostic.
Its only MCP tool `yugoo_workbuddy_message_probe` exposes a self-contained MCP App
resource. Loading the tool does not send a message. The user clicks once to send
a fixed test request through `ui/message`; it requests only a recognizable ACK.
The widget checks the advertised message capability, times out without retry,
and distinguishes an interface receipt from an actual native agent response.
It uses no remote script, model client, transcript reader or diagnostic eval API.
Existing discovery/MCP/Hook capabilities remain in that same suite. No WorkBuddy Panel, KAG or save acceptance is
claimed by this UI test. A future external browser relay needs its own exact
binding, lifecycle and duplicate-delivery checks even if this test passes.

The user confirmed the native message widget rendered, clicked it, and received
`YUGOO_WORKBUDDY_MESSAGE_ACK` in the original WorkBuddy conversation. An initially
omitted leading Y was a copy/paste omission corrected by the user. This establishes
user-reported native UI-to-conversation delivery for this test, not external
Companion or durable Design save acceptance.

## External input relay test

The same fixed suite includes the external-input transport diagnostic.
The MCP App must remain loaded in the originating WorkBuddy conversation. A user
click enables its loopback bridge and opens an external input page. Only that
page's explicit submission enqueues a message; the widget claims it once, passes
it through `ui/message`, and reports the interface result. Browser and widget
credentials are distinct, instance-local and absent from logs. The browser API
checks both token and same Origin; the sandbox bridge uses its own token because
sandbox Origins can be opaque, and declares the exact endpoint in resource CSP.
No external script or application account credential is used.

The queue rejects absent/stale/competing widgets, retains message IDs to prevent
replay, and distinguishes unclaimed expiry from uncertain claimed delivery.
An uncertain claimed message is not automatically retried. Closing the server
revokes the bridge. Interface success remains `submitted_unverified`, never an
agent reply or durable-save receipt. WorkBuddy's observed active-app guard can
silently ignore a message when the user switches conversations; we therefore
cannot promise delivery while its original app is inactive. Visibility and
heartbeat checks reduce that window but do not constitute host consumption proof.

This external page is a transport test, not a substitute Design Panel or a host
launcher. It does not create/edit projects, start KAG/GRA, or register native
runtime authority. The full Companion must continue using shared save/validation
and preserve saved files if notification is unavailable. Actual relay CSP/network,
external-to-native message delivery passed the user-operated 0.2.1 check below.
Conversation switching and actual-host cleanup checks remain pending.

## Stable installation and updates

For a fresh installation, acquire the exact `@yugoo-design/companion` npm version
in a persistent user-owned directory and use its `install --host workbuddy`
entry with the verified Node path, external preparation destination and
`--suite-version 0.3.29`. The acquired manifest requires Node `>=22.19.0 <23`.
Import the returned `nativeImport.market` directory through WorkBuddy's normal
marketplace importer, then enable the `yugoo-design` suite and its MCP connection.
The new market is named `yugoo-design`; no historical test installation or
`--previous-receipt` is required for first use. Preparation alone does not prove
native registration, activation or the actually loaded version.

For updates to an existing owned preparation, pass its verified
`--previous-receipt`, a new exact npm directory/version and a greater native suite
version. The preparer retains that market's original name and directory, including
the historical `yugoo-workbuddy-test` identity. It does not migrate or remove a
registered market. Never enable duplicate Yugoo Design Hooks/MCP copies.

Historical diagnostics used `yugoo-workbuddy-probe`: version 0.2.0 retained the
shared design MCP and identity Hooks and added `design-system-workbuddy-ui` for
both native-message and external-relay tests. The separate message/relay market
builders were removed; those suites remain historical test artifacts, not fresh
installation prerequisites.

Build each release in a fresh staging directory with matching suite/market-entry
versions. Preserve the stable registered market directory and its name; place
new source bytes in a new versioned child directory before replacing the catalog.
Do not rewrite old installed cache directories or host registry/settings. Use
WorkBuddy's market-name menu **Refresh**, then update the existing suite to the
new version. These are separate operations. In the tested desktop build, the
local directory marketplace keeps an in-memory plugin-list cache; the plugin
**Update** path can use that old list and return success without installing the
new catalog version. Refresh the marketplace first, confirm its listed version,
then update the suite. Verify the actual installed version and loaded Skill path;
a success notice or reloading an old Skill does not prove a new installation.
An existing conversation may retain its older runtime snapshot;
report actual new-tool availability separately from the catalog update. Do not
promise automatic hot reload, silently restart WorkBuddy, or create a new host
launch entry. The local market source update itself is not installed-host
acceptance. Keep both the acquired npm runtime and explicit Node executable in
persistent storage; a market refresh cannot restore a deleted runtime.


### External relay request-process lifetime correction (0.2.1)

The user saw the MCP App but clicking Connect returned `Failed to fetch`.
Read-only host diagnostics showed the exact relay origin in the applied CSP;
a native Windows request to that port returned `ECONNREFUSED`, while the host
continued serving the cached widget. The 0.2.0 relay belonged to the MCP process
and closed at stdio EOF, so rendered-widget lifetime could exceed service lifetime.

Version 0.2.1 starts the loopback diagnostic in an owned detached Node child when
the resource is read; EOF of the MCP entry does not stop that service. It is not
a host/model launcher and has no project IO. Distinct browser/widget tokens and
original-widget ownership still apply. It expires after five minutes without a
widget pulse or fifteen minutes overall. Tests cover parent exit and service
expiry. The subsequent user-operated host acceptance passed as recorded below.


### User-operated external message acceptance (0.2.1)

On 2026-10-07 the user reported that the updated widget opened the external web
page, that they clicked Send there, and that the original WorkBuddy conversation
replied `YUGOO_WORKBUDDY_EXTERNAL_ACK`. This establishes actual external-browser
input through the mounted native MCP App to the original conversation and an
agent response. It is user-reported host evidence, distinct from synthetic tests
and the Windows loopback parent-exit check. No further marketplace installation
or repetition of this same ACK test is needed for this fixed version.

This result does not verify delivery after conversation switching, a closed widget,
normal restart, or an expired relay. It also does not establish authenticated
project/session binding, Design save, Producer/Worker authority or KAG/GRA execution.

Next production slice: connect the shared Companion input and save-notification
transport to this native MCP App route, using one exact verified project/session
binding. Reuse the existing validated save and checkpoint path, preserve saved
files when notification fails, and distinguish queued/interface delivery from
native consumption. The current `server.mjs` has no WorkBuddy host branch and its
unknown-host observer fallback is Codex-specific: extending only its host allowlist
would misreport execution capabilities. WorkBuddy must explicitly negotiate its
supported run/review capabilities before that shared server path is enabled.
The next user acceptance is one real question answer save, original-host notice
and exact saved-state readback; the transport ACK alone cannot close that slice.


## Shared Companion main-mode preview (0.3.0)

The existing suite now includes the host-owned `design` Skill and
`yugoo_workbuddy_open_panel`. Use `design_command` with `host: workbuddy` and the
current Hook's exact session UUID to select a project. The open tool takes that
selected root, session UUID and native cwd explicitly; it starts only an owned
local Companion process. The user clicks its native MCP App to enable the bound
browser route. UI credentials are passed in tool-result `_meta`, not model text.
Its reusable UI resource accepts only loopback connections in its CSP because
each invocation supplies a new local port. Separate per-instance tokens still
authenticate all requests. A configured installed runtime supplies code and Kit
paths; model/tool arguments cannot select arbitrary executable code.

The native App itself supplies the originating conversation route. Supplied Hook
identity is routing context, not a new native subagent authority claim. Native
child execution, transcript observation, GRA dispatch and review binding fail
explicitly; they never fall through to a Codex adapter. Main-mode Bundle prepare,
begin/finish, shared validation, file/Git save, project commands and KAG use the
existing implementations. Do not rewrite Bundle modes to bypass this boundary.
The shared browser labels this host WorkBuddy and separates save from notification.
A message receipt means the interface accepted it, not that the model read it.

The service expires after fifteen minutes without widget pulses or four hours
overall and closes its Panel/connection file. Saved Design Files remain intact.
Switching/closing the native conversation is not verified delivery. This preview
uses explicit local Node/runtime paths and reuses the unchanged local knowledge
runtime through an owned junction; it is not an npm release or permanent install.

Verification: 19 source-level checks (Core source aliases were needed because the
shared development `lib` belonged to a different revision), plus normal server
and browser builds. The Windows compiled acceptance is recorded separately from
human-rendered/native-agent acceptance. Next human check is one real question
save, original WorkBuddy notice and exact canonical answer readback. No new ACK
probe or additional marketplace is needed.


Windows compiled acceptance for 0.3.0 passed with a new isolated project: shared
project creation and Mindset selection, main Bundle preparation, real schema/Git
save, offline notification rejection with canonical bytes retained, and a synthetic
widget receipt for the exact saved-state notification. The direct canonical read
used the Bundle's returned `designFiles` path. Shared KAG reported `state: current`
and `semanticLayer: enabled` for this small empty-question checkpoint; this is not
a meaningful nonempty-project semantic retrieval or GRA evaluation acceptance.
Owned servers were closed and the isolated project removed. A reused WASM runtime
kept its importer's Node worker handles alive after close in the harness; the
standalone WorkBuddy service now exits its owned process when its lifecycle ends.
No user WorkBuddy process or real project was stopped or removed.

### Native 0.3.0 question preparation diagnosis

The user opened the real Panel and activated the Kit, but the native agent tried
Kit/component or guessed names as Bundle IDs. The WorkBuddy placement guard
misreported unknown IDs as requiring a Producer. Read-only calls against that
same live connection confirmed that its installed catalog includes
`smart_questions` and that preparing it returns `mode: main`, `handoff: must_edit`.
No question publication, saved-answer consumption or transcript synchronization
was verified by this diagnosis. Recorded conversation remains unsupported in 0.3.0.

The source successor exposes the existing catalog as `design_list_bundles`, with
execution declarations and the Mindset method path; the Skill uses these exact
IDs. Preparation resolves the Bundle before checking host placement support, so
an unknown ID cannot masquerade as a native-agent limitation. Eight focused
source-alias tests passed, covering MCP discovery, unknown IDs, supported main
execution, rejected subagent execution and save/notification behavior. A separate
project-access test could not load because reused Knowledge build output expects
Core exports absent from this checkout; it is not reported as passing. These
source changes are not yet installed in the user's 0.3.0 runtime.

### 0.3.1 notification availability correction

The real user published questions and saved five answers, but notification was
rejected as offline. The saved canonical file was read back without modifying it.
The 0.3.0 widget incorrectly gated heartbeats on IntersectionObserver visibility
and document visibility. Scrolling the connection out of view could therefore
disable a still-mounted native App. The successor keeps the explicitly enabled
bridge alive independently of viewport visibility; disposal, stale heartbeats,
competing widget ownership and uncertain-send guards remain in force. A network
failure enables explicit reconnect without automatically replaying any message.

Installed WorkBuddy 5.7.6 renderer inspection confirms that its native MCP App
message callback is guarded by the active App instance for the conversation.
The adapter continues using that route; it does not send through a global composer
or private session API. Interface receipts remain unverified consumption, and
switching/closing native conversations is not a verified delivery scenario.
The shared history status now explicitly says WorkBuddy history is unsupported
instead of suggesting the user failed to bind it. This does not implement history.

Fifteen focused source-alias tests passed, including hidden/offscreen delivery,
disposal, reconnect without replay, stale/competing ownership and durable save
on notification failure. The normal server build and native Windows compiled MCP
catalog check passed. Version 0.3.1 is staged in the original local marketplace;
the user's installed suite and running 0.3.0 Panel are not edited in place. Real
save-and-continue consumption after updating remains to be verified. Unchanged
assets and the Knowledge runtime are reused through owned Windows junctions;
retain 0.3.0 assets until the dependent 0.3.1 runtime is removed or replaced.

### 0.3.1 user save acceptance and 0.3.2 history/Knowledge successor

The user confirmed that saving answers in Companion notified the original
WorkBuddy conversation, which used the exact new connection and confirmed the
auth/storage changes. The host subsequently completed the existing main Bundle.
This closes the real main-question save/notification/consumption slice, not
native Producer/Worker, GRA or semantic Knowledge acceptance.

WorkBuddy 5.7.6 records a flat JSONL grammar (`message`, `function_call`,
`function_call_result`), distinct from QwenWork's Claude-style format. The new
read-only observer takes `transcriptPath` from the current Hook, verifies exact
session UUID and native cwd, and uses the shared durable conversation-start store
under a host-specific namespace. First activation captures the current byte
boundary; reopening the same project/session reuses it. Earlier turns are not
backfilled. Public user/assistant text and tool names/statuses are presented;
reasoning, arguments, results and provider metadata are excluded. The reader is
incremental and retains at most 200 rows. This observation does not enable native
agent execution or review dispatch.

The real KAG failure was traced to packaging: both earlier WorkBuddy runtimes
reused old QwenWork Knowledge output with read-only file flush and Windows
directory flush calls. The source already had the proper durability fix. Version
0.3.2 rebuilds Knowledge from that source into its own runtime and reuses only
unchanged dependencies. It does not suppress EPERM or modify saved Design Files.

Validation: 15 history/boundary tests plus 9 focused integration/package tests
passed (the integration tests use explicit Core source aliases). Native Windows
passed the 3 history regressions and 2 file durability tests. Compiled Windows
service readback against the actual native session, using isolated runtime state,
reported `available: true`, `source: workbuddy-native-transcript`, and no native
subagent capability. Its zero initial rows are intentional at the new boundary.
A separate native Windows old-schema database recovery reached `ready`, retained
byte-identical backup bytes, and cleaned up only its isolated test database.
Normal server and Knowledge builds passed. Native rendering of new messages and
recovery of the user's actual Knowledge database remain user-session checks.

Update the existing suite from Installed after refreshing the original market.
Reopen the existing project using current Hook sessionId/nativeCwd/transcriptPath.
The new connection starts observing subsequent public replies; no project or
question regeneration is needed. Read Knowledge status and, if recovery is due,
request the existing bounded `design_refresh_knowledge` operation once. Preserve
the old database and recovery backups. This is still a local preview, not npm
publication or a persistent installer.


### 0.3.3 Windows semantic indexing recovery

The user's nonempty project exposed a second packaging defect after file recovery:
the reused QwenWork dependency closure was installed on Linux, and Windows failed
to load sharp before inference. The default Windows embedding cache also lacked
the configured model. This is not evidence of a WorkBuddy model limitation.

The owned test runtime now resolves transformers 3.8.1, undici 8.10.0 and
onnxruntime-common 1.21.0 from a separate native Windows pnpm 11.7.0 installation
using the checked-in lockfile resolutions. The existing portable Ladybug WASM
0.21.1 runtime is reused. No old runtime or installed plugin cache is modified.
Four model files for multilingual-e5-small revision
761b726dd34fb83930e26aab4e9ac3899aa1fa78 were copied from the existing local cache
and SHA-256 compared. Inference remains local-only; no design text is uploaded.
An installer must prepare and verify native dependencies and fixed model assets
for its target OS rather than carry another OS's node_modules into delivery.
The temporary native closure/cache is test preparation, not a finished installer.

Shared embedding workers now catch native-import, model-load and inference errors
inside the IPC boundary. Only a bounded category reaches public status; raw paths,
input and exception text are suppressed. Windows child processes are hidden.
No retry, remote fallback, capability change or graph authority was added.

Verification: 12 semantic orchestration/IPC regressions passed against the rebuilt
semantic module with explicit Core source aliases, and 5 suite packaging tests
passed. The normal portable Knowledge build passed. Native Windows local inference
returned a 384-dimensional vector. Against the user's unchanged d5e63ff checkpoint,
a separate disposable Knowledge state reached current/matching and returned five
question records, exact pins and the current login/storage answers through the
normal Companion query endpoint. A mismatched checkpoint was rejected. Owned test
servers and databases were closed and removed; canonical files were not changed.
This proves native runtime indexing and query, not recovery of the user's live
Knowledge database: after updating the existing suite to 0.3.3 and reopening the
same project, use the new exact connection, request one refresh if needed, and
read its terminal status before querying. Do not regenerate questions or answers.

### 0.3.3 installed WorkBuddy KAG acceptance

The user updated the existing suite and reopened the same native session/project.
One explicit refresh moved the actual Knowledge database from due to current,
freshness matching, at checkpoint d5e63ff2978dbb16f19669c580994d8e18cb7dc5,
revision rev:3. Native MCP context returned real pins and five design records;
sourceFiles queries returned the login/storage evidence. The native agent reread
the canonical file and confirmed anonymous/browser_temp without changing files.
Independent read-only calls through the exact user-supplied connection confirmed
current/rev:3 and embedding ready; no extra refresh or project creation occurred.
The single warning was an explanatory graph notice (aggregation and similarity
are not proof of business relationships), not an indexing failure.

The shared text filter currently performs case-insensitive substring matching
against serialized entities/relations, not semantic query expansion. Unmatched
Chinese paraphrases returned zero records; sourceFiles filters correctly located
the evidence. Embedding readiness does not imply natural-language semantic search.
Projected option labels aid reading, while submitted values remain governed by
the pinned source and schema. This acceptance closes the actual-session local KAG
refresh/query/readback slice. It does not verify native isolated Producers,
Workers, detached GRA, or a persistent production installer.


### 0.3.4 serial native Producer acceptance and background limitation

WorkBuddy 5.7.6's actual native Agent tool completed a foreground read-only child
and resumed that same child with its original context. Native results store
`providerData.toolResult.subAgent.sessionId`, `afterId` and `lastId`. The returned
Agent ID is not the child JSONL's internal session UUID. Its transcript lives in
the bound main session's subagents directory. Do not reuse QwenWork's task JSON or
Claude Code's metadata grammar, infer parentage from a filename alone, or trust
an assistant's pasted Agent ID.

The dedicated adapter checks the exact main dispatch/result pair, structured
native Agent ID, canonical child location, cwd/session consistency and terminal
child message ID. Resume remains running until the native parent result confirms
its child cursor; unbound subsequent activity is unknown. Reasoning, raw tool
arguments/results and private provider data are not projected into the panel.
Bounded transcript identity checks do not claim OS-level filesystem sandboxing.

The design Skill uses one foreground general-purpose Agent: bootstrap with no
writes, register its real native receipt, then resume that same Producer with the
full Bundle method, exact resources, connection and scoped task. Validation and
publication reuse the existing Core path. Main-mode Bundles remain main-mode;
Workers and GRA stay disabled separately. A server opt-in is set by this preview's
own panel entry, not by changing Bundle declarations or creating a host launcher.

Actual Windows acceptance used a separate temporary Design Project and state root,
the unchanged official role_access Bundle and the original WorkBuddy session.
The native Producer authored a minimal private-note role design. Its first state
settlement intentionally used string schema_version and was rejected. The same
Producer corrected it to integer 5, then settled pause successfully at commit
f12ea5c422709fcf1ebce4882c41b6f2886ee3be. Main performed coordination and readback,
not file repair. The test did not claim completion or rendered visual acceptance.
The user's original project's d5e63ff head and clean worktree were preserved.
Seven identity/resume regressions, five panel integration tests and five package
tests passed; four existing Claude/native-resolution regressions also passed.
Panel integration uses explicit Core source aliases; the actual Windows probe
uses a normal compiled server and the existing Windows native dependency closure.

A separate no-tools native Agent call with run_in_background=true actually returned
its completed result synchronously, with no background task handle. Installed
runtime code contains a synchronous fallback when background/team execution is
unavailable; the precise active host flag was not established. Schema acceptance
is not background execution evidence. Do not enable GRA on this result or replace
it with foreground reviewers. Future GRA support needs a separately verified native
background route. No host settings were changed to force it.

### Installed 0.3.4 Producer, input and save acceptance

After updating the existing suite, the user tested the original WorkBuddy session
and existing project 3c55ece8-b67e-403b-8d8a-8715625682ca. Native Producer
agent-4d23a01db9704a87 completed bootstrap, registration and same-Agent resume for
role_access, publishing state/pause without diagnostics at
d9ac741412f5d8482f2470a336263645abe83677. This is installed-session publication
acceptance, not Bundle completion. Independent Git inspection confirmed that
commit and the unchanged smart_questions checkpoint d5e63ff.

The first new connection widget immediately reported Failed to fetch. By the time
of inspection its connection file and relay listener were gone; this does not
establish why the original immediate click failed. A single panel-only reopen
recovered access without reinstalling, rerunning a Bundle or changing project
data. Before the user clicked, both new loopback services returned HTTP 200 and
the bridge preflight returned 204 with the required CORS headers. The user then
confirmed that Companion input reached the original conversation and received
WORKBUDDY_CONNECTED. The intermittent first-click failure remains unresolved;
successful reopening must not be reported as a root-cause fix.

On that same recovered connection, the user changed view_and_organize from single
to multiple and selected kanban_columns,simple_list,list_with_filter, then used
Save and continue. The user reported automatic native notice consumption, exact
connection design_status and saved-diff acknowledgement without a manual reminder
or duplicate write. Independent Git inspection confirmed exactly those two field
changes at e3567be1505ccda9aad1cf3ea8ff43eefcb74af4, above d9ac741, with a clean
worktree. This verifies durable save and native consumption on the recovered
installed connection. KAG currency at this newer checkpoint was not checked;
the earlier rev:3 acceptance remains pinned to d5e63ff. Workers, detached GRA,
restart reliability and production installation remain separate boundaries.

### Current-checkpoint KAG and 0.3.5 connection diagnostics

Subsequent read-only checks on that exact recovered connection found KAG already
current/matching at e3567be1505ccda9aad1cf3ea8ff43eefcb74af4, revision rev:7.
No explicit refresh was needed. A sourceFiles/design-record query with those real
pins returned all five question records, including the three selected view labels.
Canonical source readback confirmed the corresponding multiple-choice values.
This verifies the newer saved facts in the local index; it does not imply native
agent consumption of this particular KAG query or enable GRA.

An isolated Chrome 9222 context using the installed WorkBuddy sandbox HTML and
its actual CSP headers allowed the loopback bridge, with no policy violation.
Host initialization/open-link were test replies, not a new native host acceptance.
This check does not reproduce or explain the original intermittent failure.

Version 0.3.5 reports WB_BRIDGE_NETWORK, WB_BRIDGE_TIMEOUT, WB_BRIDGE_POLICY or
WB_BRIDGE_RESPONSE instead of a bare fetch error. A policy classification requires
an observed connect-src violation for this exact bridge origin. Network failure
does not assert that the service is offline or that a timeout caused the failure.
The widget offers explicit reconnect, then reopening the same project if needed;
saved files remain intact. No automatic handshake or message retry was added,
and explicit reconnect retains the widget identity and existing no-replay rules.
Seventeen focused relay/package/panel tests passed, including timeout, policy,
invalid-response, explicit reconnect and absence of open-link/message requests
after a failed handshake. An additional browser fault-injection attempt timed out
in CDP Runtime.evaluate, so it provides no rendered-failure acceptance evidence.
Shared compiled runtime and embedding/model assets are unchanged from 0.3.4;
the stable marketplace update only changes the small versioned suite. Installed
0.3.5 behavior and the first-click root cause remain unverified.

### 0.3.6 host-worker restart recovery

The user normally restarted WorkBuddy and loaded installed suite 0.3.5. A new
connection was created at 2026-10-07T17:04:56Z. At 17:05:31Z the native session
log explicitly recorded `runtime refresh requires worker restart`, changes to
TENCENT_DOCS_LOCAL_MCP/TENCENT_DOCS_LOCAL_SERVER/editor_sdk_port, then killWorker
and runtime-refreshed. Less than two minutes after startup, an independent Windows
request to the exact panel port returned ECONNREFUSED, no panel-service process
remained, and its connection file was still present. This is evidence of host
runtime recycling invalidating a connection, not the normal 15-minute idle close.
It does not retroactively prove the cause of the earlier 0.3.4 first-click failure.

The versioned connect-v2 resource retains original project/session startup inputs
only in host-provided metadata. After a network failure, an explicit user click
on the reopen button calls the existing yugoo_workbuddy_open_panel through the
standard MCP App tools/call route. It validates the returned project, session and
startup inputs before accepting the new connection, opening its page and updating
the model's routing context. The routing update grants no design-task authority;
if unavailable, the widget directs subsequent requests through the new Companion,
whose existing notices carry the exact connection. No project creation, Bundle
execution, saved-file rewrite or old-message replay occurs in this recovery flow.

A timeout or unconfirmed startup binding disables further startup attempts until
the user checks the original conversation. Policy failures do not trigger service
recreation. This does not evade the host's process lifecycle or keep services alive
across host shutdown. It provides explicit recovery within the original host
conversation rather than a separate host launcher or model client.

Eighteen focused source-level panel/package/relay tests passed; the panel/package
subset was rerun after the final context-routing and resource-version changes.
Tests cover an offline old service, same-project recovery, mismatched project,
permission rejection, uncertain startup and no automatic retry/replay. Real
WorkBuddy MCP App recovery and successful restart round-trip still require
installed 0.3.6 acceptance. The compiled 0.3.4 runtime and model assets are reused.


### Installed 0.3.6 recovery failure

The fresh 5b996 connection served HTTP 200 and returned the correct project/session
and current/matching Knowledge rev:7. After the host was subsequently reopened,
the historical widget was restored from a snapshot while both loopback listeners
were unavailable. At 2026-10-08T02:20:46Z the user's explicit recovery click reached
`rpc.callTool` and `proxyAppToolCall.start`. The native session connected, but
`_codebuddy.ai/mcpUiCallTool` failed after 30006 ms at 02:21:21Z, followed by
`killWorker` and an opaque `[object Object]` RPC error. These observations do not
establish whether the underlying panel tool started before host cancellation.
The widget recovery path has therefore failed this installed acceptance; do not
advertise it as verified restart recovery. The previously demonstrated fallback
is an explicit request in the original conversation to reopen the existing project
once, check the result, and use its new widget/connection without rerunning a Bundle.
Source error rendering now substitutes actionable text for opaque RPC objects;
this is an error-reporting correction, not a fix for the native RPC timeout.


### Missing-resource startup diagnosis and scoped repair

A subsequent native conversation tool call returned `WorkBuddy Panel exited
before startup`. Direct Windows import succeeded. A bounded diagnostic using the
same startup implementation, with process-exit callbacks disabled, exposed ENOENT
for the runtime's `web` directory. The v034 runtime also lacked its Kit, Knowledge
and dependency junctions; the original resource directories remained present.
The cause of the missing junctions is not established. This is a separate concrete
failure from the earlier MCP App RPC timeout.

The owned test runtime's links were restored to its existing v030 UI/Kit, v033
Knowledge and native dependency closure. Native pnpm 11.7.0 restored the latter's
missing dependency links with the existing frozen lockfile, offline, no lifecycle
scripts and zero downloads. No installed plugin cache or host profile was changed.
A bounded Windows startup then returned ready for the original project; the owned
server and its connection file were cleaned up. This is runtime startup proof,
not a new installed-widget/input acceptance.

Startup cleanup previously called onStopped before the service could return its
failure over IPC. The source now invokes that callback only after successful
startup. A missing-web regression verifies the original ENOENT survives cleanup
without triggering the normal service shutdown callback. This source correction
is not yet rebuilt into the installed runtime. The restored test layout is not a
production installer: final distribution must validate its complete resource and
native-dependency closure before reporting ready.


### 0.3.7 recovery through original-session user input

A second installed failure on 2026-10-08 confirmed the same boundary: at
06:24:47Z WorkBuddy logged an environment-triggered worker restart; at 06:25:32Z
its `_codebuddy.ai/mcpUiCallTool` recovery RPC timed out after 30 seconds. The
new connection file existed, but its port refused connections and no panel
service remained. Independent Windows fork/start checks on an isolated clone
succeeded, which does not establish host-owned process lifetime.

The connect-v3 widget retains the original identity metadata. On a failed local
connection, one explicit user click now uses `ui/message`, the same supported
original-session input route already exercised by the composer. The request tells
the native agent to verify identity, reopen the existing project once, return a
new widget and stop. It authorizes no Bundle, project creation, design edit or
message replay. An accepted message is not a successful Panel startup; the user
checks the native reply and clicks its new widget. Ambiguous delivery disables
further sends. Explicit rejection is reported separately. Security-policy errors
do not enter the recovery-message path.

This version supersedes the 0.3.6 direct widget tool-call recovery design; it does
not prevent WorkBuddy from recycling its worker. Unit/package checks and isolated
Windows startup checks are separate from the pending installed 0.3.7 recovery
round-trip. Historical widgets retain their old snapshots: updating the plugin
does not modify those already-rendered controls.

Thirteen focused panel/package tests passed for 0.3.7, including accepted,
rejected and uncertain recovery messages, no direct tool call, and no replay.
The actual installed widget/agent recovery remains to be verified with the user.


### 0.3.8 publication recovery candidate

This candidate includes the shared raw Git blob, committed receipt and exact
finish replay fixes from the reviewed publication source. Commit success remains
visible when index maintenance or a subsequent Journal/diff step is pending.
An exact retry reconciles the original publication rather than regenerating the
Bundle or changing Git configuration. The existing MCP App transport, serial
native Producer route and previously delivered browser UI are retained.

Compilation and isolated Windows publication checks are separate from the pending
installed WorkBuddy timing run. Do not claim that the 23-minute run is fixed until
a real successor run is measured. Workers and detached GRA remain unavailable.

### 0.3.8 installed publication acceptance, 2026-10-10

The user loaded the installed 0.3.8 Skill and reused project
`3c55ece8-b67e-403b-8d8a-8715625682ca`. Its 14 declared suite files matched the
prepared market source. Native Agent `agent-fdad500e48464e7e` bootstrapped,
registered and resumed in the original parent conversation. One `design_finish_run`
returned `accepted: true`, no diagnostics, and commit
`6df40ccbca0c3edd327844a99fddc29afb3f7381`. The existing index lock remained;
`indexMaintenance.state: deferred` did not reject the committed publication.
Read-only Git checks found a clean worktree, no changed paths in this commit,
and the same 8,233 raw Git blob bytes as the previous function map. No new Git
configuration change or lock removal was performed. This real run did not
exercise CRLF conversion: the project still had the previous `core.autocrlf=false`.
That boundary remains covered by the separately reported Windows Git checks.

Native event timestamps measured 199.818 seconds for this Producer's resumed
invocation and 13 tool calls, versus 1,387.563 seconds and 60 calls in the previous
run. The previous first finish occurred after 234.269 seconds; 1,084.451 additional
seconds elapsed from that failed response to the final accepted finish during
runtime diagnosis and retries. The new run accepted its first finish. This
confirms removal of that publication failure path, not equivalent generation
throughput: the new task checked and retained an existing design while the old
one created it, and the user reported a busy computer. Tool event intervals
still include substantial host-side waiting; they do not isolate MCP service time.
KAG was due at the start and was not refreshed or queried as current knowledge.

The failed `a72ba6b506e5e3ffd80295af` connection was replaced only by
`4e8995e3e33507dafd688a90`, already returned by the same conversation's explicit
reopen. No global or latest-connection search was used. This does not validate
the widget's historical recovery button or promise every stale connection recovers.

### Persistent preview deployment

After the successful run, the user cleaned temporary files. At about 18:29 local
time, the owned Temp runtime lost its entry and Kit assets, and the Temp market
manifest disappeared. The installed 0.3.8 suite's 14 files remained intact;
an installed suite alone is not its external runtime closure. Do not repair this
by editing WorkBuddy's cache or repeatedly restoring a runtime under Temp.

The 0.3.9 candidate keeps the same fixed runtime bytes and prepares versioned
runtime, Node/dependency inputs and the existing test market under
`%LOCALAPPDATA%/YuGoo/WorkBuddyPreview`. It is still a bounded development
preview, not an npm installer. Repoint the existing market source once through
WorkBuddy's own plugin management and update the suite normally. Later updates
reuse that persistent market source. User profiles, authentication, existing
projects and host launch registration are outside this staging operation.
Installed 0.3.9 loading, save/input consumption and reopening must be reported
separately from preparation and packaged startup checks.

The user subsequently loaded the real 0.3.9 Skill, reopened the same project
once and confirmed an original-session reply to Companion input. Read-only
registry/cache checks matched the suite's 14 files. That verifies loading,
reopening and input consumption; a new durable save and KAG-current run remain
separate from this check.

### Recorded conversation refresh

The user reported that WorkBuddy had already displayed a message while the
Companion history waited for a later Agent action. Read-only measurements of
the installed service found full workspace reads taking about 1.8–2.8 seconds,
even when their conditional response contained no changed workspace. History
was assembled only after project, native-run, review and knowledge projections.
Those measurements establish a concrete dependency delay; they do not measure
when WorkBuddy itself persists each displayed message to its native JSONL.

The shared Companion now polls recorded conversation independently, using the
same exact-session observer, durable activation boundary, token/Origin guards
and verified foreground/review partition. Read-only review presentation does
not wait for mutation locks. Panel reads no longer include duplicate history;
legacy tool reads retain the full response. Sending still uses the same MCP App
bridge and does not create an optimistic user-message record or retry delivery.
This shared change also applies to QwenWork and CLI-host Companion presentation;
it does not replace their individual input adapters.

Source regressions and a normally built browser verified that native-format
user and assistant records appear while workspace reads remain blocked, without
any subsequent Agent action. In one isolated WorkBuddy-format check, they
appeared about 0.64 and 0.74 seconds after the fixture record was written. These
are bounded fixture timings, not a desktop-host latency guarantee.

On 2026-10-10 the user performed marketplace-level Refresh and installed
0.3.10. Read-only verification matched the installed registry and all 14 suite
files to the delivered source. The exact original-session log reported a Skill
path containing 0.3.10 and recorded the user test message and assistant's
`WORKBUDDY_HISTORY_OK` reply. The user then reported that delay had improved.
This establishes installation, native input/reply and qualitative history
improvement for this test. Native-log event timestamps include model and host
work; they do not measure the browser's display delay. Delayed host log
persistence, if observed, remains a distinct cause. A new durable-save or
KAG-current run was not part of this performance check.

### Active Panel lifetime correction (0.3.11 candidate)

The user's follow-up native save, current-checkpoint KAG query and browser reply
display passed on 0.3.10. Its original service later stopped: the exact connection
file was gone and both ports from its native startup receipt refused connections,
while WorkBuddy remained running. The service had started at 14:55:31 UTC and
was unavailable by 15:46 UTC, below the four-hour cap. An idle shutdown fits that
interval, but the old service wrote no exit reason; do not claim a proven trigger.

The old lifecycle counted only native widget pulses. Consequently an active
browser could be closed after fifteen minutes without that widget, even while
the user was reading or editing the Panel. The 0.3.11 candidate counts both
widget pulses and authenticated Companion API activity before idle cleanup.
Static or unauthorized requests do not extend it. This keeps the active Panel
available while its authenticated polling continues, including background-tab
polling; service activity does not prove that a person is currently editing.
It does not claim that a missing widget can send messages: native
bridge freshness, ownership, uncertain-delivery and no-retry guards stay intact.
The four-hour service cap and cleanup when both surfaces are idle remain.

Normal closure writes a bounded, credential-free `<connection>.closed.json`
diagnostic in the existing connection directory before revoking the live file.
It records only exact project/session, times and idle/maximum/explicit reason;
it grants no routing or execution authority. Diagnostic-write failure does not
prevent cleanup, and forced OS termination cannot promise this receipt.
This source correction is not yet installed-host lifetime acceptance.

The 0.3.11 source passed 25 related service regressions and 5 package checks.
Independent review found no new blocker. Its normally built Windows service
also passed isolated activity/idle, absent-widget send rejection, credential-free
closure receipt and four-hour-cap checks using an accelerated process-local
clock. This verifies the compiled Windows boundary, not fifteen minutes elapsed
in the real WorkBuddy session.

Update the existing test marketplace through marketplace-level Refresh, then
update the same suite. Verify the loaded Skill path includes 0.3.11 and ask the
original conversation to reopen the existing project once. Use its new exact
connection; the stopped 0.3.10 connection cannot be recovered by browser refresh.
No new project, Bundle execution or host launcher is needed for this check.

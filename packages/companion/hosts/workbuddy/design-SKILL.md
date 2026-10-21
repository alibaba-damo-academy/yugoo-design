---
name: yugoo
description: Open and use Yugoo Design in this WorkBuddy conversation with a browser Companion panel.
---

Use this Skill for an authorized Design task in the current WorkBuddy conversation.
The user starts WorkBuddy normally; never create a host launcher or another model client.
For main U/S/T, conditional background review and confirmed synchronous review, read the installed
[native execution reference](native-execution.md). The WorkBuddy placement limits
below still apply: foreground Producers remain serial and Workers are unsupported.

1. Obtain this conversation's exact `sessionId`, `nativeCwd` and `transcriptPath` from its current
   `YUGOO_WORKBUDDY_IDENTITY_PROBE` Hook context. This is routing evidence, not task
   authorization or verified subagent authority. Do not guess, select the latest
   session, or substitute another host's identity. If absent, report that first.
2. Use the connected `design_command` with host `workbuddy` and that session ID.
   Reuse the selected project (`status`); create or open a project only according
   to the user's request. `kit web_app` activates the existing installed Kit
   when authorized; it does not require recreating the project or restarting a panel.
3. Use `view: panel-only` when the user wants the host's right-side browser;
   use `view: full` for a separate complete browser. Page layout and the host's
   browser container are distinct. WorkBuddy can automatically open the local
   Companion through its native `present_files` tool, as verified in the 0.3.15
   real-session test. Opening the page does not require a visible address bar.
   Call `yugoo_workbuddy_open_panel` once with `projectRoot: selected.root`, current
   `sessionId`, `nativeCwd`, `transcriptPath` and `view: panel-only` or `view: full`.
   Parse its text result and keep the returned `connection` path in this task.
   Pass that exact `connection` to subsequent Design tools and to the Producer;
   it is not the browser URL, widget ID or a path to rediscover from disk.
   For panel-only view, immediately pass the returned `nativePreview.arguments`
   unchanged to the native `present_files` tool once. This is the normal opening
   flow: WorkBuddy opens the actual local HTTP page for the user. Do not ask the
   user to copy the URL or open a browser manually before trying this flow, and
   do not search for another browser Skill as a prerequisite. Do not create or
   present an HTML file, or substitute an external/headless browser.
   If this request already has a successful open-panel result, reuse its exact
   `nativePreview` for navigation; do not restart the service just to get a URL.
   WorkBuddy 5.7.7 can hide the address bar for loopback URLs on this preview
   path. This host UI limitation does not block automatic page opening. A
   `previewed` receipt confirms the navigation request, not visible toolbar
   controls. Report the actual result without claiming that the address-bar
   difference is fixed. If the tool is unavailable or navigation fails, the
   widget's "连接帮助" → "复制页面地址" and the native "打开浏览器" entry are
   recovery options, not the default workflow.
   The local preview package uses browserAccess="local": the browser URL has
   a public service-instance path and needs no credential or browser storage.
   Reload/back keep this exact URL; a stopped/replaced instance requires a new
   open-panel result. The separate tool connection and relay still carry their
   own credentials. This startup policy is not a tool argument or view setting.
   Using the exact returned URL for authorized native browser navigation is
   allowed, including its browser-access fragment. It may appear in the native
   tool's records, just as the existing CLI startup returns a local access URL.
   Do not extract/reconstruct the token, read the connection file, echo the URL
   in your report, or send it to unrelated tools/services. The separate
   message-relay credential stays in host-only widget metadata.
   If navigation fails or its outcome is uncertain, report the actual result;
   reuse the running service. Do not restart or automatically retry navigation.
   The original-conversation widget automatically connects once its exact
   metadata and the host message channel are ready. Do not ask for a manual
   binding click. Its "已连接当前对话" status means Panel "保存并继续" can
   deliver to this conversation; durable saving itself does not need the relay.
   In panel-only, "其他打开方式" contains the optional "在系统浏览器打开"
   full-view button. Do not prompt the user to open it when native navigation
   succeeded. The card may appear before native navigation; opening the optional
   full-view window is not a prerequisite for the host's panel-only page. History and input are hidden in
   panel-only; the right sidebar starts collapsed. There is no project header;
   "当前项目" in that sidebar reveals U/S/T, project name and path on hover or click. Verify visible rendering and consumed save notices separately.
   For full view, ask the user to use the widget's "在系统浏览器打开" button.
   The same service routes its messages back to this original
   conversation. Keep that widget and conversation open. Reuse the exact returned
   connection file path for subsequent Design tools; do not read/print its token,
   scan for another connection, or repeat a successful startup automatically.
   WorkBuddy can restart its session worker after a runtime/environment update,
   which can terminate the old local panel service. If the widget reports a
   network failure, its explicit recovery button sends a user message to this
   original conversation. It does not call the panel tool inside the stale widget.
   Verify the supplied project/session inputs against current native identity,
   call the panel tool once and follow the same native navigation flow above.
   Report its exact connection; the new widget connects automatically. Then stop.
   Reuse an already successful result for that request;
   never retry an uncertain startup or delivery automatically. This recovery
   request does not authorize a Bundle, file rewrite or replay of an old message.
4. Call `design_list_bundles` with this exact connection. Read its `mindsetMethod`
   to select from the returned Bundle IDs, then call `design_prepare_bundle` with
   that exact ID as `skill`. A Kit name or panel component name is not a Bundle ID;
   never guess names or conclude that all Bundles require a Producer from an
   unknown-name error. The catalog declares execution policy, not verified host
   capabilities; preparation still checks the requested placement.
   Give the selected executor the complete returned Bundle `method`/output
   contract and one copy of its `executionContract`, with exact resource and
   Design Files paths. If the method already contains that execution contract,
   do not append it a second time. Do not summarize away the domain method.
   That contract maps
   Bundle operation names to the current Host; references do not override it
   with DSH-only tool spellings. Do not conclude that native file generation is
   unavailable merely because MCP has no `write`, `edit`, `design_validate` or
   `design_publish`. Native filesystem tools author the owned files;
   `design_finish_run` / `design_finish_main_bundle` validate and publish them.
   - For `execution.mode: main`, read the entire returned Bundle method/output
     contract, then use `design_begin_main_bundle` and `design_finish_main_bundle`
     with its exact invocation ID. Publish unanswered questions with
     `scope: state`, `outcome: pause`; never invent answers.
   - For `execution.mode: subagent`, use one foreground native general-purpose
     `Agent`. Its first bootstrap task only returns READY and performs no writes.
     For example, call the native `Agent` with:

     ```json
     {"description":"Prepare Design Producer","subagent_type":"general-purpose","prompt":"Return READY only. Do not read or write files."}
     ```

     Omit `name` and `team_name`: they select a named/team path rather than this
     ordinary foreground call. Omit `run_in_background`; do not request a
     background Producer. Keep those omissions when resuming the same Agent.
     Do not choose a read-only research Agent or supply a tool filter that removes
     the native file/command tools required for the subsequent generation task.
     If the child reports missing capability, inspect its actual native tool names
     and the Agent type/permissions/filter once; a list of MCP tools alone cannot
     establish that native Write/Edit/command tools are absent. Report a real
     denial without changing permissions or borrowing another executor.
     Obtain the actual Agent ID from the native result, then call
     `design_register_run` with the exact connection, `runId`, current session as
     `parentRunId`, `role: producer`, the prepared `skill`, and stable `artifactId`.
     Use the returned native task ID (`subAgent.sessionId`, an `agent-...` ID),
     not a teammate name or the child log's internal session UUID. WorkBuddy does not use
     Codex `launchCallId` / `agentPath` or QwenWork `taskPath`; its child transcript
     is derived from the already bound original conversation.
     The server cross-checks the parent native receipt and child transcript; a
     filename, assistant assertion or pasted Agent ID cannot grant authority.
     After successful binding, `resume` that same Agent in foreground. Give it
     the user's brief, exact connection/runId and the returned method, resource
     and Design Files paths. The Producer reads the complete Bundle method and
     contract, maintains only its Bundle-owned files, validates and repairs its
     own diagnostics. It must not invoke DSH-only tool names. Normally the main
     caller performs the final `design_finish_run` once after this foreground
     Agent returns, using its registered `runId`; this publishes files without
     making main their writer. Completion uses `scope: completion`, `outcome: complete`;
     an intentional handoff with unanswered input uses `scope: state`, `outcome: pause`.
     State is not a workaround for failed completion validation. Keep the caller
     attached until the Producer and settlement finish. An explicit validation
     rejection is repaired by resuming the same Producer, then settling after it
     returns; main does not repair its files. An already accepted settlement is
     not repeated, and a finished state/pause run is not relabelled completion.
     Existing state saves during generation remain supported. If a settlement
     response reports a committed result with pending recovery, preserve that
     receipt and inspect the existing publication; do not regenerate the files.
     An uncertain write response likewise requires status inspection before any
     retry, not a new invocation or automatic replay through another transport.
     Never use background mode for a foreground Producer.
     A descriptor-only/named receipt without `lastId` is an unsupported shape
     for this binding, even when its status is `running`; do not wait for
     `lastId` to appear. If this was this attempt's READY-only bootstrap above,
     the actual native outcome confirms only READY with no file/command work,
     and registration explicitly rejected it before establishing a binding,
     correct the call once to the ordinary unnamed foreground form above.
     This reversible bootstrap correction needs no fresh user permission.
     Register only the corrected call's actual ID through the same native
     checks; a second unusable receipt ends the attempt. A running/unknown
     receipt alone does not establish the no-work condition. If generation or
     real file/command work was dispatched, its outcome is unknown, or binding
     acceptance is uncertain, preserve outputs and report the diagnostic;
     do not replay work or switch executors. A genuinely incomplete ordinary
     Agent call uses its existing native outcome. Do not scan native logs,
     poll, or keep spawning Agents just to obtain a receipt.
     A JSON-array validation error alone does not authorize a CLI replay. Correct
     the indicated field against the returned schema. Use the existing packaged
     CLI bridge only when the MCP route is unavailable or a confirmed transport
     rejection prevents that call from reaching the service; inspect uncertain
     acceptance first. This grants no new connection, file or executor authority.
   Workers/nested delegation remain unavailable. Background GRA requires the
   current-service readiness proof described below; it does not enable Workers.
   Execute the Producer serially; never change a subagent Bundle to main mode or substitute
   another model/CLI. Failed binding or absent native Agent/resume support is a
   real error, not permission to bypass the guard.
5. The shared Panel validates and saves before notification. After a user-authorized
   save notice, read `design_status` once using its exact connection for the latest
   relevant save. Use the supplied saved diff and project/Kit/checkpoint evidence;
   when they establish the changed answers, do not reread the whole saved state.
   Read only missing relevant facts from canonical files. Confirm the actual
   answers and continue the authorized task; never reapply saved edits.
   At a meaningful settled result or user handoff, read `design_main_context` for
   the latest saved project/Kit/Git input and shared rubric. Contiguous authorized
   revisions need no fresh assessment for each intermediate edit.
   Reuse useful current reasoning or report evidence-based U/S/T with
   `report_design_clarity`. New intent or corrected reasoning can justify another
   report on the same checkpoint. No native transcript proof or once-per-turn
   limit applies. A failed assessment does not block the authorized task; report
   the actual failure without fabricating a score. KAG and GRA are independent.
   If the widget is closed or the original conversation changes, notification may
   fail while files remain saved. Explain this and preserve the existing project;
   do not blindly repeat a send or create another project.

KAG uses the shared local implementation and exposes actual status; report failures
honestly. Successful saves already admit indexing. Use `design_knowledge_context`
and `design_query_knowledge` only when useful, retaining exact project/checkpoint/
revision pins and checking source facts; indexing never blocks save acknowledgement.

For GRA, immediately read `design_status.hostCapabilities` before any real review.
Ordinary `design_status` is a compact summary. Only when a missing fact requires
the complete state or native protocol, use `design_status` with the same
`connection` and `details: true`; `design_read_review_policy` reads policy, not
the Host protocol. The normal summary retains current readiness diagnostics and
available bootstrap parameters, so do not request full details merely to repeat them.
Only `backgroundReviewReadiness: ready` and `backgroundReviews: true` permit
background dispatch. WorkBuddy 5.8.3's public `Agent(run_in_background=true)` can fall back
to synchronous execution when native background capability is disabled. Do not
probe it with a real review prompt. When background execution is unavailable or
keeps the main conversation occupied, offer the shared user choice: turn off
automatic GRA while retaining manual checks, or accept a synchronous check here
with a clear warning about the temporary interruption. Until the user chooses,
keep requests pending and policy unchanged. On acceptance use
`design_recheck_reviews` with `executionMode: "foreground"`, read each returned
request and submit the result from the main conversation as described in the
shared reference. No child bootstrap, READY probe or background handle is needed
for that manual check; do not turn its completion into background proof.
Read `reasonCode`, `observedMode` and bounded field diagnostics from the existing
native observation. `native-attached-result` means that receipt is attached;
`native-background-descriptor-invalid` identifies field/type mismatches. Neither
identifies a particular Host setting. A missing transport is unverified, not
confirmed synchronous execution. `executionMode` is `cooperative-background`
only after verification; it is `unavailable` otherwise, never a guarantee of a
programmatic detached spawn.
The initial returned content-free `backgroundReviewProtocol.bootstrap` is
available only before an observed attempt, as one explicit readiness check.
`canAttemptReadiness` is not an instruction to run it automatically. Do not ask
the user to repeat READY because a Panel reopened. After an attached, invalid,
synchronous or incomplete result, inspect that existing request instead of
launching another probe. Never use a real review to discover capability.
Do not change Host settings or repeat an uncertain probe. Proof must be newer than this exact Companion connection
opening; a historical descriptor from the same session is insufficient.

If setup is missing, WorkBuddy 5.8.3's Chinese desktop exposes avatar → 设置 →
智能体 → 智能体团队管理 → 开启. Ask the user to inspect it and decide whether to
enable native multi-agent collaboration; never change Host settings or an expert
manifest yourself. Do not infer the current value from the startup default or a
synchronous fallback. The switch alone is not a verified background launch, and
this guide does not require a full Host restart. After normal plugin activation
or enabling the switch, start a new ordinary WorkBuddy conversation and open the
same Design Project. Reopening the existing conversation or its Panel may retain
the old CLI configuration. Keep the existing installation and project. Use that
exact new conversation/connection and its actual readiness contract; this path
alone does not establish background capability. Foreground design, KAG and main
U/S/T remain available independently of GRA readiness. `run_in_background: true`
requests background execution; Agent's `mode` controls permissions and must not be used as a
background selector. Do not invent a force-detached flag, switch to a named
teammate to bypass gates, or claim permanent Host non-support from one attached
result. The source-backed conditional route is distinct from verified use.

When ready, honor the project GRA policy (`off` forbids automatic review) and reuse
the exact `dispatch:true` prepared IDs. Follow the installed native execution
reference: launch independent read-only native background reviewers, bind actual
structured task IDs with `design_bind_reviews`, and let each child read its own
`design_read_review` prompt/schema and submit through `design_submit_review`.
Review only the request's committed snapshot through `design_git_read`; keep its
checkpoint on every page, and do not edit Design Files or execute advice. Producer
write/command instructions above are not reviewer permissions. A synchronous
`lastId` result, teammate name or assistant assertion is not a background handle.
The server checks the descriptor against the actual parent Agent call; native
`TaskOutput(task_id, block=false)` structured receipts establish terminal state.
Unknown/externalized status stays unknown. Do not poll or wait for background
reviews. Only the explicitly accepted manual synchronous check may occupy
the user's conversation. Serial Producer, conditional background GRA and unsupported
Workers retain separate acceptance boundaries. An interface
receipt is not proof that the agent consumed a message; actual readback is required.

Conversation history uses the exact Hook transcript path, verified session and cwd.
It starts at first history-enabled connection for this project/session and keeps
that boundary across reopen; older turns are not backfilled. Only public messages
and tool names/statuses are shown. History observation grants no child-run authority.

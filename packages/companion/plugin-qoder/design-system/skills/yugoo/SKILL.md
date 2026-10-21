---
name: yugoo
description: Create, open and operate an interactive Design Project in Qoder CLI, including /yugoo-design:yugoo project commands and design work in the browser Panel.
---

# Design System in Qoder CLI

Qoder owns the conversation, native agents, permissions and question tools. This
plugin adds the existing Design Files, Kit, Panels and validation/Git workflow;
it does not start a second model. Read `native-execution.md` before Bundle work.

## Project entry

Use the SessionStart hook's exact `sessionId`, `nativeCwd`, `transcriptPath`.
If that context is absent, ask the user to restart/reload the installed plugin;
do not scan all session history or choose a latest session.
Resolve the plugin root relative to this skill (`../..`). Execute its packaged
script, not an arbitrary globally installed development copy:

```sh
node /absolute/plugin-root/scripts/design.mjs command --host qoder --thread SESSION_UUID --input 'new Project Name'
```

Pass the actual user command as `--input`: `help`, `new NAME`, `list`, `open PATH`,
`status`, `kit web_app`, `close`, `delete`, `recover PATH`, `reconstruct PATH`.
Reuse the selected project's returned exact path. A new project has no Kit:
select the relevant available Kit from the user's intent, or ask if ambiguous.
Creating a named project alone is not a product brief; having only one available
Kit is not a reason to activate it before the user gives a matching design intent.
Recovery/reconstruction results are instructions to perform the task, not proof
that migration/reconstruction has already completed.

## Open the Panel

Once a project is selected, run this long-lived local server with native background
shell support. Keep the process handle and exact connection file in this task:

```sh
node /absolute/plugin-root/scripts/design.mjs serve --host qoder --project /exact/project --thread SESSION_UUID --host-cwd /exact/native/cwd --transcript /exact/main.jsonl
```

Open the Panel even before a Kit is chosen: unconfigured projects are read-only,
and unavailable/incompatible pins use read-only recovery. Do not choose a Kit
merely to display the workspace. Compatible mindset activation refreshes the
same Panel to writable access; it does not require restarting the server.

Notifications use the plugin's native `FileChanged` + `asyncRewake` Hook,
verified with Qoder CLI 1.1.48. No cross-session feature flag is required.
The server probes the exact session's Hook before reporting a connected Panel.
If the Hook is unavailable, reload the updated plugin and reopen the Panel;
do not launch a replacement model or claim notification support is working.
The initial cwd's `.design-system-qoder-notify` is only a transient wake-up signal;
message contents live in private local state, not Design Files. Native cwd changes
are supported: the CwdChanged Hook retains that exact file's watch path. Do not
move or recreate the signal elsewhere. Restarting Qoder requires reopening the Panel.

Show the returned local URL. Reuse the same live companion; after project switch
stop only the companion process owned by this task and open a new one. Never kill
Qoder or another session's server. MCP tools take the exact `connection` file;
never disclose its token or search for a latest connection.

## Native execution specifics

Before choosing a Bundle, read `/absolute/plugin-root/kits/web_app/mindset.md`:
it already contains the Bundle catalog and selection method. Do not discover
capabilities by searching the empty Design Files or scanning the plugin tree.
Examples in `native-execution.md` are not a default choice of `page_design`.
Once selected, use `design_prepare_bundle`. Follow its `execution.mode`: `main`
runs the Bundle here using `design_begin_main_bundle`/`design_finish_main_bundle`;
`subagent` (the default) passes its exact resource paths,
the user task and project context to a native Producer. Let the executor read the Bundle method;
do not rewrite the entire method or invent validation arguments in its assignment.
The packaged validator accepts `--scope state` for a pause, and `--scope completion`
for completed output. There is no `--scope pause`. `design_finish_run` uses the same
state/completion distinction. Keep inferred requirements separate from user facts.

Use Qoder's actual `Agent`/`Task` tool, including `run_in_background` only when
the current tool supports it. Child `agentId` is **not** the main session UUID.
Each run/review binding requires its native `taskPath` in addition to `runId`,
`parentRunId` and `transcriptPath`. Use the exact task descriptor created by that
spawn (it records `agentId`, `sessionId`, `parentToolUseId`, `transcriptPath`).
If necessary locate that **specific agent ID** only in the bound session's
`<main-session-id>/subagents/task-*.json`; do not read unrelated sessions.
Register once the metadata exists; never spawn a duplicate merely to get a path.
Producer parent is the main UUID. Worker parent is its actual Producer agent ID,
or the main UUID for main execution; in that case also supply the exact Bundle
`invocationId` returned by `design_begin_main_bundle`. Worker fanout is independent
of the Bundle execution mode. Main execution creates no Producer rolling log.
Reviewer parent is the main UUID. Native task and parent dispatch are verified.
Subagents may work from a different cwd; that does not change their native identity
or permit them to change their bound Design Project.

Native agents read/write the same `design_files` directory; do not use isolated
worktrees for artifact generation. Workers write separate files, Producer owns
canonical JSON and updates each finished artifact reference promptly. Preserve
the Bundle's schema and scripts; use file arguments instead of copying large
HTML/XML through tool inputs. Native completion drives status, files drive content.

GRA follows the shared reference and current `design_status.hostCapabilities`,
`reviewDispatchOwner` and `reviewPolicy`. Only permitted native batches launch
entries with `dispatch: true`; never duplicate a Companion-owned dispatch,
block foreground work automatically or auto-accept suggestions. If background
execution is unavailable, offer the shared choice: disable automatic GRA while
retaining manual checks, or run this check synchronously here after warning that
it temporarily occupies this conversation. Use the confirmed manual
`executionMode: "foreground"` path; do not fabricate a background binding.
Main U/S/T uses
`design_main_context` and `report_design_clarity` independently of background
review availability. If background agents
or nested delegation are unavailable, state the limitation; do not emulate them
by invoking another CLI/model. Ask user decisions through native questions when
available, otherwise one concise conversational question.
Bind failed reviewers too so their actual failure is visible. Qoder's generic
“Sorry, as an AI coding assistant” can be a synthetic API-error message, not a
model refusal: do not infer task unsuitability or retry with reworded instructions.
If native error evidence reports `tpm_limit_exceeded`, report service rate limiting;
do not launch replacement reviewers automatically or alter the account/model.

Browser messages arrive through native Hook reminders, not permission approvals.
`hook_received` confirms Hook reception, not model execution. `unknown` does not
prove non-delivery. Do not automatically resend or treat retained save differences
as proof that the earlier message was not executed.

## Develop from the selected Design Project

Every supported project command is also callable by the main Agent from clear
natural-language intent; do not require the user to spell a slash command.
Use MCP `design_command` with the exact host/main identity when available,
otherwise the packaged `command --input` entry above. Map the intent to the
existing action and clarify only an ambiguous action or required target.
For “assemble the design into a development spec”, use `compose_spec [brief]`
(MCP action `compose_spec`, optional literal `argument`). Follow the returned
`conversationPrompt` to write/check the specs in the authorized coding workspace;
the prepared-task receipt is not completion. Preserve existing Spec conventions,
read Design Files/artifacts without modifying them, and do not begin coding
unless the user also authorized implementation. This action needs no Panel
restart and no additional model or Bundle invocation.

When the user requests a development brief or implementation using this project,
read [development handoff and existing specs](native-execution.md#development-handoff-and-existing-specs).
This is a task-scoped use of saved design, not another Bundle invocation; retain
the target coding workspace's existing spec convention and authorization.

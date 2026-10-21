---
name: yugoo
description: Create, open and operate interactive Design Projects in Claude Code through /yugoo-design:yugoo and the browser Design Panel.
---

# Design System in Claude Code

Claude Code owns the conversation, agents and permissions. This plugin reuses
the Design Files, Kit, Panels and validation/Git workflow. Before Bundle work,
read `native-execution.md`: it is the shared execution contract, not an instruction
to launch Codex. Use Claude Code's actual native tools for its host operations;
Codex-only identity options and Qoder task descriptors do not apply here.

## Project entry and Panel

Use the SessionStart hook's exact `sessionId`, `nativeCwd` and `transcriptPath`.
If identity context is missing, ask to reload the plugin or restart Claude Code;
do not search unrelated sessions or choose the latest log. Resolve the plugin
root relative to this skill (`../..`) and run only its packaged entry:

```sh
node /absolute/plugin-root/scripts/design.mjs command --host claude-code --thread SESSION_UUID --input 'new Project Name'
```

`command` is a literal subcommand. Pass the user's operation as `--input`:
`help`, `new NAME`, `list`, `open PATH`, `status`, `kit web_app`, `close`,
`delete`, `recover PATH` or `reconstruct PATH`. Reuse returned exact project paths.
A new project has no Kit. Match the user's design intent to an available
Kit; a project name alone does not justify activating the only installed Kit.
Recovery/reconstruction results describe work to do, not work already completed.

Once a project is selected, start the Panel using native background shell support:

```sh
node /absolute/plugin-root/scripts/design.mjs serve --host claude-code --project /exact/project --thread SESSION_UUID --host-cwd /exact/native/cwd --transcript /exact/main.jsonl
```

Open the Panel even before a Kit is chosen: unconfigured projects are read-only,
and unavailable/incompatible pins use read-only recovery. Do not choose a Kit
merely to display the workspace. Compatible mindset activation refreshes the
same Panel to writable access; it does not require restarting the server.

Keep the process handle and returned connection file. Show the local Panel URL,
but never disclose the connection token. MCP calls use that exact `connection`
path. After switching projects, stop only the Companion owned by this task and
open a new one; do not kill Claude Code or other sessions' servers.

Notifications use native `FileChanged` + `asyncRewake` hooks. The server probes
the bound session before reporting connectivity. Missing hook support is a setup
limitation, not permission to start another model. The initial cwd's
`.design-system-claude-notify` is a transient signal; message contents are private
local state. CwdChanged retains its watch path. Restarting Claude requires
reopening the Panel. Hook receipt confirms delivery to the hook, not execution;
an unknown result does not prove non-delivery and must not cause blind resending.

## Bundle and agent execution

Read the selected Kit's returned mindset file for its Bundle catalog and routing.
Do not discover capabilities by scanning empty Design Files. Use
`design_prepare_bundle` and follow its `execution.mode`: `main` uses
`design_begin_main_bundle` before editing and `design_finish_main_bundle` after
validation; `subagent` uses an actual native Producer. Pass returned resource
paths and bounded user/project context; let the executor read the Bundle method.

Use the actual native Agent tool, including background or nested spawning only
when exposed by the current Claude version and execution context. Register the
exact returned child `runId`, with its actual `parentRunId`. The adapter resolves
the transcript inside the bound session and verifies parent dispatch evidence.
Do not scan sessions, invent IDs, or respawn a duplicate to obtain metadata.
If metadata is still pending, finish binding the same child when available.
SubagentStart's main transcript path is not a child transcript path.

Workers use their real Producer parent, or the main parent plus its exact Bundle
`invocationId` for main-mode execution. All agents use the same Design Files, not
isolated worktrees. Workers write distinct artifacts; the Producer owns canonical
JSON and integrates finished references. If nested delegation is unavailable,
the Producer may perform the scoped artifact work itself under the shared
contract; do not fabricate a Worker or switch execution mode silently.

Validate a pause with `--scope state`, completed output with `--scope completion`.
Preserve the Bundle schema and scripts. Native terminal evidence controls activity;
files control content. Missing output directories are normal before generation.

## Reviews and user handoff

Claude's current adapter uses the shared native batch review path, not the
Companion-managed executor. Do not pass `--background-reviews`: this host has no
managed executor yet. At a settled revision, read current
`design_status.hostCapabilities`, `reviewDispatchOwner` and `reviewPolicy`, then
follow the shared reference. When capability, owner and policy permit main-Agent
dispatch, use `design_prepare_reviews` to obtain the current batch. Launch native
background reviewers and call `design_bind_reviews` only for returned entries
with `dispatch: true`. Do not duplicate a
Companion-owned dispatch or override an unavailable capability or policy. Continue the
foreground conversation without waiting or polling for GRA/clarity. A reviewer
failure is not a successful assessment and does not authorize automatic retries.
If background Agent tools are unavailable, offer the shared user choice: disable
automatic GRA while retaining manual checks, or run this check synchronously in
the main conversation after warning about the temporary interruption. Only after
acceptance use the manual `executionMode: "foreground"` path; no background
binding or managed executor is needed for that check.

Use native AskUserQuestion for meaningful next-step choices when available;
otherwise ask a concise conversational question. Browser queued messages do not
answer native permission/question prompts. Suggestions require real user
acceptance before action; never auto-accept GRA advice.

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

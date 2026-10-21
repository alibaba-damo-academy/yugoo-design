# Agent-accessible Design Project commands

The user command and Agent tool share `runDesignProjectCommand`; neither shell
inspection nor a second project registry substitutes for project selection.

## Entry points

- DSH: `/yugoo` and `design_command({action, argument?})` share
  `DesignService.executeProjectCommand`. The existing user-command continuation
  is retained; a tool invocation only returns its result and never synthesizes a
  user message. Child sessions are rejected by the service before any mutation.
- Companion hosts (Codex CLI, Claude Code CLI, Qoder CLI, QwenWork and WorkBuddy): MCP
  `design_command({host, threadId, action, argument?})` shares
  `runCompanionCommand` with `design.mjs command`. It needs no Panel connection,
  so creation and discovery work before `serve`.

Actions are `help`, `list`, `status`, `new`, `open`, `kit`, `close`, `recover`,
`reconstruct`, `delete`, and `compose_spec`. Project files remain preserved by `delete`, which
removes registry membership. Mutating commands still require user intent;
explicit authorization is required for removal. `mindset` remains a legacy alias
for `kit`; both use the same project selection and exact-pin rules.

All actions also accept natural-language intent through the main Agent: users
need not type a slash command. The Agent selects the matching `design_command`
action and literal argument, clarifying only a genuinely ambiguous target.
For example, “assemble these designs into a development spec” routes to
`compose_spec`; “show my projects” routes to `list`.

`/yugoo compose_spec [brief]` prepares the selected project's exact root, Kit
pin and published checkpoint plus execution guidance. The main Agent then
creates/updates specs in the authorized coding workspace, following its existing
Spec Kit/OpenSpec/Kiro convention (Spec Kit when none exists). It links relevant
Design Files/artifacts rather than duplicating the whole project. The command
receipt is not generated files: report completion only after the Agent actually
writes and checks them. It changes neither project selection nor Design Files,
requires no Panel restart, and does not authorize implementation.

## Session and presentation boundaries

Native selection remains isolated by exact `[host, threadId]`. The MCP caller
must use the main identity from its native host, not a guessed or latest session.
Like the existing CLI, this local MCP project-management entry accepts an
explicit identity; MCP requests themselves do not attest which native child
issued a call. Thus DSH has a service-enforced child rejection, while native CLI
child tool exposure/authorization remains a host responsibility. Do not describe
the explicit identity parameter as cryptographic caller authentication.

Selection-changing Companion results return `panelRestartRequired`. They do
not silently repoint a running project-bound server: the main Agent restarts
only its own Panel with the returned project root and the same native identity.
The old Panel must not be mistaken for the new selection. `conversationPrompt`
is continuation guidance, not evidence of new user authorization.

## Verification

- Core test: shared creation/Kit-selection path, invalid commands, child rejection,
  and no synthesized user message.
- MCP test: no connection prerequisite, the host/session cases exercised by the focused test, creation,
  Kit selection, close/reopen, missing argument errors, and session isolation.
- Packaged stdio MCP test: project commands and component discovery work without
  a Panel connection; project-bound operations retain connection validation.

These are automated adapter checks, not real-model runs in all native clients.

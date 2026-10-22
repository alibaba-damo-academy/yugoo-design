---
name: yugoo
description: Create, open and manage Design Projects, select a Design Kit, and launch interactive design Panels with native Codex agents.
---

# Design System

Resolve the plugin root two directories above this installed skill directory.
Codex invokes this entry as `$yugoo`; command arguments are the text after it.
Use the existing Core project commands rather than editing project metadata by
hand. Obtain the exact native thread identity from trusted host context; never
pick the latest session. Commands do not start a second agent or change cwd.

```sh
node /absolute/plugin-root/scripts/design.mjs command \
  --input "new My Project" --host codex --thread EXACT_THREAD_UUID
```

Supported inputs: `new <name>`, `open <id|name|absolute-path>`, `list`, `status`,
`kit <kit>`, `close`, `delete <id|name>`, `migrate <absolute-path>`,
`reconstruct <absolute-file-or-directory>`, and `help`. Pass the user's name or
path as one literal argument; do not interpolate it into executable shell text.
With no subcommand, show status/help rather than creating a project.

The result's `selected` record gives the authoritative project root and Kit pin.
Selection persists per host conversation outside Design Files.
Command results preserve Core's `/yugoo` help text verbatim; display command
examples using `commandEntry` (`$yugoo` in Codex), not by replacing substrings
inside returned paths or project names.
New projects start without a Kit: select an appropriate available Kit for the user's
design task using `kit <kit>`; if they only requested an empty project,
report the available choices. Do not silently change an existing Kit/version.
For migration, select a Kit first. Migration stages recognized Design Files
into a new target for agent validation/adaptation; it does not restore complete
project history. Never modify the source. For
reconstruction follow the returned evidence-extraction instructions, not normal
forward design generation. Do not claim migration or reconstruction finished
merely because the target project was created.

## Open the interactive workspace

Once a project is selected, even before a Kit is chosen, follow
[the Panel guide](../design-panel/SKILL.md) to inspect it and start its companion.
An unconfigured project opens read-only with no active Kit. Do not delay opening
the workspace or select a Kit just to make the Panel visible. Activating a
compatible Kit refreshes this same Panel; no server restart is needed.
Use `selected.root` as `--project`. Pass the **native conversation's actual cwd**
as `--host-cwd`, independently of the design project root, and the verified
current transcript when available. All native children retain this native cwd;
pass absolute Design Files paths in their tasks. Files remain in the selected
project, not in the CLI working directory.

When switching or closing, first finish/cancel active work with the user as
appropriate; do not leave old Producers writing while silently moving projects.
Stop only the companion process you started using its native process handle.
After a project selection change, launch the companion for the new project and
return the new URL. The old tab is not automatically retargeted. `delete` only
removes the registry entry and keeps files/history. Never recursively delete
project files to implement it.

For actual design work read [native execution](../design-panel/native-execution.md):
native Producer/Worker children, file validation/settlement and GRA execution choices.
Returned Core prompts can name DSH operations: map Kit selection to the
command above and Bundle operations to that native execution guide. Do not call
nonexistent DSH tools. Keep automatic GRA off the foreground task queue. If
background execution is unavailable, offer turning off automatic GRA while
retaining manual checks, or a user-confirmed synchronous check here. Follow the
shared manual foreground path only after warning about the temporary interruption
and receiving acceptance; it needs no fabricated background child or proof.

## Host boundary

The command backend accepts explicit `codex`, `claude-code`, or `qoder` identities
so project commands share one grammar and file model. This packaged connected
Panel entry is currently Codex-only. Claude Code/Qoder command discovery,
message delivery and native child observation need their host adapter; `$` is
not a universal command syntax. Do not launch a Codex transport in those hosts.

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
read [development handoff and existing specs](../design-panel/native-execution.md#development-handoff-and-existing-specs).
This is a task-scoped use of saved design, not another Bundle invocation; retain
the target coding workspace's existing spec convention and authorization.

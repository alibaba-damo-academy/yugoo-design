---
name: yugoo
description: Create and manage Design Projects, open interactive Panels, or customize reusable Kits and Bundles in Studio through the current native conversation.
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

## Customize Kits and Bundles in Studio

For requests to create or revise reusable Kit/Bundle methods, schemas or Panels,
use `design_studio_customize` in this native conversation. Read
[Bundle authoring](../design-bundle-creator/SKILL.md) or
[Kit authoring](../design-kit-creator/SKILL.md); when changing professional methods
or output contracts, also read [skill authoring](../design-skill-creator/SKILL.md).
For Panel composition use [the component guide](../design-component/SKILL.md)
and the actual `design_list_panel_components` contracts. The target Bundle's
own `SKILL.md` is its execution method, not its authoring guide.

Reuse the current Panel connection and its exact absolute connection-file path.
If none is available, report that Studio needs a supported Host connection;
do not invent a path or create a Design Project just to customize content.
Discover exact installed pins with
`catalog`; copy installed content or reopen the user's local working copy with
`list` and `read`. Read source with `readFile`, preserve unrelated content and
human edits, then submit complete changed files through `prepareChanges` with
the copy's exact id and revision. This returns the diff, diagnostics, preview
and `authoring.url` for the same Studio working copy. Open that returned URL in
a standalone browser tab or return it to the user. Studio owns the complete
editing workspace: its embedded conversation connects to this native Host,
while source, diff and live Panel preview remain alongside it. The user may
also open Studio first and request changes there. Do not embed Studio inside
the Host chat, invent an address or start a second conversation.

Preparation does not save. Use `saveChanges` with the reviewed revision, changes
and digest only when saving is authorized; otherwise let the user review and
save in Studio. After a conflict or uncertain response, read the copy before
retrying. Do not edit installed content or Design Files, publish, or launch a
design Bundle to customize reusable authoring content. Missing tools or methods
must be reported instead of replaced with private transport calls.

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
In the Mac Codex desktop app, that Panel guide's desktop entry starts the shared
service and a separately host-launched notification bridge, then opens the real
right-side browser. Preserve the current conversation; plugin setup does not
require choosing a replacement conversation. Actual availability after a host
restart must be checked in the current conversation.

When switching or closing, first finish/cancel active work with the user as
appropriate; do not leave old Producers writing while silently moving projects.
Stop only the companion process you started using its native process handle.
After a project selection change, launch the companion for the new project and
return the new URL. The old tab is not automatically retargeted. `delete` only
removes the registry entry and keeps files/history. Never recursively delete
project files to implement it.

For actual design work read [native execution](../design-panel/native-execution.md):
native Producer/Worker children, file validation/settlement and GRA execution choices.
The desktop route first checks its current hostCapabilities; unverified native
Producers, Workers or background reviewers must not be launched through CLI
instructions. Main execution and an explicitly chosen foreground check remain
subject to the shared Bundle policy and user authorization.
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

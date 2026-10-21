# Claude Code adapter

The adapter reuses the Companion browser UI, Design Files, Bundle validation,
native agent bindings and batch review lifecycle. It does not replace Claude's
main conversation or change the DSH plugin.

## Isolated local trial

From this repository, build a relocatable package:

```sh
node packages/companion/build-plugin.mjs --claude
```

Keep the exact printed `.../design-system` path. Start Claude from the desired
workspace with that package, not an arbitrary older build:

```sh
claude --plugin-dir /exact/printed/path/yugoo-design
```

Then enter `/yugoo-design:yugoo new Claude test` and describe the product.
This local trial does not install a marketplace entry or change another host's
plugin configuration. The skill can open the selected project's Panel before a Kit
is active; it stays read-only until the user intent selects a matching Kit.
Activation updates the same running Panel without a server restart. It
retains the exact native session identity provided by its hook. No manual scan
of session logs is needed. Reloading/restarting Claude requires reopening the Panel.

## Current boundary

- The notification adapter currently supports Linux native Claude executables;
  hook support requires `FileChanged`, dynamic `watchPaths` and `asyncRewake`.
  Claude Code 2.1.209 is the local compatibility target, not a claimed minimum
  supported version or proof of a full interactive acceptance run.
- Main and Producer execution share the existing Bundle contract. Worker fanout
  uses native delegation only when the actual Agent context exposes it; otherwise
  the Producer can perform scoped artifact work itself.
- GRA/clarity use native background reviewer batches. The independent managed
  executor is not yet available for Claude; `--background-reviews` is not enabled.
- Native permissions and questions stay in Claude. Hook receipt means the
  notification reached the hook, not that the model executed it. Do not blindly
  resend an uncertain delivery.

Package tests cover relocation, shared MCP discovery, hook module dependencies
and native manifest validation without invoking a model. A live acceptance run
must additionally check Panel save delivery, conversation/child logs, foreground
generation and background review results using the user's actual Claude session.

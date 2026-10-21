# Yugoo Design — Codex development preview

This directory is a relocatable local plugin development package, not a public
release or a replacement for DSH. It includes a Codex manifest, the `yugoo` entry and `design-panel`
skill, compiled companion server/browser and an unchanged copy of the Web App Kit.
No personal marketplace or Codex settings are changed by building or running it.

Requirements: Node 22+, Git. Panel-to-conversation notification also needs a
Codex CLI supporting `queue --thread UUID --message TEXT` (interface checked on
0.153.4). Create a fresh project or open one pinned to `web_app@1.0`. Use a
dedicated test conversation, without concurrent DSH/Agent writers.

From this directory:

```sh
node scripts/design.mjs command --input "new My Project" --thread EXACT_THREAD_UUID
node scripts/design.mjs command --input "kit web_app" --thread EXACT_THREAD_UUID
node scripts/design.mjs inspect --project /absolute/test-project
node scripts/design.mjs serve --project /absolute/test-project --thread EXACT_THREAD_UUID --host-cwd /absolute/native-cwd
```

The server prints its private loopback URL and stays in the foreground. Ctrl-C
stops only this server. The Panel uses existing Design Files and native Web App
renderers. File saves validate and checkpoint through shared Core. Notification
failure does not roll back a save; check the thread before manual retry.

To load the launcher skill for a local Codex test without installing anything,
ask Codex to read `skills/yugoo/SKILL.md` from this package. Once installed, invoke
`$yugoo new My Project`. Manifest/plugin
installation and actual native queue delivery must be validated in a dedicated
session; this package does not silently install itself or guess a target session.

Native Producer/Worker observation and background GRA use exact native children,
as described in the execution guide. The companion never spawns a model by itself.
Core project commands share file semantics across hosts; Claude Code/Qoder
connected transport adapters remain unimplemented. Switching projects restarts
the owned companion and gives a new URL; old tabs do not retarget automatically.
Read/validate CLI commands do not
start a model. Shared completion validation is not a substitute for specialized
Bundle script checks or semantic review.

The server/browser require no DSH installation or `node_modules` at runtime.
The build reuses upstream DSH's pure JSON snapshot utility (license included),
not its application/session runtime. The Kit is copied as reference material;
its executable scripts retain npm dependencies from `kits/web_app/package.json`
and some require a browser. They are not advertised as dependency-free tools.
This is a local development artifact; public release/license inventory and
marketplace distribution are not part of this preview.

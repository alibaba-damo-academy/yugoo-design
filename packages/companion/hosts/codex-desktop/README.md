# Codex Desktop on macOS arm64

This integration uses the existing Companion Panel, Core saves and original
Codex conversation. It does not launch a CLI model, use the CLI queue or create
a replacement conversation. The ordinary Codex CLI entry remains unchanged.

The first adapter targets the installed Mac desktop 26.1016.62342 (build 21477),
macOS arm64 and its native app-tools bridge. This is an observed, version-bound
interface; availability on another desktop version must be checked there.
Source builds and a directly launched prototype do not establish plugin
registration, installed-package acceptance or support for other hosts.

## Install or update from npm

Acquire an exact Companion release in a durable version directory using the
[shared installation entry](../../HOSTS.md#agent-led-installation-and-updates).
Read the acquired package's actual `design-system --help`; older releases may
not expose the npm-backed Desktop route. From that installation's consumer
directory, prepare a source and review its catalog plan:

```sh
npx --no-install design-system install --host codex-desktop \
  --destination /absolute/user-home/plugins/yugoo-design/EXACT_VERSION \
  --receipt-dir /absolute/external/receipts \
  --node-executable /absolute/existing/public/node \
  --dry-run
```

The source must be new, inside the intended user's home, outside the acquired
npm package, and beneath an existing parent directory. It contains the small
native overlay and launchers that reference this exact npm installation.
Runtime files, dependencies and Node are not copied. Keep both directories at
their recorded paths. Public Node runs the shared service; the app's signed
runtime remains specific to the host-launched bridge described below.

Review the plan's source, version, profile and owned catalog-entry change. The
command verifies the installed runtime; an existing exact `--runtime-receipt`
for this package and Node can be reused during preparation. Runtime loading does
not prepare the embedding model cache or establish KAG/GRA acceptance.

Apply the saved plan from the same acquired package:

```sh
npx --no-install design-system install --host codex-desktop \
  --apply --plan /absolute/returned/plan.json \
  --receipt-dir /absolute/external/receipts
```

Apply uses the saved source, Node and ownership proof. Do not add a destination,
Node override or previous receipt to that command. The result still reports
`hostRegistered: false`, `installed: false` and `loaded: false`; native activation
is the next step.

For an owned update, acquire the next exact npm version into a new durable
directory, choose a new source directory, and add
`--previous-receipt /absolute/old/desktop-marketplace.json` when preparing its
plan. The transaction checks the previous receipt, immutable source and current
owned entry before replacing only that entry's source. Preserve old directories
and the receipt chain. An ownership conflict or edited source is reported and
retained, rather than repaired by overwriting it.

## Activate in the native plugin UI

Install Yugoo Design through the desktop Plugins UI. Verify the actual installed
cache version/files and select the plugin in the current conversation. If a
normal restart is required to refresh local plugins, the user performs it and
returns to this same conversation. After loading, use `$yugoo` to select a project
and follow the installed desktop entry. Registration, loading, restart and idle
wake require their own on-site evidence.

## Start from the original conversation

For an installed plugin, follow its
[desktop entry](../../plugin/design-system/skills/design-panel/codex-desktop.md).
The existing `$yugoo` and `design-panel` skills select that entry for Mac desktop;
the CLI instructions remain specific to CLI conversations.

Use an isolated project/state for development. Obtain the exact current
`CODEX_THREAD_ID`, native cwd and `CODEX_APP_TOOLS_PIPE_PATH` from the executing
host. Do not discover sockets or select a recent conversation. Start Companion
with the ordinary system Node and explicit `--codex-desktop`:

```sh
node /absolute/plugin/scripts/design.mjs serve --host codex --codex-desktop \
  --project /absolute/design-project --thread EXACT_CURRENT_UUID \
  --host-cwd /absolute/native-cwd --state-root /absolute/isolated-state \
  --browser-access local --disable-embedding
```

Desktop startup requires the explicit `--browser-access local` setting.
Omitting it or selecting `token` is rejected before project or native startup:
token-mode browser access shares the private connection credential and cannot
isolate the desktop bridge. Ordinary CLI token-mode defaults remain unchanged.

Then, through the host's normal long-running command tool, directly launch the
packaged `scripts/codex-desktop-bridge.mjs` with the selected desktop's own
bundled Node and `--connection` set to the returned private connection path.
The bridge's cwd must equal that connection's native cwd. Keep both owned
processes alive; stop only these processes when closing the preview.

The system Node Companion must not spawn the signed bridge as its child.
A bounded local comparison found the same signed runtime and probe accepted
when launched directly by Codex, but refused with
`missing-code-signing-identity` when launched by ordinary Node. Executable
signature inspection alone does not prove host admission. Do not copy or
re-sign the runtime, change admission checks, search other pipes or retry an
uncertain submission. Use the host-provided runtime location, not a guessed
application path. This adapter installs no extra Node runtime.

The bridge validates its private connection, exact current thread and native
cwd, and checks the host's send capability before becoming ready. It uses the
existing authenticated Companion connection for a single bound notification
lane. The local browser cannot call this lane. No arbitrary host tool, socket
or target-thread parameter is exposed. If the bridge exits or loses its lease,
new submissions fail; a claimed message with no receipt stays unknown and is
not replayed. An explicitly closed bridge can be replaced; after an unclean
owner loss, reopen the bound service rather than taking over uncertain work.
Each ready admission returns a fresh generation carried by next/settle/stop;
old long polls and cleanup cannot claim work or stop a later admission, even
when a caller reuses its instance UUID.

The `--codex-desktop` adapter fixes startup `browserDefaultView: "panel-only"`.
Pass its returned browser URL to the available native `open_in_codex` browser
tool with placement `right`; it opens the Panel even when `view` is absent.
The returned `openPanel` arguments retain explicit `?view=panel-only` for
compatibility. Use `?view=full` on that same browser entry for an independent
full browser window. This opens the real local Panel in the current
conversation's browser tab. URL presentation does not
bind the session; the startup connection owns that identity. The host's
[browser documentation](https://learn.chatgpt.com/docs/browser?surface=app)
describes this surface.

## Verification boundaries

Verify these separately: host capability query; actual right-side browser
rendering; editing and Core Git save; page reopen and persisted readback;
host message acceptance; actual original Agent consumption. The
`submitted_unverified` receipt means only that the host accepted the message.
It does not certify Agent execution or completion. Save persistence remains
valid if notification fails.

The default desktop route supports main Bundles and explicit foreground checks.
With actual native Host delegation, its Skill may select
`--codex-desktop-native-bundles` on the same service. The attached adapter validates
the exact main header, current actual launch, real nested Producer parent and
successful child consumption of the pinned Bundle method before registration.
It reuses shared native run, artifact receipt and publication semantics. Children
read their registered target before editing. This route requires separate actual
Producer, nested Worker and main Worker acceptance; a source build or capability
flag is not successful execution. The default remains unavailable for these roles.
Studio trials remain unavailable. Cooperative GRA
requires current-service native launch metadata, exact parent/child UUID and cwd,
and observed independent main work before the child completes. Merely exposing
collaboration tools or returning a task name does not enable dispatch. The
readiness protocol performs no launches itself. Each prepared review must bind
its own fresh native child assigned that exact review ID; a readiness probe
cannot be reused. Missing proof leaves background execution unverified and
preserves the project policy without a foreground or second-model fallback.

For desktop multi-agent v2 opaque input, assignment also admits an actual native
`design_read_review` completion from that child's first turn. Its exact
server-owned connection path, argument/response review ID and native timing must
match; another review, foreign service or failed tool result cannot prove it.
Readable conflicting assignment text still rejects the binding. A Reviewer that
yields for binding is resumed once after that same child is bound; its own result
submission establishes publication. Domain review diagnostics remain distinct
from MCP tool failure and retain the shared status/currency checks.

The server build includes the bridge entry. Native plugin registration/loading,
restart restoration, full multi-platform artifact inventory and npm delivery
remain separate acceptance gates; the preview does not rewrite the personal
plugin profile or register another connector.

## Prepare a local desktop plugin

This source development route builds a standalone plugin. For an acquired npm
release, use the npm-backed preparation above to retain its existing runtime.

Build through the normal plugin builder with all three pinned Git artifacts:

```sh
node packages/companion/build-plugin.mjs --codex-desktop \
  --native-git-artifacts /absolute/full-artifact-root \
  --node-executable /absolute/existing-public-node \
  /absolute/new-build/yugoo-design
```

The same Codex overlay and shared runtime are packaged. Its legacy
`.codex-plugin` MCP entry pins the selected public Node, uses `cwd: "."` resolved
by the host against the installed cache, and starts `scripts/design.mjs` relative
to that directory. On desktop 26.1021.31345 (build 21828), bundled executor
0.164.0-alpha.11.1 leaves `${PLUGIN_ROOT}` literal in this legacy format; the
placeholder example for the newer Agent Plugins schema does not apply to this
entry. The private host Node is not registered as a shared prerequisite. The
Linux CLI installer admission pins remain separate.

Keep the completed build in a persistent directory inside your home. Prepare a
reviewable personal catalog plan with the packaged entry:

```sh
node /absolute/build/yugoo-design/scripts/codex-desktop-marketplace.mjs \
  --receipt-dir /absolute/external-receipts
```

Review its source, version and new catalog entry. Apply that exact plan by
adding `--apply --plan /exact/returned/plan.json` with the same receipt directory.
Preparation preserves existing plugin entries and native configuration; it
only adds this local source to the catalog and retains a private backup. It
does not mark the plugin installed or loaded.

Preparations share one profile lock, even with different receipt directories.
The catalog is checked again after staging, immediately before rename; a
detected change aborts and retains the candidate, backup and journal. This is
not atomic compare-and-swap against native or other writers that do not use
the lock. Keep those writers idle while preparing the local catalog.

For an owned source update, keep the old closure unchanged and build the new
exact version into a separate persistent directory. Run the new package's
preparation entry with `--previous-receipt /exact/old/desktop-marketplace.json`.
The saved plan reports `action: update`, both source paths, versions and complete
tree hashes, and the exact catalog-entry difference. It checks the old private
receipt, current owned entry and old immutable source again under the profile
lock before replacing only that entry's source. Other catalog data stays intact;
missing ownership, an edited old source or changed receipt is refused without
repair. Receipts stay outside both closures. Apply the saved plan without
selecting a different previous receipt, and retain the resulting receipt chain.
Planning and applying share the same no-symlink/canonical-path checks before
directory creation and after it. Linked leaves or parents and case aliases into
either closure are rejected before a plan can alter the fixed tree.

Continue with [native plugin activation](#activate-in-the-native-plugin-ui).

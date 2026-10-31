# Host integration entry points

Choose the entry for the host you use. Each guide explains installation, updates
and the supported behavior for that host. Check [compatibility](../../docs/wiki/hosts.md)
before installing; adapter contracts for maintainers follow the setup instructions.

## Agent-led installation and updates

The GitHub URL is the public installation guide; reading it does not require a
GitHub account. Normal installation acquires the released **`yugoo-design` npm
package**, then uses its host adapter. Do not clone this repository or build from
source for a normal installation. If the GitHub page cannot be read, the
[same guide as plain text](https://raw.githubusercontent.com/alibaba-damo-academy/yugoo-design/main/packages/companion/HOSTS.md)
contains the same host sections; select the requested section by its heading.

The default route is **one prompt in the current host → reuse a matching runtime
or acquire an exact npm version → that host's installation adapter → normal host
startup and functional checks**.
Users install Yugoo Design, not separate DSH and Companion products. Only the
current or explicitly selected host is targeted, not every application on the
machine. The Agent chooses the host from its actual execution context or an
explicit user choice; installed executables alone cannot identify it.

The initial package acquisition may use npm or pnpm 11 in a durable, separate
version directory; both invoke the same acquired `yugoo-design` entry. See the
[package guide](README.md#npm-candidate-and-native-installation-boundary) for
pnpm's explicit dependency build permissions and CPU policy. Do not mix package
managers within one installation directory. An explicitly requested HTTPS mirror
may be used for acquisition; for DSH, also pass the same `--registry` to the
product installer. It preserves the release's exact aggregate and canonical
origin while recording the effective download source in the plan and receipt.
DSH's internal package operation remains owned by its official CLI, not by a
second installer. No implicit registry fallback or global configuration change
is performed. Other adapters do not accept DSH-only registry flags.

First-release local embedding uses CPU inference. Before the first npm/npx
acquisition, set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` in that child process's
environment and keep dependency lifecycle scripts enabled (`--ignore-scripts=false`
for npm install). This is ONNX Runtime's supported way to skip the extra CUDA
download; it does not replace the upstream package or skip other dependencies'
scripts. Apply the same environment to later host-installation subprocesses that
acquire dependencies. The maintained DSH adapter supplies it to the official CLI
for both Web and Desktop; an older installed adapter may require the caller to
supply it. Preserve the environment's other values and restore any temporary
shell setting afterwards. The [package guide](README.md#npm-candidate-and-native-installation-boundary)
shows POSIX and PowerShell acquisition examples.

The package cannot set the environment of the npm/npx process acquiring it:
dependency installation happens before its CLI can run. Bare npm/npx acquisition
does not select this CPU installation policy automatically. Do not use a later
parent-package postinstall or blanket script suppression as a substitute.
CPU policy does not eliminate the separate embedding-model download/cache step.
GPU support and configurable or user-local model selection remain future work;
the default product does not provision a GPU environment.

**Product package:** the npm package and CLI are both `yugoo-design`.
Resolve the requested release from npm to its exact version and integrity before
acquisition; a missing release stops installation. For the default `latest` selection, follow
the checklist below rather than copying a version from a historical example.
The former `@yugoo-design/companion` package and beta channel remain historical
records, not a compatibility package or the default installation entry.
Publication does not update an already registered host. Current release and
candidate scopes are recorded in [preview status](../../docs/wiki/preview-status.md#current-release-and-use).

Before downloading, inspect any retained exact installation and its runtime
receipt. Reuse it when its version, host adapter and runtime satisfy the request.
If only the native material or loaded host session is stale, use the owning
refresh/import/reload steps below. A required new npm version still belongs in a
new retained directory; preserve the previous one and its receipts.

Earlier registry checks and incomplete downloads are recorded in the
[release and compatibility guidance](../../docs/wiki/preview-status.md#current-release-and-use).
An already published version is immutable;
subsequent changes need a new version. Native suite and Kit/Bundle versions stay
separate. The Agent must check the required exact product
version and integrity, and use that version's bundled instructions and help.
If a required release is missing, report it without substituting a fixture,
source build or arbitrary `latest`. Local tarballs belong to
[candidate preflight](../../docs/wiki/getting-started.md#发布前候选预检).
For all hosts, keep each acquired exact version in a durable directory, preserve
the previous installation and its receipts, and use the owning adapter's actual
update/recovery behavior. Required native GUI confirmation remains part of the
desktop route; it does not make manual setup the main installation tutorial.

### Default prompt: any supported host

Copy either language version into the Agent application where you want to use
Yugoo Design. No host name is required unless the Agent cannot establish its
current host, or you want to target a different one. This is the shared prompt;
the host-specific sections below are optional overrides and adapter details.

```text
请从 npm 正式包 yugoo-design，在我当前的 Agent 宿主中安装或更新语构设计系统（Yugoo Design）。
先读取官方安装指南，按当前宿主的步骤操作：
https://github.com/alibaba-damo-academy/yugoo-design/blob/main/packages/companion/HOSTS.md#agent-led-installation-and-updates
优先使用我明确指定的版本。未指定版本时，将 npm 的 latest 解析为一个精确已发布的稳定版本；如果 latest 指向预发布版本，请说明情况并停止，不自行改选其他版本。核对完整性，复用匹配的已有安装；需要新版本时按指南获取。GitHub 链接只用于读取公开指南，无需登录、克隆仓库或源码构建。
请完成环境检查、安装、宿主导入或启用及验证，保留已有项目、配置与安装回执。需要我授权、下载模型、启用插件或重启宿主时，给出必要操作，等我完成后继续核验。
最后分别说明取得的包版本、宿主实际加载版本和未就绪能力，并给出当前宿主的 yugoo 入口，以及使用 Web App Kit 创建第一个设计项目的一条可复制请求。
```

```text
Install or update Yugoo Design in my current Agent host using the official npm package yugoo-design.
Follow the public guide for this host (no login, clone or source build):
https://github.com/alibaba-damo-academy/yugoo-design/blob/main/packages/companion/HOSTS.md#agent-led-installation-and-updates
Use the version I request; otherwise resolve npm latest once to an exact published stable version. If latest is a prerelease, report and stop; do not choose another version. Verify integrity; reuse a matching install or acquire that version.
Check the environment, install, complete native import/activation and verify. Preserve projects, settings and receipts. Give steps and wait if I must authorize, download a model, activate a plugin or restart the host; resume verification after I finish.
Report acquired and actually loaded versions separately, plus capabilities not ready. Give the host's yugoo entry point and a copyable request to create my first Design Project with Web App Kit.
```

For an explicit override, append “Target host: Codex CLI”, “Target host:
DeepSeek Harness”, or the intended host below; append an exact version if needed.
A website host selector should include that selected host explicitly in the copied
prompt, not only change its guide URL. An explicit target takes precedence over
the current conversation's host; confirm an ambiguous target before changing setup.
The same prompt supports updates, but each adapter retains its own update and
recovery limits. It does not authorize blanket uninstalls, a replacement host,
automatic host restart or changing model credentials. An interrupted operation
must be inspected through its existing receipt before retrying.


### Installation checklist for the Agent

1. Identify the current host from the session. Reuse a compatible public Node.js
   `>=22.19.0` selected by the user, system or version manager. Do not borrow a
   Preview, application-private or plugin-bundled Node, or change global PATH.
   Prepare a missing prerequisite once; adapters do not each install Node.
   When available, use `resolve-node` and keep verification and startup on the
   selected executable. DSH Desktop retains its official Electron/Loader entry.
2. When no version is specified, resolve npm's `latest` once to its exact
   published stable version and integrity. If the tag points to a prerelease,
   report the mismatch and stop; do not silently choose another version.
   Use that exact stable version throughout acquisition and setup.
   An explicit version request takes precedence. Apply the CPU acquisition policy
   above before npm starts. Reuse an existing matching retained installation;
   acquire a new version in a separate durable directory when needed.
3. Read the acquired README and `--help`, then execute its owning host adapter.
   The unified product supplies shared runtime, Panels and the default Web App
   Kit, plus the integration required by the selected host. Preserve project Kit
   pins, model credentials, unrelated plugins, old installation and receipts.
   Inspect any partial receipt before retrying; stop the affected step on missing
   packages, unsupported host or ownership conflict.
4. Prepare local embedding resources using the acquired package's
   [model preparation instructions](README.md#local-embedding-model-preparation).
   Reuse a complete cache. Download only when allowed, and test CPU inference
   under the actual runtime user and OS. A WSL cache does not prepare Windows.
   Respect an explicit choice to disable embedding and preserve a DSH custom
   provider. An unavailable embedding model does not prevent basic design work.
5. Complete the native registration/import and give the user only the required
   authorization, activation or new-session action. Continue checks after that
   action. Report acquisition, native registration, loaded version and actual
   design usability separately, including the `yugoo` entry and tools. Also
   distinguish complete model files, tested CPU inference and the real project's
   semantic readiness; prepared materials alone are not an activated plugin.
6. Once activated, give the user this host's actual `yugoo` entry and a first-project
   request in their language. Follow [the first design cycle](../../docs/wiki/getting-started.md#3-创建设计项目):
   create a small Web App Kit project, produce one useful result, edit and save in
   its Panel, reopen it and continue in the original Agent conversation. Wait for
   the user to choose this next task; installation does not authorize a full design.

Historical beta.1 used saved-plan routes for Codex/DSH and a separate
`prepare-desktop` command for desktop materials; beta.2 added
`install --host <host>` orchestration. Those archives retain their original
executable and help. The unified product uses `yugoo-design`, with no old
executable alias. Existing registration and preparation adapters keep their
host-specific parameters and receipt rules. Follow the acquired version's
actual help rather than inventing flags.

### Install or update: Codex CLI

> Install or update Yugoo Design in this Codex CLI environment. First resolve
> the requested `yugoo-design` release to its exact published version on `https://registry.npmjs.org`
> and reuse a matching retained runtime or acquire its resolved exact version into
> a new durable version directory. Inspect the
> installed `yugoo-design --help`, current Codex version and existing registration.
> Use its Codex `install --host codex` route: when the direct transaction is
> supported it orchestrates the existing plan, runtime check and apply;
> otherwise follow the saved stages exposed by that version. For an owned
> update retain the prior receipt and npm directory. Stop on unsupported protocol
> or unknown ownership and report the actual reason. Preserve projects, models
> and unrelated settings. After normal host restart, confirm the loaded plugin
> version and `$yugoo` entry, then check a nonempty design, Panel save/reopen and
> original-session consumption separately. Report anything not verified.

See [Codex registration and recovery](README.md#persistent-registration-transactions).

### Install or update: Codex Desktop on macOS arm64

> Install or update Yugoo Design in this Mac Codex Desktop conversation. Resolve
> the requested `yugoo-design` release to its exact published version, retain its integrity, and acquire
> it in a durable version directory. Read that package's actual help and the
> Desktop guide below. Reuse an existing compatible public Node. Use its
> `install --host codex-desktop` route to prepare a new immutable source under
> my home and review the saved personal catalog plan. For an owned update,
> supply the previous successful receipt; keep the old source and npm directory.
> Apply only that owned plan, then install or update the exact source through
> the native Plugins UI and select it in this conversation. If a normal restart
> is needed, give me that step and return to this same conversation afterwards.
> Confirm the actual loaded version and entry, then check a meaningful Panel
> edit/save/reopen and original-Agent consumption. Report missing capabilities;
> preserve project pins, credentials and unrelated plugins.

See [npm preparation and native activation](hosts/codex-desktop/README.md#install-or-update-from-npm).
A prepared catalog is not native installation or loading. Keep the acquired npm
directory and its small prepared source at their recorded paths.

### Install or update: Claude Code CLI

> Install or update Yugoo Design in this Claude Code CLI environment. Resolve
> the requested `yugoo-design` release to its exact published version on `https://registry.npmjs.org`,
> then reuse a matching retained runtime or acquire its resolved exact version into
> a new durable version directory. Inspect the
> installed installer help, actual Claude executable and current user-scope
> registration. Use `yugoo-design install --host claude-code` and its supported
> owned-receipt update/recovery route, preserving the previous installation.
> Do not overwrite unknown entries or change models and project files. After
> normal host restart, confirm the loaded version and `/yugoo-design:yugoo`,
> then verify a nonempty design, Panel save/reopen and native consumption of
> the saved edit. Report registration, runtime and design results separately.

See [Claude Code persistent registration](README.md#claude-code-and-qoder-cli-persistent-native-registration).

### Install or update: Qoder CLI

> Install or update Yugoo Design in this Qoder CLI environment. Resolve
> the requested `yugoo-design` release to its exact published version on `https://registry.npmjs.org`.
> Reuse a matching retained runtime or acquire that version
> into a new durable version directory. Inspect
> the installed installer help, actual Qoder executable/profile and existing
> registration. Use `yugoo-design install --host qoder`; an owned same-version
> registration is a no-op, while a different version requires the reported native
> uninstall/re-registration procedure. Preserve the previous package and receipt;
> do not replace foreign entries or use a permanent `--plugin-dir` workaround.
> After normal restart, confirm the loaded version and `/yugoo-design:yugoo`,
> runtime tools, a nonempty design, saved/reopened Panel and original-session
> consumption. Report unsupported versions or failed steps precisely.

See [Qoder persistent registration](README.md#claude-code-and-qoder-cli-persistent-native-registration).

### Install or update: DeepSeek Harness

> Install or update Yugoo Design in this existing official DeepSeek Harness.
> Resolve the requested `yugoo-design` release to its exact published version from
> `https://registry.npmjs.org` as the product installer. Reuse a matching retained
> runtime or acquire the exact version in a new durable directory. Check its
> `release-hosts.json` for the exact DSH aggregate and verify its complete exact
> dependency set is available, including any declared native Git helper. Do not
> install internal packages manually or change external dependency pins.
> Inspect installer help and the existing official DSH
> CLI/Loader versions. Use `install --host dsh` with the intended existing
> profile, pinned DSH config and external receipts; prepare a dry-run plan and
> apply that saved plan. Preserve existing models, search and projects. If an
> operation fails after changing state, retain its partial-state receipt.
> After normal DSH restart, verify loaded versions, `/yugoo`, embedded Panel
> save/reopen and native continuation; test KAG/GRA only through the real host
> and report their results separately. Do not modify the host's source.

See [DSH installer and recovery limits](../dsh/README.md#candidate-npm-installer-dsh-route-and-recovery-limits).

DSH's own package manager may separately ask to approve dependency build scripts,
for example with `ERR_PNPM_IGNORED_BUILDS`. Show the user the packages and action
requested by the host, then obtain approval only for those dependencies through
its native approval flow, such as the suggested `pnpm approve-builds` command.
A current release may request `onnxruntime-node`,
`protobufjs` and `sharp`; follow the actual error rather than treating this as a
permanent allowlist. Keep the CPU acquisition policy above when following the
host's repair instructions; do not suppress all scripts or approve future builds
indiscriminately. Retain the initial failed result and logs. Native repair is a
separate action: do not rerun the failed installation plan or turn its receipt
into a successful owned installation. If dependencies are installed but the
Yugoo plugin is disabled, open DSH's Plugins page and enable the installed
`@yugoo-design/dsh-design-system-dsh` entry. A restart is not a substitute for
native registration or activation; do not delete installed dependencies just to
reinstall them. After repair, activation and any normal restart, check the
version actually loaded and report the original failure and repair separately.

#### DSH configuration file and receipts

The Agent prepares `--dsh-config` from the **existing official DSH installation**;
the user does not need to guess its fields. Save an absolute JSON file with the
following eight required keys. Replace every example path, version and hash
with values read from that installation:

```json
{
  "dshHome": "/absolute/existing/dsh-home",
  "node": {
    "path": "/absolute/official-runtime/node",
    "sha256": "<sha256-of-runtime-executable>"
  },
  "cli": {
    "path": "/absolute/official-dsh/<bin.dsh-entry>",
    "sha256": "<sha256-of-cli-file>"
  },
  "hostManifest": {
    "path": "/absolute/official-dsh/package.json",
    "sha256": "<sha256-of-host-package-json>"
  },
  "loader": {
    "path": "/absolute/official-dsh-app-boot/<main-entry>",
    "sha256": "<sha256-of-loader-file>"
  },
  "loaderManifest": {
    "path": "/absolute/official-dsh-app-boot/package.json",
    "sha256": "<sha256-of-loader-package-json>"
  },
  "hostVersion": "<hostManifest.version>",
  "loaderVersion": "<loaderManifest.version>"
}
```

Use absolute file paths and each file's actual SHA-256: 64 lowercase hexadecimal
characters, computed from its resolved bytes. Each file pin accepts only `path`
and `sha256`. Locate the installed packages through the host's existing entry
point or native installation information; do not use a source checkout, a shell
shim or a separately downloaded replacement.

| Field | Value to read from the installed host |
| --- | --- |
| `dshHome` | The existing DSH configuration root for the intended host, resolved to its real directory. It contains `profiles/`; it is not the profile directory itself. |
| `node` | For Web, the compatible Node executable used to run the official CLI. For Desktop, the official Electron executable, as described below. |
| `hostManifest` | `package.json` for `@deepseek-ai/dsh`; check its package name and read `version` into `hostVersion`. |
| `cli` | For Web, resolve `hostManifest`'s `bin.dsh` relative to that package directory. Desktop has a different entry below. |
| `loaderManifest` | `package.json` for the installed `@deepseek-ai/dsh-app-boot`; read `version` into `loaderVersion`. |
| `loader` | Resolve `loaderManifest`'s `main` relative to its package directory. |

These version strings identify DSH and its Loader, not the Yugoo npm product.

For **Desktop**, also add `desktopHostManifest` as a `{ "path": "...", "sha256": "..." }`
pin for the installed `@deepseek-ai/dsh-desktop-host/package.json`. Its version,
`hostVersion` and `loaderVersion` must match. Set `cli` to that Desktop package's
`lib/cli.js`, with the DSH and Loader packages from the same installed tree.
Set `node` to the official Electron executable; the installer uses its existing
Electron Node bridge to read ASAR resources and run the official CLI. Keep the
installed tree intact rather than extracting it or substituting ordinary Node.
Read and hash any files inside ASAR through Electron's filesystem; the archive
location depends on the actual installation. Use the existing `desktop` profile.

Pass the existing profile's **name** separately with `--profile`; the installer
does not create a profile. Do not add `nodeExecutable`, `cliExecutable`, `scope`
or runner overrides to the JSON. DSH does not accept `--node-executable`,
`--disable-embedding` or Codex's `--runtime-receipt`; model settings remain owned
by the host.

Choose an absolute, private `--receipt-dir` outside the retained product package,
DSH home, every pinned input directory and any previous product installation.
It must not contain or overlap those roots or the config file. Keep the config
file outside the receipt directory. For example, use separate user-owned
`install-config/` and `install-receipts/` directories outside those roots, with
a new receipt directory for this operation. On Windows, an existing receipt
directory must already have the required private permissions; the installer
does not repair unsafe shared directories.

Use these inputs with the acquired `yugoo-design install --host dsh` route.
An explicit `--dry-run` writes `<planSha256>.dsh-plan.json` in the receipt
directory and returns its `planFile`; `--apply --plan <absolute-planFile>` consumes
that saved file with the same config and profile. The direct route without
either flag orchestrates these stages and uses a fresh receipt subdirectory.
Use the returned `planFile`, not a copy of the CLI's display object. For an owned
update, retain the previous successful receipt and supply `--previous-receipt`
to both stages. Keep the returned plan and result paths. Before native apply,
the installer retains `<id>.dsh-prepared.json`; a completed result is stored as
`<id>.dsh-result.json`, with command logs alongside it. A prepared record or
failed result does not establish a successful installation. Follow the linked
recovery limits before retrying a partial operation.

### Install or update: QwenWork

> Install or update Yugoo Design in this QwenWork desktop environment. Verify
> and resolve the requested `yugoo-design` release to its exact published version from
> `https://registry.npmjs.org`. Reuse a matching retained runtime or acquire the exact
> version in a new durable directory. Use
> the installed `install --host qwenwork` route, or its explicit
> `prepare-desktop --target qwenwork` route, with actual Windows
> Node/runtime paths, verified executable/worker pins, and an external output
> directory. Keep the npm version separate from the numeric native suite version;
> an update requires the previous preparation receipt and a greater suite version.
> Prepare the suite ZIP and connector configuration. The default ZIP contains
> its MCP connector; the separate JSON is an alternative for a permitted
> separate-connector arrangement. Enable only one `design-system` connector,
> using `--separate-mcp` when a connector-free suite is required. Use the host's
> supported importer, requesting only the necessary native GUI confirmation;
> preserve the organization's connector policy. After normal restart, confirm the
> actually loaded `yugoo` version, MCP tools, original conversation, Panel
> save/reopen and saved-edit consumption. Preparation alone is not installation.

See [desktop preparation](README.md#desktop-npm-package-preparation) and
[QwenWork's owning guide](hosts/qwenwork/README.md).

The inspected QwenWorkCN `1.3.2-26101704` desktop disables background Agent
Sessions. A restart needed to load the suite does not restore that capability.
The [assessment and user-confirmed foreground review](hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy)
are separate from installation, desktop input and KAG acceptance.

### Install or update: WorkBuddy

> Install or update Yugoo Design in this WorkBuddy desktop environment. Verify
> and resolve the requested `yugoo-design` release to its exact published version from
> `https://registry.npmjs.org`. Reuse a matching retained runtime or acquire the exact
> version in a new durable directory. Use
> the installed `install --host workbuddy` route, or its explicit
> `prepare-desktop --target workbuddy` route, with actual Windows
> Node paths and an external stable market directory. Keep the npm version
> separate from the numeric native suite version; for an update use the previous
> preparation receipt and a greater suite version. Use WorkBuddy's supported
> market/import and Refresh/Update controls, requesting necessary GUI confirmation.
> Use only commands listed by the acquired version's help; do not remove the old runtime. After
> normal restart, verify the actually loaded `yugoo` version, MCP tools, the
> original conversation, Panel opening, save/reopen and native consumption.
> Report unavailable Workers or background GRA without simulating them.

See [desktop preparation](README.md#desktop-npm-package-preparation) and
[WorkBuddy's owning guide](hosts/workbuddy/README.md).

## Disable, uninstall and retained files

Disabling a plugin, removing its native registration and deleting its retained
files are separate operations. Identify the actual host, profile/scope and owned
installation first. Use the acquired version's help; an update failure does not
call for a blanket uninstall. For a unified product installation in Codex or
Claude Code, run the following entry from the **retained npm installation that
produced the successful receipt**, using its `yugoo-design` executable, actual
native executable and matching profile. Historical packages retain their own
executable and help; the new CLI does not migrate an old receipt or registration:

| Host | Supported removal entry |
| --- | --- |
| Codex CLI | `yugoo-design uninstall --host codex --codex-executable ABSOLUTE_CODEX --receipt OWNED_SUCCESS_RECEIPT`. The installer verifies ownership and the receipt before removing its registration. |
| Claude Code CLI | `yugoo-design uninstall --host claude-code --claude-executable ABSOLUTE_CLAUDE --receipt OWNED_SUCCESS_RECEIPT`. Keep the receipt's user profile and user scope; unrelated plugins are preserved. |
| Qoder CLI | Use the selected native Qoder CLI's plugin management. Read back the installed selector and scope (`yugoo-design@local`, user scope for this adapter), then follow that CLI version's uninstall help for that exact entry. The product installer does **not** implement `uninstall --host qoder`. Keep the registration receipt and old runtime for inspection or re-registration. |
| QwenWork | Disable or remove the owned `yugoo-design` expert suite through the native Expert Kits interface. If a separate `design-system` MCP connector was imported for this installation, also disable/remove that owned connector when removing the integration. Do not leave an old suite's Hooks or a duplicate connector enabled. |
| WorkBuddy | Disable or remove the owned `yugoo-design` plugin through the native plugin manager. Remove its marketplace source only when no other retained installation needs it; keep the external market/runtime while still referenced. |
| DSH | Use the official host's plugin/profile management for the exact installed aggregate and selected existing profile. This product adapter provides install plan/apply and retained partial-state diagnostics, **not** a general `uninstall --host dsh` or automatic rollback. Inspect the recorded state and use the host-supported removal procedure. |

See [Codex/Claude transaction constraints](README.md#persistent-registration-transactions),
[Qoder registration](README.md#claude-code-and-qoder-cli-persistent-native-registration)
and [DSH recovery limits](../dsh/README.md#candidate-npm-installer-dsh-route-and-recovery-limits).
An interrupted transaction uses its owning recovery procedure, not a successful
installation's uninstall receipt. Installer `recover` concerns registration
transactions; it is separate from the current project command `migrate`.

After native removal, reload the host normally as required and confirm the owned
Skill, Hooks and MCP entry are no longer active. Registration removal alone does
not prove a previously opened Companion service stopped; close only the exact
owned service if it remains running. Preserve Design Projects, their Git history
and project records, models/credentials and unrelated registrations. npm runtimes,
preparation receipts and embedding caches are retained separately; do not remove
them while another host, running service or recovery receipt still needs them.
Deleting those files is not an implicit part of disabling the integration.

## Product and invocation names

The installed plugin/suite ID is `yugoo-design`; the product name is **Yugoo Design**.
The daily entry Skill is `yugoo`. DSH exposes `/yugoo` as its only project entry,
with no `/design` command or compatibility alias. Codex uses `$yugoo` / its Skill picker;
select the entry belonging to `yugoo-design` if names repeat. Claude Code and
Qoder plugin commands use `/yugoo-design:yugoo`; typing `yugoo` in their native
picker locates it without creating a second project-local command. Desktop
hosts use the installed suite's `yugoo` Skill through their native picker.
A bare `/yugoo` alias is not claimed where the host requires a plugin namespace.
There is no parallel `ygd` entry.

Before switching from `design-system` (or WorkBuddy's `yugoo-workbuddy-probe`),
disable/remove the old plugin through the owning host or use the exact old
installer receipt to uninstall it. Never enable both copies of the Hooks/MCP.
The installers reject legacy or ambiguous ownership instead of overwriting it;
old owned receipts remain usable for recovery/uninstall. QwenWork organizations
that reject suite data connectors continue using the separate `design-system`
MCP connector; rename the suite only and keep one connector, not two.

These names do not migrate Design Projects, state directories, native session
bindings, tool names, MCP server keys, runtime scripts or DSH Cordis/package IDs.
The unified product's terminal installer is `yugoo-design`, with no
`design-system` executable alias. Older installation receipts still belong to
the exact old runtime that created them. New product naming does not establish
native installed-host acceptance or migrate those registrations.

## Adapter reference for maintainers

The remaining sections describe adapter implementation and maintenance. For installation, updates or removal, use the user setup sections above. A `serve` command or source packaging entry is not an additional installation step.

## Product entry and configuration

The user starts the host normally, then opens Design System from that existing
host conversation. Complete required host settings during explicit setup; opening
a design task only checks readiness and binds the current conversation. Design
System must not create a separate host launcher/shortcut, wrap the user's normal
host command, start a replacement host or rewrite the host startup registration.
If setup requires restarting the host, explain it and let the user restart normally.

## Owning entries

| Host | Installation and instructions | Runtime entry | Message transport |
| --- | --- | --- | --- |
| DSH | [DSH package](../dsh/README.md), [Cordis patch](../dsh/cordis.patch.yml) | Native DSH provider; embedded shared Panel | Native interaction and event integration; do not launch Companion as a replacement host |
| Codex CLI | [Codex Skill](plugin/design-system/skills/yugoo/SKILL.md), [installer](src/npm-installer-codex.mjs) | `design.mjs serve --host codex` | [Original-thread queue](src/codex-connection.mjs); accepted queue entry is not completion |
| Codex Desktop on macOS arm64 | [Owning guide](hosts/codex-desktop/README.md), [npm installer](src/npm-installer-codex-desktop.mjs) | Installed desktop entry: `design.mjs serve --host codex --codex-desktop` | [Host-launched bridge](src/codex-desktop-bridge.mjs); original-Agent consumption requires its own receipt |
| Claude Code | [Claude Skill](plugin-claude/design-system/skills/yugoo/SKILL.md), [installer](src/npm-installer-claude.mjs) | `design.mjs serve --host claude-code` | [Native Hook adapter](src/claude-hook-transport.mjs); verify native consumption separately |
| Qoder CLI | [Qoder Skill](plugin-qoder/design-system/skills/yugoo/SKILL.md), [installer](src/npm-installer-qoder.mjs) | `design.mjs serve --host qoder` | [Native Hook adapter](src/qoder-hook-transport.mjs); native approval and delivery policy still apply |
| QwenWork Windows preview | [QwenWork Skill](plugin-qwenwork/design-system/skills/yugoo/SKILL.md), [suite packaging](qwenwork-package.mjs), [setup and evidence](hosts/qwenwork/README.md) | `design.mjs serve --host qwenwork` defaults to verified desktop user input; `--qwenwork-events-only` explicitly selects limited events | [Desktop user input](src/qwenwork-desktop-input.mjs) and separate [Hook events](src/qwenwork-hook-transport.mjs) |
| WorkBuddy Windows preview | [Owning guide](hosts/workbuddy/README.md), [Design Skill](hosts/workbuddy/design-SKILL.md), [suite packaging](workbuddy-package.mjs) | `design_command` + `yugoo_workbuddy_open_panel` in the current host; shared Companion service | Real input/save, history and Windows KAG verified separately; serial foreground native Producer publication verified through 0.3.8. Workers and detached GRA remain unavailable. Persistent preview path migration is a separate installation check. |

All `serve` entries also require the exact project, native conversation and other
arguments in the owning Skill. An installer recognizing a host name is not proof
that persistent installation or every execution capability is implemented.

## Connection, page presentation and access

Opening a page consumes an existing design connection; it does not create the
project binding or choose a different destination for user messages. Keep these
responsibilities separate across all hosts:

| Responsibility | Authority | What a browser URL cannot establish |
| --- | --- | --- |
| Project selection | The existing host/session selection store and the selected Design Project | A project-looking path is not permission to select a different root |
| Conversation delivery | The adapter's exact host/session and, where supported, process generation or originating MCP App | A project ID alone cannot choose between two conversations using that project |
| Presentation | A page's layout and the host's verified navigation/container capability | `view=panel-only` does not rebind, restart, authenticate or enable native execution |
| Transport admission | DSH's native gateway, or Companion's local Host/Origin/token checks | Being on loopback is not a conversation identity or project ownership proof |

For Companion, reuse the existing startup result: `url` is the browser entry and
`connection`/`connectionPath` is the exact local tool connection. The service has
already selected its project and native transport before creating that URL.
CLI hosts return the local URL for an independent browser. A desktop adapter may
pass that exact URL to a verified native browser-opening tool; this is the same
browser-access handoff, not a new authentication system. The WorkBuddy adapter
supplies the actual arguments for `present_files` rather than asking the Agent
to read a connection file, reconstruct a token, or make a redirect HTML artifact.
Native tool arguments may be recorded by the host. Do not claim the browser URL
remains model-invisible in that route, or publish it to unrelated services.
Raw token extraction and disclosure of distinct native/relay credentials remain
outside the browser-opening operation.

Browser access is selected at startup (`browserAccess: token | local`), separately
from presentation and native conversation binding. Legacy CLI defaults to token;
its per-service token enters through the fragment and tab storage. WorkBuddy's
local package explicitly selects local: `/browser/<instance>/` carries a public
service generation, with no browser bearer or storage requirement. Refresh/back
continue during that instance; a stale generation cannot attach to a reused
port. Local browser requests retain exact Host/Origin checks and the explicit
UI-method allowlist. Connection-file tool API and original-conversation relay
keys remain independent in both modes. A browser URL cannot change the mode or
choose a different project/native destination. DSH does not consume this policy.

An embedded adapter explicitly declares startup `browserDefaultView: "panel-only"`;
the service default is `"full"`. Mac Codex `--codex-desktop` supplies the embedded
default. The service places this presentation declaration in its HTML entry;
the client uses it only when the URL has no `view`. Browser admission, user agent
and window size do not select this default. Explicit `view=full`, `view=panel-only`
and its legacy `design` alias take precedence, as do Studio/trial routes.

One live Companion connection can have an independent `?view=full` browser and a
panel-only host browser. Both use the same files, save semantics and
native destination. Changing that page's layout does not issue another token or
start another service. The design view hides history/composer and makes no
foreground-history requests; native verification and save transport remain
independent. Preserve separate Studio/trial view routes during source integration;
they must not be reinterpreted as a design/full switch.

DSH continues to mount the shared UI through its own session-aware Remote and
host authentication. It neither consumes Companion URLs/tokens nor needs a
Companion process. These shared responsibilities do not require identical wire
protocols, presentation containers or credentials across hosts.

Treat browser rendering, message-bridge readiness, save persistence and native
consumption as separate checks. An open URL is not a connected WorkBuddy relay;
that relay needs its original conversation's control, which now connects automatically after exact metadata and host readiness. Navigation failure
does not authorize a duplicate startup, project creation, rebinding or message
replay. A new service issues a new URL, but does not by itself prove the old
service was stopped or its token revoked; closure of that exact instance does.

## Shared contract, host-specific adapters

### Native integration is a core product capability

The shared kernel and each supported Host adapter have equal product importance.
Host integration is not auxiliary glue: normal installation, session identity,
Panel interaction, save/continuation, execution and recoverability are part of
the plugin delivered to users. Reliability, latency and long-term maintenance
of these adapters require explicit implementation ownership and acceptance.
Shared conformance passing does not close an incomplete installed-Host path.
If a Host has a genuine native limitation, disclose its exact supported scope
and evidence; do not silently substitute foreground work, another model client,
manual file edits or repeated user retries for an advertised integration.

UST, KAG and GRA retain their existing shared authorities:

| Capability | Shared owner | Host adapter responsibility |
| --- | --- | --- |
| U/S/T | Core rubric, exact evidence input, validation, `clarity.json` latest authority and Journal audit | Expose ordinary reporting with project/Kit/Git evidence pins; the Host still owns its native model route |
| KAG | Core projection/index/publication and status contract; the same provider lifecycle and source pins | Bind the correct project and expose the shared lifecycle without treating acceptance as publication |
| G/R/A | Shared policies, immutable review requests, result validation and advisory authority | Prove actual background execution, bind each exact native launch and report its real lifecycle |

`design_status.services` is an explicit read-only projection of those existing
owners. It reports UST reporting availability separately from the last accepted
score, preserves KAG's publication-derived status, and separates GRA policy,
execution readiness and individual review state. It launches nothing and is not
a second store or mutation-admission authority. Ordinary browser workspace
polling does not opt into its extra native-context/provider reads.

U/S/T uses the current Agent and Core rubric. Accepted scores/reasons live at
`<project>/design_records/clarity.json`, with their audit journal in the same
project and Git history. Ordinary reports validate the selected project, Kit
content and saved Design evidence; they do not read native call logs or require
turn/call-id proofs. Identical current reports are reused, while changed intent
or corrected reasoning can be reported again on the same Design checkpoint.
An unavailable or failed report does not block authorized Design work.

GRA suggestions, human decisions and review policy are project records under
`design_records/reviews/`; native requests, handles, claims, notifications and
locks remain machine runtime state. Historical action-attempt records may be
retained as audit facts, but copying a project never restores a running native
task or grants execution permission. Current native bindings still govern actions.
There is no fallback read, migration or dual write to the old external records.

Passive KAG status never opens or repairs a cold database. Until an ordinary
graph operation or admitted maintenance opens it, it reports
`unavailable / knowledge-store-not-open`, not an empty graph or successful index.
An opened provider's status uses the existing Core publication parser; I/O,
recovery and indexing failures remain distinct from an unassessed design.
Accepted maintenance is not a completed publication.

Background GRA readiness is a normalized observation, not dispatch permission from the
model's text. Attached, synchronous, missing, stale and mismatched native
results remain unavailable with bounded diagnostic codes. Public status never
copies raw parser exceptions or receipt bodies. Observing readiness cannot
resume a scheduler: publication and explicit review/policy operations retain
their existing execution boundary. Each actual background Reviewer still needs
its own exact native launch and immutable request binding.

The shared explicit foreground GRA implementation is a separate manual path, not a
background readiness exception. When background execution is unavailable or a
native asynchronous run still occupies the main conversation, ask
whether to disable automatic GRA (`off`, with manual requests retained) or run
this batch in the main conversation after explaining that it will occupy the
conversation. No choice means no policy change and no review. The main Agent
reads the shared G/R/A profiles and submits results through the existing review
validation and Git record path; this mode does not force a synchronous child
or a native background run descriptor. Keep asynchronous manual review when the
host can leave the main conversation available. For supported versions and observed foreground behavior, see
[host compatibility](../../docs/wiki/hosts.md#后台能力与评审降级) and the
[foreground review availability](../../docs/wiki/preview-status.md#foreground-review-availability).

Core owns project state, validation, publication, Git and handoff semantics.
Panel owns shared UI, including saving and the composer. Companion's
[server](src/server.mjs) selects the host transport; [project](src/project.mjs)
reuses Core and delivers explicit user actions through `sendPrompt`. Bundle
content must not branch on the host name.

Keep four distinctions visible in each adapter:

1. Native identity: exact session, workspace, process generation and installed
   version. Never select the latest conversation or infer identity from a shell cd.
2. User input: composer text and explicit save-and-continue actions. Determine
   whether the host accepts ordinary user input or only a system event.
3. Background events: identity, review results and file-change context do not
   grant user authority. Where supported, `sendEvent` remains separate from `send`.
4. Execution: foreground/main, isolated Producer, optional Workers and detached
   reviews are individually negotiated; a working MCP connector proves none of them.

Successful save, accepted transport, native consumption and completion are
separate states. A failed send must preserve saved files. Unknown submissions must
not be automatically retried through another transport. Host restart invalidates
process-bound connections and requires explicit reopening.

### Maintaining adapter boundaries

Separate protocol ownership, not merely filenames. The current implementation
uses `src/<host>-*.mjs`, host-specific plugin entries and `hosts/<host>/` guides.
The [native background composition](src/native-background-adapter.mjs) selects
WorkBuddy or QwenWork readiness, verification and observation without parsing
either host's native receipts in the shared server. Other execution routes keep
their existing owning adapters. This is an incremental boundary, not a completed
repository-wide directory migration or proof of installed-host acceptance.

- Core and shared KAG/U/S/T logic own domain facts; they must not import a native
  host protocol. Composition may select adapters, but raw log fields, task paths,
  completion rules and version-specific capability checks stay with their host.
- Do not add imports from one host adapter into another. Reuse only proven common
  syntax through a neutrally named helper, retaining each host's own identity and
  capability checks. QwenWork's existing `verifyQoderChild` alias is legacy naming
  debt, not evidence that their background protocols are interchangeable; extract
  that common grammar with preservation mapping when that reader is reorganized.
- Keep Design Files/project authority shared. Scope native connection, run and
  readiness evidence by host and exact session; do not copy a capability proof,
  credential or transport fallback between hosts. Preserve distinct unavailable,
  unknown, accepted and completed outcomes instead of a single success flag.
- Each host guide links its owning code and focused tests and records the exact
  version/protocol evidence and unverified boundaries. A positive fixture or live
  test for one host does not accept another. Include wrong-parent/session/path,
  stale connection and synchronous-background-fallback negatives where relevant;
  readiness never replaces verification of each actual Reviewer launch.
- When physical consolidation is useful, move one owned adapter at a time toward
  `src/hosts/<host>/`, with neutral grammar helpers separate. Map old symbols,
  hooks, resources, failure/recovery rules and packaged paths to their retained
  owners first; update the affected import/package checks and real loading
  boundary. Do not combine mass moves, installer changes or removal of unverified
  protocols with an unrelated bug fix, or introduce a second capability registry.

## Desktop integration guides

Host-specific setup, evidence and limits belong to the owning guides:

- [Mac Codex Desktop](hosts/codex-desktop/README.md): npm-backed source and owned
  catalog updates, native activation, original-conversation bridge and shared
  Panels; source development and execution capabilities retain separate limits.
- [QwenWork](hosts/qwenwork/README.md): suite/MCP separation, native Hook events,
  experimental desktop user input, normal-start preconfiguration, KAG status.
- [WorkBuddy](hosts/workbuddy/README.md): official plugin/MCP ecosystem and dated
  discovery, exact-session transport and native acceptance records; each retains
  its tested scope and remaining limits.

These are source and maintenance entries, never alternate host launchers. A
source probe, installation, live input, durable save and KAG acceptance remain
separate states in each guide. Reuse shared data/UI semantics without imposing
one host's transport or configuration format on another.

## Adding or updating a host

Use an existing adapter when the installed host exposes the same verified
protocol. Otherwise add an owning adapter and Skill/packaging entry; keep generic
Core and Panel semantics unchanged. Update this index and the existing server and
installer dispatch points. Avoid creating a second independent registry of
capabilities or versions; link the runtime negotiation and native admission code.

For that exact host version, record these checks separately: install/discovery,
MCP call, native identity, composer input with native reply, durable save followed
by native readback, idle/resume, restart, busy/refused/unknown delivery, and supported
agent execution modes. Fixtures do not replace native-host acceptance. Provide an
uninstall/cleanup path for owned files and processes, preserving user projects and
host configuration. Apply the existing public-source export policy to new files;
source adoption, export and package publication remain separate operations.

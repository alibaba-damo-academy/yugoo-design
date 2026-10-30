# Host compatibility and installation entry points

English · [简体中文](hosts.md)

Yugoo Design connects to existing Agent applications as a plugin. The host provides models, credentials, tools and native Agents; the shared design runtime and UI manage Design Projects and Panels. Before installing, check which features the current version supports in your host.

[Getting started](getting-started.en.md) · [Preview status](preview-status.md) · [Troubleshooting](troubleshooting.md)

For installation and updates, see [Host integration entry points](../../packages/companion/HOSTS.md). The sections below describe each host's interface, entry points and tested versions. A CLI and a desktop application with the same name may have different support scopes.

To disable or uninstall, use the [removal entry point for your host](../../packages/companion/HOSTS.md#disable-uninstall-and-retained-files). Distinguish native registration, a separate MCP connector, the shared runtime and user projects; there is no universal uninstall command for every host.

The default path is to copy the [same universal installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host) and let the current host's Agent choose the route. You can specify a host explicitly when needed. An existing installation can be reused if it meets the required exact version, adapter and runtime conditions; refreshing a host does not require obtaining the same package again. When a new version is needed, obtain it from npm into a separate long-lived directory.

The unified product package and CLI are both `yugoo-design`. The first stable release, `0.1.0`, is available on npm. If the required version is missing, stop installation rather than falling back to the old `@yugoo-design/companion` package or `beta` channel. See [release status](preview-status.md#current-release-and-use) for historical releases, candidates and host tests. After obtaining a new package, you still need to register or import it, enable it and reload the host, then check the actual version and whether Panel saving works.

Everyday entry points vary by host: DSH uses `/yugoo` subcommands; Codex uses `$yugoo` or its skill picker; Claude Code/Qoder use the installed plugin's `/yugoo-design:yugoo`. In QwenWork and WorkBuddy, select `yugoo` through the native skill entry point and request project operations in natural language. Do not assume every host can directly parse DSH's full set of slash-command arguments.

## DeepSeek Harness

- Interface: an embedded Design Panel. Studio source also has inspection and authoring entry points; see [Studio status](preview-status.md#studio-source-capabilities-and-installed-acceptance) for current acceptance boundaries. Other desktop hosts have their own support scopes; an application's desktop name does not establish equivalent capabilities.
- Installation: the [DSH-specific prompt](../../packages/companion/HOSTS.md#install-or-update-deepseek-harness) and [DSH installation guide](../../packages/dsh/README.md#candidate-npm-installer-dsh-route-and-recovery-limits). The local workspace route is for prerelease preflight.
- The current DSH guide targets official Web/Desktop `0.2.0-rc.2`. Read existing candidate records for actual installation, generation, saving and consumption by the original Agent within their exact host and artifact scope. The early `0.1.2-rc.1` route remains a historical record.
- The DSH aggregate package and internal modules use the exact mappings in the obtained product package's `release-hosts.json`, rather than selecting the highest registry versions. An old release's mappings do not describe the current product's version combination.
- DSH manages models, search and user configuration. The plugin connects through public extension points.

See the [DSH guide](../../packages/dsh/README.md) and [preview status](preview-status.md) for candidate installation and feature verification scope.

## Codex CLI

- Interface: Companion UI bound to the native session.
- Installation: the [Companion guide](../../packages/companion/README.md), following its Codex plugin/registration route.
- Native-session identification, execution and message return depend on the actual Codex version; registration commands for other hosts do not apply.
- The persistent installer in current source accepts `codex-cli 0.160.0` and `0.162.0` on Linux x64. It stops and reports other versions or platforms as unsupported. Before installing, check eligibility in the obtained version's [registration transaction notes](../../packages/companion/README.md#persistent-registration-transactions). Desktop on macOS arm64 has a separate route.
- Codex Desktop has a separate integration entry point on macOS arm64, using bundled plugin preparation and native host activation. See the [Mac Codex Desktop guide](../../packages/companion/hosts/codex-desktop/README.md).
- Support for Codex Desktop design sessions on macOS arm64 does not establish that all Studio authoring and KAG display capabilities have been verified in the same installed version. Check generation, saving/reopening and reading by the original session separately for the installed version; source screenshots do not establish availability.

After installation, follow the [first collaboration steps](getting-started.en.md#3-create-a-design-project) to create a project, request a result, and check saving and continuation. For native integration and execution limits, follow this candidate's [Companion guide](../../packages/companion/README.md).

## Claude Code CLI

- Interface: Companion UI bound to the native session.
- Installation: the [Companion persistent registration guide](../../packages/companion/README.md#npm-candidate-and-native-installation-boundary).
- Register the supplied candidate through the guide's `yugoo-design install --host claude-code` route. Start the host normally, then use the installed Design skill.
- Current testing covers Claude Code CLI; desktop integration has not been tested.

After starting normally and confirming the installed entry point, follow the [first collaboration steps](getting-started.en.md#3-create-a-design-project) to check the project, Panel saving and continuation in the original session. Check persistent registration, existing processes and execution limits against the candidate guide above.

## Qoder CLI

- Interface: Companion UI bound to the native session, using Qoder's model and native Hooks.
- Installation: the [Companion persistent registration guide](../../packages/companion/README.md#claude-code-and-qoder-cli-persistent-native-registration). From the supplied candidate's npm installation directory, follow the guide to register natively with `yugoo-design install --host qoder`.
- After registration, start Qoder CLI normally and use `/yugoo-design:yugoo` in the session. Restart a host that is already running to load the registration. For the temporary plugin-directory route from a source build, see the [Qoder CLI preview guide](../../packages/companion/README.md#qoder-cli-preview).
- Recorded native-process binding and Hook verification covers Linux/WSL with Qoder CLI `1.1.48`. Verify other platforms, versions and background capabilities separately for each candidate.

## QwenWork (千问办公)

- Interface: full Companion in the system browser, connected to QwenWork's native session.
- Installation: the [QwenWork-specific prompt](../../packages/companion/HOSTS.md#install-or-update-qwenwork). Prepare the expert suite from the exact npm package already obtained, then follow the [desktop preparation guide](../../packages/companion/README.md#desktop-npm-package-preparation) to import and enable it in the native UI. The default ZIP includes the MCP connector. The separate JSON is an alternative when organizational policy permits; enable only one `design-system` connector. Enabling the Skill does not establish that tools are connected.
- Prepare the preview runtime and required Node environment using the bundled guide. Desktop input depends on version-specific host settings. In ordinary Hook mode, you may need to return to the original session to continue; do not mix the two modes.
- Historical verification: Windows local preview with the QwenWork `1.2.5` series and Yugoo Design suite `0.2.0`. Initial-session identity, tool connection, opening the system browser and message round trips were verified for those versions.
- Historical limits: the 2026-10-11 record still had delays in send confirmation and history echo, with continuation after saving, KAG and full design execution awaiting acceptance. Those results do not replace item-by-item acceptance of the later `1.3.2`. See [review fallback](#background-capabilities-and-review-fallback) below for current foreground GRA conditions. QwenWork does not use WorkBuddy's embedded-panel route.

The installation materials' `hosts/qwenwork/README.md` records preparation steps and version limits. Keep the host identity “千问办公（QwenWork）” in the UI and responses; the plugin's name is **Yugoo Design**.

## WorkBuddy

- Interface: the host's `present_files` automatically opens an embedded Panel preview; full Companion can also open in the system browser.
- Installation: the [WorkBuddy-specific prompt](../../packages/companion/HOSTS.md#install-or-update-workbuddy). Prepare the stable marketplace package from the exact npm package already obtained, then import and enable it using the [desktop preparation guide](../../packages/companion/README.md#desktop-npm-package-preparation). For upgrades, first Refresh the market, confirm the catalog version, then Update the installed suite. Reload the host normally or open a new session as prompted, and check the version and tools actually loaded.
- Historical verification: Windows local preview with the WorkBuddy `5.7.x` series and Yugoo Design plugin `0.3.20`. The corresponding preview iterations have actual records for tool and identity binding, main-session and serial native Producer execution, automatic Panel opening and message return, reading saved content in the original session, history and KAG.
- Later user feedback for WorkBuddy `5.8.3` confirms that foreground manual GRA is available, while a background experience that leaves the main conversation free has not been achieved. See [review fallback](#background-capabilities-and-review-fallback) below. Nested Workers remain unavailable. The host controls the embedded preview's toolbar and address bar; this does not promise a separate built-in browser tab with an address bar.

The installation materials' `hosts/workbuddy/README.md` records exact installation and verification scope. A visible page, a connected session and saved content read by the Agent are different states; check them separately using [troubleshooting](troubleshooting.md).

Upgrading and reopening: after obtaining a new npm runtime, update the host installation materials and reload the host. Successful material preparation does not mean the running session has changed versions. Retain the old runtime and receipts; follow the adapter's procedure using a higher suite version and the previous successful receipt. Do not hide an old session or market catalog behind repeated installations. After reopening, check `yugoo`, tools, the original Design Project, Panel saving and reading by the original session.

## Background capabilities and review fallback

In the inspected Windows QwenWork `1.3.2-26101704`, desktop integration disables background Agents, and no supported user switch was found. An ordinary restart or changes to the system environment or `.env` are not recovery methods, and the host program should not be modified to bypass the limit. See the [QwenWork integration guide](../../packages/companion/hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy) for the technical reason.

WorkBuddy `5.8.3` behaves differently: tested asynchronous reviews queue ordinary messages until GRA finishes. Although the causes differ, review occupies the main conversation in both tested routes. You can choose:

- **Turn off automatic GRA:** use the `off` policy to stop automatic scheduling; manual review remains available.
- **Review in the main conversation this time:** after confirming that it will occupy the conversation, ask the main Agent to review from the Grounding, Reflection and Alignment perspectives. This does not require forcing a synchronous sub-Agent or enabling a permanent automatic synchronous policy.

Without a choice, do not change the policy or start a review. When the host can run in the background without occupying the main conversation, manual reviews still use asynchronous execution. Otherwise, a manual request also requires confirmation of synchronous execution for that review.

Foreground review in QwenWork and WorkBuddy occupies the main conversation. Check the entry point against [foreground review availability](preview-status.md#foreground-review-availability) and the current installed-version guide. After review, the user still decides whether to accept suggestions and revise the design.

The main Agent reports U/S/T clarity assessments; KAG has its own projection and maintenance flows. Neither depends on GRA's background capability, so investigate problems separately.

## Other hosts

For other host adapters, follow the versions, configuration and limits in the [Companion guide](../../packages/companion/README.md). For an unlisted host or version, first check its documented execution mode, continuation after saving and background capabilities.

## How to read compatibility notes

Compatibility needs to specify the plugin candidate, host version, platform, presentation and actual feature together. Foreground Bundles, nested Workers, background GRA and KAG may have different support states.

For Codex Desktop on macOS, use the accepted arm64 scope above. Check the installed-version guide separately for other macOS hosts, architectures and features. Node.js running on a platform does not establish equivalent host integration or UI functionality. See [preview status](preview-status.md) for installation and feature check results by version.

Host badges on the home page link to the corresponding entries here.

For integration structure, adapter code and verification boundaries, see [Host integration entry points](../../packages/companion/HOSTS.md).

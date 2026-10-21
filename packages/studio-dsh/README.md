# DSH Studio adapter

The official DSH distribution sets `followInstalledSources: true`: Bundle reads
use the current installed catalog's `sourceRoot`, so automatically discovered
Kits need no second `kitSources` registration. Each read uses one catalog
snapshot and only the requested Bundle's owning sources. An unavailable source
returns `studio.source_unavailable` without breaking healthy Kits. The original
explicit `kitSources` mode remains available with its strict startup validation.

`dsh-design-studio-dsh` is the DSH-only adapter around the host-neutral read-only Studio application and shared `StudioWorkspace`. It owns the session-free `studioManagement` Typert Remote, a root-scoped Settings launcher, and the plugin-owned `/design-studio/` full-page route. It does not change the Agent loop, Design Project selection, Design Files, or G/R/A services, and it persists nothing: Studio 1.0 has no durable record, no working copies, and no mutation endpoint.

The Remote exposes exactly six read methods: `workspace`, `readKitWorkspace` (exact `name@version` pin required; a diverging response identity diagnoses), `readKitFiles` and `readKitFile` (the same exact Kit pin), `readBundleWorkspace`, and `readBundleFile`. Kit file inspection includes `kit.yaml`, `mindset.md` and other authored files beneath the selected Kit root, excluding `.git` and `node_modules`; the text viewer accepts regular UTF-8 files up to 1 MiB, with bounded tree traversal. Missing sources, forbidden paths, binary content and oversized files diagnose rather than falling back to another version. The catalog snapshot projects `ctx.design.listKits()`. Bundle source reads run through `ctx.fs`: the `kitSources` config lists installed content packages (`packageName`, resolved like the Design Core kit-loader) or absolute directories (`root`); every path resolves through the filesystem capability and must stay canonically contained in a configured root, so traversal and symlink escapes never read outside the authored trees and non-UTF-8 content diagnoses as binary. Invalid or ambiguous configuration — a missing root, a root without `mindset.md`, a relative path, a duplicate root, or one Kit/Bundle name declared by two roots — fails loud at startup. Without `kitSources` the catalog stays readable and Bundle reads diagnose `studio.source_not_configured`. Disposal rejects new work and drains admitted calls.

Strict codecs follow the current Typert `create(): TypertSchema` factory contract.
The existing Zod validators supply that parser capability; both Host registration
and the same-origin page transport consume the same descriptor. Only the two
optional Bundle-version parameters permit omitted wire fields; required fields,
invalid types and strict result validation retain their original constraints.

The Settings surface presents the read-only Studio's scope and opens the plugin-owned same-origin route `/design-studio/`. HTTP(S) Web uses a separate `target="_blank" rel="noopener noreferrer"` page and retains the conversation tab. On the official Desktop application's exact `dsh-app://app` authority, the launcher navigates in the current window: Desktop rejects new windows on its application protocol. The Desktop Studio page adds a compact **Back to conversation / 返回对话** link to the same-origin application root `/`, without changing the shared `StudioWorkspace`. It never consumes a `returnTo` parameter, referrer, private boot API, backend port, or copied credentials. The host owns conversation and Panel restoration when its application reloads; source and adapter tests do not establish that native round trip.

G/R/A loops publish independently and therefore expose no atomic-set size preference here. The route is registered through the public `webServer.register` seam (exact slash-less redirect plus prefix) and withdrawn on disposal. It serves one HTML shell and one self-contained page bundle. That bundle calls only the session-free `studioManagement` read methods through a narrow same-origin `/api` adapter; on Desktop, requests remain on `dsh-app://app` even when the custom scheme reports an opaque (`null`) origin, using the host's existing protocol proxy. It does not start the DSH SPA module loader, client plugin runtime, connection registry, commands, or goals. The adapter validates the gateway response and the generated Typert result before rendering the unchanged shared `StudioWorkspace`. Page disposal only unmounts the rendered root. A future Codex or Claude Code companion server serves the same page bundle and implements the same JSON read methods rather than introducing another Studio format.

The standalone page bundles its React runtime and fails the build on unresolved
dependencies or remaining static/dynamic module imports. Its page-route test also
checks the emitted JavaScript with the shared loader analyzer and exercises real
bundler rejection cases. These checks establish browser module closure; rendered
Host interaction remains a separate integration check.

Only the standalone browser page injects `PanelSelect` and
`PANEL_SELECT_MENU_CSS` from the isolated public `dsh-design-panel/select` into
Studio's optional neutral choice-control port. This is a shared control and popup
style, not the broad provider API or Panel/DSL workspace renderer. The server,
Settings launcher and transports retain their existing dependency boundary.
The menu snapshots Studio's semantic
tokens and fonts; inside an open native dialog it stays within that dialog's top
layer, otherwise it uses the owning document body. These source changes do not
establish installed Web/Desktop interaction acceptance.

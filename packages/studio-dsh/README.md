# DSH Studio adapter

The official DSH distribution sets `followInstalledSources: true`: Bundle reads
use the current installed catalog's `sourceRoot`, so automatically discovered
Kits need no second `kitSources` registration. Each read uses one catalog
snapshot and only the requested Bundle's owning sources. An unavailable source
returns `studio.source_unavailable` without breaking healthy Kits. The original
explicit `kitSources` mode remains available with its strict startup validation.

`dsh-design-studio-dsh` adapts the shared Studio to DSH. Its integrated page owns
the session-free `studioManagement` inspection Remote, a Settings launcher
and the plugin-owned `/design-studio/` route. Settings opens catalog and source
inspection. Host-prepared creation and editing links open the same shared
Studio workspace with an explicit native Session locator;
when the trusted authoring service is enabled, users can open the current library Kit or Bundle, ask AI for a proposal, review
it and save in place. Explicit Copy creates an independent identity.
The bounded native factories and their activation requirements follow below.

Native authoring follows the shared [editor-level save contract](../studio/README.md#edit-current-content):
successful saves are readable by another process or a reopened application;
process interruption preserves complete old or new snapshots, write failures
are reported, and stale revisions cannot overwrite newer edits. This is not a
power-loss durability claim or a guarantee against loss of the latest save in
an operating-system crash.

Private directories use POSIX ownership, permission modes and directory sync
on POSIX. Windows uses inherited user-directory access, physical path and file
identity checks, file sync and no-clobber reference publication. Both retain the
existing JSON format and editor-level save boundary. The shared working-copy
save algorithm has no directory-sync prerequisite. Windows reference-store
component checks pass under actual Windows Node; working-copy save/reopen,
host conversation and installed-package acceptance remain separate checks.
The official distribution mounts the authoring service through its separate
Loader row; inspection remains independently available. Unix permission-bit
emulation, a native access-control helper and SQLite are not prerequisites.

Configured projects run from their own complete current `design_kit/` tree,
with the Kit in `kit/` and mounted Bundles in `bundles/`. The trusted Studio
Host registers one current-library source port for initial project copies;
project-local definitions are never registered in the global catalog. Library
changes affect future projects. An Agent can compare and apply changes to an
existing project through ordinary file editing, validation, saving and Git.
There is no content release, local version switch or mandatory upgrade flow.

`editCurrent` is a strict parent-scoped JSON operation over the same S2 store.
`captureKit` and `loadKit` remain trusted Host-only capabilities: their source
filesystem functions never cross the browser RPC. Old Kit/Panel draft
confirmation and fork routes are removed.

## Native authoring adapter

The optional `dsh-design-studio-dsh/authoring` entry exports
`createStudioAuthoringAgent(ctx)`, exposing `start`, `observe`, `resume` and
`dispose`. A start request supplies the exact live native parent, an isolated
workspace, the host-bound instance revision and allowed paths, and the shared
Studio `read`/`prepare` capability. The SDK child inherits the parent's model
route and receives only those two tools. Candidate receipts are available through
`onPrepared` or `readPrepared()` for the existing Studio review/save path.

Each run retains its native session, message and turn references separately from
its local invocation and epoch. Observation checks actual consumption and the
matching turn outcome. Cancellation fences the owned handle and expected turn;
explicit resume first observes the retained session and requires a new prompt.
Callers retain references before dispatch and keep unknown delivery pending
instead of automatically resending it. Candidate availability and native turn
completion are separate observations.

Every `studio_authoring_prepare` call starts from the bound saved revision and
replaces the whole previous unsaved proposal. Calls do not accumulate changes.
To correct diagnostics, the native author resends all still-intended unsaved
complete-file replacements, including files unchanged since its previous proposal.
During the same request, later candidates and their diagnostics replace a pristine
displayed proposal. Human source, title or mount edits retain the current editor;
**Review latest changes / 审阅最新建议** uses its ordinary discard confirmation.
An in-flight or unverified save prevents replacement. Saving still requires the
existing exact candidate validation and verified receipt.

The focused SDK tests use an explicitly selected official SDK graph with a
scripted model, injected S3 ports and memory persistence. They cover the adapter's lifecycle and tool
boundaries; real model two-round authoring, filesystem durability, page wiring
and installed-host acceptance require their respective integration checks.
With an existing official archive selected through `DSH_TEST_ASAR`, run
`pnpm --filter dsh-design-studio-dsh test:authoring-agent`. The alternative
`DSH_TEST_WEB_ANCHOR` selects an existing official Web SDK graph; supply one
of these paths, keeping its configuration and credentials unchanged.

The optional `dsh-design-studio-dsh/authoring-session` entry exports
`createStudioAuthoringSession({ ctx, parent, instances, readComponents,
workspaceRoot, retainReference })`. It composes the same native adapter with
`dsh-design-studio/node` read/prepare capabilities over the caller's existing
instances. Start selects an exact working-copy revision and an initial source
reading focus. Legal reads, full-file replacements and new files remain bound to
that same Kit or Bundle; the initial paths are not an editing whitelist. Bundle
source uses its exact pin; Kit-owned source can omit a preview Bundle, while a supplied preview pin must match an explicit mount. The
factory retains the native address before dispatch and returns a typed
`{ request, candidate }` for the shared review UI. Saving remains an explicit
call to the existing instance service, using its candidate digest and revision.
Cold references permit observation; cancellation requires an exact owned run.

Kit candidates without a preview Bundle use the shared Core definition validator
and carry no Panel preview. Their explicit validated save rechecks the same exact
source and mount closure, returning `definition_passed` through the strict Remote
codec. Bundles with omitted presentation or `presentation.mode: none` likewise
receive `definition_passed` after Core definition validation, without a Panel.
Declarative Bundle candidates and explicit Kit previews retain `preview_passed`
and their real Panel/sample checks. Empty-mount or otherwise invalid Kit definitions
cannot receive a validated receipt; an explicit draft save can preserve unfinished
source. Neither receipt proves native turn completion or publication.

With the same official SDK archive selection, run `test:authoring-session` for
the bridge's scripted native execution and real temporary instance storage
checks. These exercise two explicit revisions, user save and fresh service
reopen, alongside conflict, parent identity, cancellation and disposal guards.
They do not establish real-model, browser or installed-host acceptance.

The optional `dsh-design-studio-dsh/authoring-reference-store` entry exports
`createStudioAuthoringReferenceStore({ stateRoot })`. Choose an explicit private
host directory outside installed content and Design Projects. The store owns
only its reference subdirectory and retains exact native addresses and source
scope, with explicit-parent `read` and bounded `list` methods. Its `retain`
function can supply the session factory's `retainReference` callback. It stores
no execution status, candidate or design content; native observation and shared
Studio working copies keep those responsibilities.

This entry also exports `prepareStudioAuthoringDirectory(path)` for an owning
Host to prepare a private storage or workspace leaf. It requires an absolute
canonical path with existing physical ancestors, creates only that leaf and
verifies platform-appropriate access and identity without repairing permissions.
On POSIX it syncs the leaf and parent before returning; Windows checks their
physical identities and retains inherited access. Failure can leave a valid
empty leaf for an explicit later attempt. It creates no reference namespace or
native session.

The reference store verifies physical paths and file identity on both platforms,
with POSIX ownership and directory-sync checks where supported. Files that
require sync use a writable handle on Windows; observation remains read-only.
These checks do not establish a power-loss guarantee or make directory flushing
a prerequisite for ordinary working-copy saves. A failed
retention can leave an already published address, so callers must reconcile it
rather than infer absence or resend. A cold reference supports observation; it
does not restore S4's owned cancellation handle or prepared-candidate projection.
Run `test:authoring-reference-store` for temporary-filesystem fault and reopening
checks. These checks do not simulate power loss or establish actual Host restart
recovery. The session-free inspection service does not use this store.

The optional `dsh-design-studio-dsh/authoring-sources` entry exports
`createDshStudioInstanceAdapters({ design, fs })`. A trusted Host supplies its
existing Core registry and public DSH filesystem service. The factory resolves
independent Bundles by exact pin and retains their registered `sourceId`; Kits
use the exact Kit resolver, including retained older versions. Missing sources
or mismatched pins diagnose instead of selecting a newer version.

Source capture preserves binary assets, original text bytes, methods and notices
through bounded `fs.readBytes` reads, excluding `.git` and `node_modules`.
Containment stays with the public filesystem service. Known listing, stat and
byte-length disagreements reject the capture; these checks do not provide an
atomic snapshot of the whole installed tree. The returned catalog and composition
ports feed the existing shared Studio instance service, which owns compilation,
snapshots and saves. The caller chooses its private storage separately.

Kit mount choices preserve the shared optional `description` and bilingual
`displayDescription` through the strict instance codec. Both come from the same
installed or retained Bundle source projection; older choices may omit them.
The codec still rejects unexpected fields and malformed translated copy. Choice
labels and descriptions do not enter mount requests: those retain their existing
exact pin and revision checks.

The shared catalog still compiles every independent Bundle when listing choices.
Consequently, Kit working-copy copy/read can fail on an unrelated broken
independent source, even when exact capture of that Kit succeeds. This adapter
preserves that shared policy. Page navigation does not activate a Host through
this entry. Run `test:authoring-sources` for the explicit
filesystem-port fixtures with real Core compilation and temporary Studio
copy/reopen checks; actual DSH filesystem, native model and installed-host
integration require separate checks.

The optional `dsh-design-studio-dsh/authoring-remote` entry exports
`createSameOriginStudioAuthoringClient({ agentId, fetch? })`. It supplies the shared
instance client and asynchronous native start, resume, observation, cancellation,
prepared-candidate and retained-reference calls over the existing same-origin
Studio transport. The explicit SessionId is a locator for the Host's actual
native Agent lookup. Native operations accept only `{ sessionId, epoch }`
addresses; the enabled Host service must resolve their retained canonical scope.
Unknown fields and malformed results reject, and failed requests are never
automatically resent. Source preparation and native completion never save files.

These strict descriptors and transport primitives do not register or activate an
authoring service. Run `test:authoring-rpc`
for JSON/request correlation, parent locators and real temporary instance
copy/candidate/save/reopen through the transport fixture. Fixture HTTP replies and
native references do not establish real Gateway lookup, Host authorization or
installed-page acceptance.

The optional `dsh-design-studio-dsh/authoring-host` entry exports
`createDshStudioAuthoringHost({ ctx, design, fs, stateRoot, workspaceRoot,
readComponents })`. It composes the existing source adapters, one shared
instance service, private reference store and native session factory. The owning
Cordis service declares `agents`, `sessions` and `sessionQuery` dependencies
alongside `design` and `fs`, supplies explicit private storage and an isolated
workspace, and reads the actual installed component catalog.

`forParent(actualAgent)` binds the exact live native object and returns guarded
instance operations, retained-reference reads and native authoring methods.
Kit-owned source authoring does not require a mounted Bundle. The selected paths
must exist as editable files in that exact Kit working copy; a supplied preview
pin must still match one of its mounts. Native Panel preview remains conditional
on that explicit Bundle pin.
The same object reuses its facade; a same-ID replacement can observe retained
addresses but cannot inherit old cancellation or prepared-candidate handles.
Instance records remain shared Host data. Only the existing explicit instance
save changes source. Disposing the Host or parent facade closes admission,
releases native work and joins admitted I/O; an already committed save can still
need reopening after a disconnected response. Page/request teardown must not
dispose this Host-owned facade.

The owning service tracks initialization before awaiting it and joins its
settlement during unload. A rejected creation can leave valid private metadata;
it does not make a usable native session available. Run `test:authoring-host`
with the same official SDK selection for composition, failure and lifecycle
checks using scripted native execution and actual temporary source/reference
storage. Fresh service reopening in these checks is distinct from a real Host
restart. This entry does not register an authoring Remote or change the page.

The optional `dsh-design-studio-dsh/authoring-service` entry exports
`DshStudioAuthoringService`. A trusted Host explicitly activates it with
`ctx.plugin(DshStudioAuthoringService, { stateRoot, workspaceRoot })`, supplying
private canonical storage and an isolated workspace. Its public dependencies are
`design`, `fs`, `agents`, `sessions`, `sessionQuery` and `tools`. The package's existing
`./typert` contribution declares both the six inspection operations and the 22
agent-scoped `studioAuthoring` operations; register that contribution once.
The Service forwards them to the composed Host and projects the shared Core
component vocabulary. The Gateway resolves each SessionId locator to the actual
Agent before invoking the Service. A browser-supplied reference cannot replace
the Host's retained canonical scope.

The Service registers shutdown before asynchronous initialization, joins the raw
factory promise on unload, and closes native admission before draining calls.
It validates and snapshots request data before queued admission, so later caller
mutations cannot rewrite a submitted save or native request.
Start and resume return retained addresses without waiting for native completion;
prepared candidates still require the existing explicit review and save. Page or
request teardown does not dispose the Service. Run `test:authoring-service` with
that official SDK selection for real Gateway lookup, Service lifecycle and
native prepare/explicit-save/reopen checks. These use a scripted model, memory
session persistence and explicit filesystem/connection fixtures. They do not
establish HTTP authentication, real-model or installed-page acceptance. The
inspection entry and page navigation alone do not activate this Service. The
official distribution activates it through the separate authoring Loader row.

When enabled, the same Service registers `studio_customize` in the Host's tool
registry. The native conversation can discover installed pins through the
existing inspection service, copy or reopen a working copy, read its source,
prepare a diff/preview, and explicitly save authorized changes. These operations
use the same instance service, revisions, candidate digests and save guards as
the Studio page. The actual calling Agent supplies identity; tool arguments
cannot select another Agent, filesystem root or model. Preparation never saves,
and saving does not publish. No second model client or source repository is
introduced. This tool is separate from the restricted read/prepare tools given
to the page's authoring child.

Before editing, read the creator method index through `studio_customize` with
`action: "read", request: { authoring: {} }`. Read each indexed resource with
`request: { authoring: { resource, offset } }`, following every `nextOffset` until
complete. The restricted child uses the same selector in `studio_authoring_read`;
source-path reads remain separate. Both entry points receive method-reading
guidance and use one package-owned material capsule, assembled during the normal
build from the existing Bundle, Kit and Skill creator sources. The capsule is
read-only guidance, not a working copy or an additional method authority.
Unknown resources, filesystem paths, caller identities and invalid offsets are
rejected. Method pages and large component references contain at most 16 KiB of UTF-8 text.
Component references return JSON text pages; keep the selectors and follow
`nextOffset` with `components.offset` to read the complete reference; no child filesystem tool or
save capability is added. The owning service also depends on `systemPrompt` for
this native guidance. Run `test:authoring-material` for pagination and boundary
checks, and the SDK authoring tests after a normal build for both native tool paths.

For Panel composition, use the same read operation with `components: {}` to
discover the installed vocabulary. Then read `components: { name, reference }`
with the exact component name and `reference: "contract"`, `"docs"` or
`"examples"`. Follow returned contract `read` selectors, including their `type`.
This reuses Core's source-derived reference query and the same generated
`panel-components.json` as Companion, with its 256 KiB response budget. It does
not infer component parameters from names or create another DSL schema.

The parent-scoped page exposes archive export and stateless `readArchive`.
`readArchive({ source })` returns `StudioContentArchive` after format, path,
byte and digest checks. It stores no import record and does not run full
Bundle definition validation or grant executable trust. The page sends those
files through `importSources`, which preserves incomplete definitions for
ordinary editing. The old prepare/read/list/adopt archive workflow is removed.

An export accepts an exact installed Kit or Bundle request
`{ kind: 'kit' | 'bundle', pin, provenance }` or the exact saved working copy request
`{ id, expectedRevision, provenance }`. The latter derives its own Kit/Bundle pin
from S2 and exports every saved overlay, opaque resource and retained mount in
one read transaction. Stale revisions fail; installed base content is never a
substitute for the selected copy. Imports and exports retain the existing
`studio-content-archive/v1` format and validation limits. The shared UI keeps its
existing HTTP upload budget.
Installed Bundle export resolves the catalog's exact source and captures immutable
bytes through the shared archive adapter. It needs no containing Kit and creates
no working copy. The independent loader rechecks the captured Bundle identity.

`prepareChanges` preserves the S2 candidate fields and adds
`authoring: { requestId, studio: { id, expectedRevision, bundle? }, url }`.
The pin is the independent copy's actual Bundle pin, or an explicitly requested
Kit mount. The content-only URL identifies this exact receipt for the same live
parent. The Host retains at most 16 temporary receipts and 32 MiB per parent,
deduplicates identical requests, and rechecks the current source and digest on
`readPrepared`. Foreign parents, changed pins/digests, expired receipts and stale
revisions fail closed. Receipts disappear on parent/Service disposal; they are
neither persisted source nor a save authority. Reopen from the conversation to
prepare a current proposal after one expires.

The optional `dsh-design-studio-dsh/authoring-entry` entry provides a Cordis
plugin that prepares roots and mounts that existing Service. A trusted Host
may load the namespace with `ctx.plugin(StudioAuthoringEntry, config)`.
`config` accepts either or both of `stateRoot` and `workspaceRoot`. Omitted
values use the public RC2 `dshHomePath('yugoo-design-studio')` and
`dshHomePath('yugoo-design-studio-workspace')`, respectively. The Host home must
already exist as a physical canonical directory. Explicit overrides obey the
same private single-leaf preparation rules; the plugin never creates missing
ancestors or uses installed content or a Design Project as implicit storage.

The entry captures roots before asynchronous work, closes admission when its
Cordis fiber unloads, and joins both root preparation and Service cleanup.
Failed initialization preserves existing metadata and does not retry itself.
Disposing it does not dispose the parent Agent. The official distribution's
`dsh-design-studio-authoring` Loader row loads this entry; a custom Host may
activate it explicitly through the same public export. Run
`test:authoring-entry` with the same official SDK selection for private-root
and actual Cordis/Service initialization and unload checks. These checks have
no native model turn and do not accept an installed Host or Windows activation.

The optional `dsh-design-studio-dsh/authoring-workbench` entry exports
`StudioAuthoringWorkbench({ client, id, locale, onBack, onChanged,
onDirtyChange?, presentation?, preparedLocator? })`. Supply a stable parent-scoped authoring client and the
existing shared Studio shell: `.ygd-studio-workspace`, `STUDIO_WORKSPACE_CSS`
and `.ygd-studio-body`. The component reuses the shared instance editor,
candidate review and read-only `PanelSamplePreview`. Studio is an independent
tab/browser workspace. Its default `presentation: 'full'` keeps the authoring
conversation beside the working-copy content during Kit/Bundle creation or
editing. An exact `preparedLocator` from a Host proposal opens the
corresponding candidate inline in the existing working-copy Files view once its
parent, source, pin and digest are checked. It requires no second review-selection
click. The same `InstanceWorkbench` and complete file tree remain mounted.
Review opens a changed file inline; a verified save keeps that file selected. Revert dismisses unsaved suggestions
without writing; a contextual action can reopen them. Only explicit Save writes
through the existing S2 client.
A candidate URL enters the same complete editor and carries
`studioTarget`, `studioRequest` and `studioDigest` alongside its parent locator;
the Host validates them again. A Kit target without an explicit Bundle opens
its source without selecting the first mount.

New blank Bundle working copies can request native source authoring while their
definition is unfinished, including after a draft save and reopen. The exact
source revision, Bundle pin and editable paths still bind the request. Candidates
follow ordinary Core preview validation and explicit save rules; unfinished
candidates remain ineligible for a validated save. Other Bundle copies keep the
current-preview preflight.

The left conversation and the same right-side working
copy stay mounted while source changes appear inline. Kit source candidates use
the source view; Bundle content can open on its Panel preview, with source editing
available through the same editor. The left side retains
submitted intents, public native replies, tool actions and their observed outcomes,
candidate/save feedback and unsent input during review and return. Companion and
Studio reuse the same message and collapsible activity components. Observation
reads the exact native request epoch, excludes private thinking and replacement
compaction messages, and returns at most the latest 200 rows with an omission count.
This is a bounded projection, not a second durable history store. It uses
the existing parent-scoped native port without adding another model client.
The original Host may prepare a proposal before opening Studio, or guide the user
to open it first. Both paths keep the same copy, editor, inline changes and
explicit save controls; later requests do not require a separate review page.
An explicit `presentation: 'content-only'` remains a compatibility input, not the
default or a new embedded-Host workflow.
It accepts Kit and independent declarative Bundle copies, including incomplete
source without a valid Panel preview. The initial read selects up to 64 editable
text files; further reads and changes use the existing per-call limits. Kit-owned
source can validate independently of a Panel selection. An explicitly supplied preview Bundle must match an exact mount;
mount declarations retain their existing management/save guards. Dirty source
stays mounted and blocks dispatch/review;
a current owned candidate appears inline automatically only when the working
copy is clean and its exact base revision still matches. It needs no first
review-selection click. Revert restores manual editing, and the same candidate
does not reopen automatically on the next poll; a new request or candidate may
open once through the same guards. Explicit save retains the shared
revision/digest check. An uncertain save permits read-only Refresh without
claiming a verified save or retrying the write. Native execution, candidate availability
and saved source have separate feedback. An unknown response permits read-only
checking; a connection change retains input and requires explicit reopening.
Historical run controls are not restored by reopening. Run
`test:authoring-workbench` for React/shared-Panel and temporary S2 checks with
explicit native RPC fixtures. This component does not activate the Service or
create a native parent. The scoped page composes it inside the same shared
workspace; native model and installed-page checks remain separate.

The native client does not add a Studio link to the conversation header.
Settings remains the catalog entry; a host request to create or edit a Kit or
Bundle can return a scoped link to the independent editor. In Web it opens at
`/design-studio/?agentId=<encoded-session-id>&presentation=full`. Editing there
keeps the request conversation on the left and the same copy's source, diff and
Panel on the right; a current candidate appears in that editor without requiring
another review page. Host-prepared candidate links also enter this complete
editor with their exact revision and digest. Official Desktop retains its
compatible same-window navigation while opening the same full presentation;
this does not implement embedding Studio in the Host conversation. The SessionId
is a locator for the Gateway's actual Agent
lookup, not an authorization grant.
The page captures one locator on opening and rejects duplicates or malformed
values. Without it, the page keeps session-free inspection. Page unmounting
only releases local UI reads; it does not cancel or dispose Host-owned work.
Run `test:page-authoring` for the shared reading-to-review/save path and the
normal `test` script for built module registration and routes. These checks do
not prove a real desktop return trip or installed authoring service.

The inspection Remote exposes exactly six read methods: `workspace`, `readKitWorkspace` (exact `name@version` pin required; a diverging response identity diagnoses), `readKitFiles` and `readKitFile` (the same exact Kit pin), `readBundleWorkspace`, and `readBundleFile`. Kit file inspection includes `kit.yaml`, `mindset.md` and other authored files beneath the selected Kit root, excluding `.git` and `node_modules`; the text viewer accepts regular UTF-8 files up to 1 MiB, with bounded tree traversal. Missing sources, forbidden paths, binary content and oversized files diagnose rather than falling back to another version. The catalog snapshot projects `ctx.design.listKits()`. Bundle source reads run through `ctx.fs`: the `kitSources` config lists installed content packages (`packageName`, resolved like the Design Core kit-loader) or absolute directories (`root`); every path resolves through the filesystem capability and must stay canonically contained in a configured root, so traversal and symlink escapes never read outside the authored trees and non-UTF-8 content diagnoses as binary. Invalid or ambiguous configuration — a missing root, a root without `mindset.md`, a relative path, a duplicate root, or one Kit/Bundle name declared by two roots — fails loud at startup. Without `kitSources` the catalog stays readable and Bundle reads diagnose `studio.source_not_configured`. Disposal rejects new work and drains admitted calls.

Strict codecs follow the current Typert `create(): TypertSchema` factory contract.
The existing Zod validators supply that parser capability; both Host registration
and the same-origin page transport consume the same descriptor. Only the two
optional Bundle-version parameters permit omitted wire fields; required fields,
invalid types and strict result validation retain their original constraints.

The Settings surface presents the read-only Studio's scope and opens the plugin-owned same-origin route `/design-studio/`. HTTP(S) Web uses a separate `target="_blank" rel="noopener noreferrer"` page and retains the conversation tab. On the official Desktop application's exact `dsh-app://app` authority, the launcher navigates in the current window: Desktop rejects new windows on its application protocol. The Desktop Studio page adds a compact **Back to conversation / 返回对话** link to the same-origin application root `/`, without changing the shared `StudioWorkspace`. It never consumes a `returnTo` parameter, referrer, private boot API, backend port, or copied credentials. The host owns conversation and Panel restoration when its application reloads; source and adapter tests do not establish that native round trip.

G/R/A loops publish independently and therefore expose no atomic-set size
preference here. The route uses the public `webServer.register` seam: the
slash-less redirect preserves the query, and the prefix serves one HTML shell
and one self-contained page bundle. Packaged CSS assets have a separate owned
prefix backed by their verified manifest. Registration rolls back on failure;
disposal withdraws all owned routes.

The page uses the existing same-origin `/api` carrier for `studioManagement`
inspection and, with an explicit locator, `studioAuthoring` operations. On
Desktop, requests remain on `dsh-app://app` even when that custom scheme reports
an opaque (`null`) origin, using the Host's existing protocol proxy. The page
does not boot the DSH SPA module loader, client plugin runtime, connection
registry, commands or goals. The carrier and strict Typert codecs validate
requests and replies before the shared workspace consumes them. A future
Codex or Claude Code companion server can serve this shared page and implement
the same JSON contracts without introducing another Studio format.

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
The authoring workbench separately consumes the public
`dsh-design-panel/sample-preview` entry for a read-only sample of the selected
Bundle; it does not import Panel source or activate a native provider.
The menu snapshots Studio's semantic
tokens and fonts; inside an open native dialog it stays within that dialog's top
layer, otherwise it uses the owning document body. These source changes do not
establish installed Web/Desktop interaction acceptance.

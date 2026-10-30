# QwenWork Windows integration

## Installation and current verification scope

Use the [QwenWork installation prompt](../../HOSTS.md#install-or-update-qwenwork)
from the existing desktop conversation. Reuse a retained runtime when it matches
the selected exact release and required adapter; otherwise acquire the new npm
version in a separate durable directory. Prepare/import the suite, enable one
permitted MCP connector, then reload through the normal host entry and verify
the loaded Skill, tools, original project and saved-edit consumption. There is
no separate Companion runtime to download after this preparation.

On 2026-10-21 the user confirmed manual foreground GRA; the detailed local
beta.18 / suite 0.1.5 result on QwenWorkCN `1.3.2-26101704` is recorded in the
[host status](../../../../docs/wiki/hosts.md#后台能力与评审降级).
That does not enable native background Agents or establish acceptance of every
npm release. The earlier desktop-control setup below is historical,
version-specific evidence, not a new mandatory profile edit or custom launcher.

Package the suite (Skills and native Hooks), MCP connector configuration and shared
runtime as distinct installation concerns. The recorded local Companion beta.18
preparation used native suite `0.1.5` (`--suite-version 0.1.5`). Use the acquired
package's guide and an explicit native version; an owned update must exceed its
previous receipt's suite version. These numeric versions are independent of npm
publication and do not establish that the desktop loaded the prepared materials.
If organization policy rejects the suite's data connector, use the separate
Connectors JSON entry only when that entry is permitted. After import, check
that the MCP tools connect; enabling the Skill alone does not connect them.

The normal desktop installer emits a ZIP containing its MCP configuration and a
separate `design-system-mcp.json` with the same connector. Import the separate JSON
only when the organization permits that entry but prevents enabling the suite's
connector; keep one enabled `design-system` connector. Both point to the same
retained Companion runtime. The installer prepares these machine-specific paths
from the acquired npm package, rather than downloading another runtime.

If your organization requires a suite without a bundled connector, check the
acquired version's `install --help`. When supported, use its normal
`install --host qwenwork --separate-mcp` route to prepare the connector-free suite
and separate connector configuration. Import only the separately permitted
connector and keep one enabled connector. An older version without this option
must report the unsupported preparation step; do not invent flags or bypass
organization policy. The [packaging APIs below](#suite-packaging-for-adapter-maintainers)
are for adapter maintainers, not an extra step required of ordinary users.

The suite ID is now `yugoo-design` and the entry Skill is `yugoo`. For the
one-time rename, disable/remove the old `design-system` expert suite through
QwenWork before enabling the renamed suite, so its Hooks do not run twice.
Keep the separately imported `design-system` MCP connector: its key and tools
remain compatible. Updating a suite does not override organization connector
policy or prove MCP readiness. Reopen the same project with the new Skill;
no project migration or conversation-history deletion is required.

QwenWork opens the full Companion in the system browser; it does not use
WorkBuddy's embedded browser or MCP App connection control. Browser admission
(`local` or `token`) remains separate from exact native conversation binding.
New projects use the shared Documents default; existing project roots are kept.

`--qwenwork-events-only` explicitly selects the limited Hook mode: events may
be delivered during active execution or retained for a natural conversation
resume. Tell the user when a message in the original host is required. Do not label
that fallback as automatic user input or silently downgrade after a failed submit.

## Historical desktop-input setup: QwenWorkCN 1.2.5

These retained observations describe the earlier tested startup path. Confirm
the actual installed version and its supported setup before applying them to a
new environment; they do not establish the same startup requirement for 1.3.2.

The tested desktop user-input path requires host setup and an exact session binding:

- Start the pinned QwenWork installation with
  `QWENWORK_DESKTOP_CONTROL_ENABLED=1` in that launch's environment.
- Open Companion against the exact original conversation. QwenWork now defaults to
  desktop input; `--qwenwork-desktop` remains a compatible explicit alias.
  A startup failure does not switch to Hooks or alter host configuration.

An ordinary restart may omit the environment flag; an already running desktop
process does not acquire it by opening another shortcut. Close the application
normally before changing startup mode. Do not automatically terminate the user's
host, edit application bytes or change machine-wide environment variables.

A dedicated host shortcut is not a delivery option. The earlier launcher proposal
was withdrawn. The tested temporary launch flag remains experimental evidence,
not the normal user entry. The desktop protocol and read-only session database
mapping are version-specific, not a claimed stable public API.

Read-only inspection of QwenWorkCN 1.2.5-26092902 confirms that desktop control
first reads `QWENWORK_DESKTOP_CONTROL_ENABLED` from the host-owned
`~/.qwenworkcn/.env`, then falls back to its process environment. This provides a
candidate **preconfiguration** path that preserves ordinary host startup. It is
not yet verified through a normal restart, and the public settings documentation
does not establish this key as a supported public extension contract. Do not
silently write the user's profile or advertise this as stable support. Any approved
setup must preserve unrelated `.env` settings and define reversal of the exact
owned change; upgrades require revalidation.

Public documentation checked 2026-10-07:
[settings](https://docs.qwenwork.cn/desktop/settings),
[Hooks](https://docs.qwenwork.cn/desktop/hooks) and the
[documentation index](https://docs.qwenwork.cn/llms.txt). The Hooks page describes
enterprise HTTP callbacks from the client; it does not document an external
original-session user-input API. Public API absence from these pages is not proof
that no other supported entry exists.

## Owning implementation and verification

- [Suite packaging](../../qwenwork-package.mjs) and [native Skill](../../plugin-qwenwork/design-system/skills/yugoo/SKILL.md).
- [Native process identity](../../src/qwenwork-connection.mjs), [recorded conversation](../../src/qwenwork-transcript.mjs), [Hook events](../../src/qwenwork-hook-transport.mjs).
- [Experimental desktop input](../../src/qwenwork-desktop-input.mjs). User input and background events remain distinct.
- Shared runtime: [server](../../src/server.mjs), [knowledge](../../src/knowledge.mjs), [Windows file durability](../../../knowledge-ladybug/src/durability.ts).

KAG code and database assets are included in the existing Windows test runtime.
The historical test project's status on 2026-10-07 reported recovery failure with
`EPERM: operation not permitted, fsync`, no published snapshot, and semantic
processing configured as enabled. This is not working KAG acceptance. A shared
storage correction now passes Linux/Windows file flush checks and an isolated
Windows database rebuild, backup byte preservation and reopen check. At that
historical checkpoint, deployment to the live project and semantic indexing
remained separate outstanding gates. The older test runtime carries a Linux directory dependency manifest and no bundled
embedding model; target-platform dependencies/model availability need explicit
verification. G/R/A prepared records do not prove reviewers ran or KAG succeeded.

The QwenWorkCN native-record adapter recognizes cooperative background Agent
execution, not a guaranteed programmatic spawn API. The bounded read-only native
source comparisons cover these worker revisions:

| Native installation | Reviewed worker SHA256 |
| --- | --- |
| `1.3.1-26101419` | `1aa47f902888152a8bf81a5fc5c30ee9d928c90aae0835bcc0e0a455ac210762` |
| `1.3.2-26101704` | `d6d5833e757bde19ff67d63bdd402ccc7dba6ac991f32b30c4caca901aefd9f6` |

The consumed Hook input, desktop user-input protocol, asynchronous Agent receipt
and task descriptor retain their required shapes in the latter revision. This
source comparison is not installed-host acceptance. Prepare against the currently
running installation, not merely an older version whose files remain on disk.
After a host update, refresh its external runtime pins through the normal suite
update and reload the suite in a normal user-controlled session. Do not rewrite
an existing preparation or bypass process checks to recover a missing binding.
This is an installed-version-specific contract, not a stable documented public
extension API. The source adapter tests do not establish that the currently
running host enables background tasks.

### QwenWorkCN 1.3.2 background Agent policy

Read-only inspection on 2026-10-20 of the Windows `1.3.2-26101704` installation
found that `buildQoderWorkIntegrationEnv()` unconditionally sets both
`QODER_ENABLE_AGENT_SESSIONS` and `QODERCN_ENABLE_AGENT_SESSIONS` to `"0"`.
The desktop SDK applies this policy after ordinary process, user `.env`,
organization and additional environment input. The worker then omits `name` and
`run_in_background` from the Agent schema. No supported user control was found
in this inspected build. An ordinary restart or setting these variables to `1`
is not an established remedy; do not patch host bytes or substitute another CLI.
Desktop user-input setup above controls a different capability.

This is installed-source and call-chain evidence, not a read of the live worker's
complete environment or a successful live GRA dispatch. It does not establish a
restriction for every future release. Existing worker pins and receipt-shape
comparisons remain valid within their stated scope; they do not enable a feature
that the desktop disables.

**Manual foreground flow user-confirmed; nonblocking background remains separate:**
when background execution is unavailable or a native asynchronous run still occupies the main
conversation, first ask the user to choose **Disable automatic GRA**
or **Run this review synchronously in the main conversation**. Explain that the
second choice occupies the conversation. Until the user chooses, change no
policy and start no review. Disabling automatic GRA reuses `off`; manual review
remains available. With nonblocking background execution, manual requests stay
asynchronous. Otherwise, explicit confirmation authorizes the main Agent to
read the three shared G/R/A profiles and submit the current batch through the
existing validation and advisory-record path. It does not require a synchronous
child Agent or a fabricated native run, and does not create a permanent automatic
foreground policy. U/S/T main-Agent assessment and the KAG lifecycle remain
independent. Record fixed implementation checks separately from actual desktop
acceptance; the [user-facing status](../../../../docs/wiki/hosts.md#后台能力与评审降级)
tracks that distinction.

### Background readiness and observation

Background readiness starts unverified for every Companion connection. Only a structured
native `isAsync: true` / `status: async_launched` Agent result after that service
opened, matched to the exact original session, parent tool call, native task
descriptor and child transcript, can make it ready. A Hook receipt, Agent ID,
synchronous READY, or descriptor from an older connection is insufficient. Every
background Reviewer binding verifies its own asynchronous launch rather than borrowing a
previous probe's identity. A later synchronous fallback invalidates old readiness.
The adapter reads only the bound native session's records; it does not launch a
probe, edit settings or create a second model client.

The entry Skill, saved-edit continuation prompt and startup receipt all defer to
this live capability contract. An unverified result alone does not establish a
restriction across QwenWork releases; the inspected `1.3.2` desktop policy above
is separate evidence of its disabled capability. A ready launch in a capable
host still does not establish that the desktop
composer is free: actual acceptance includes sending a normal user message and
receiving its response while GRA continues, without cancelling its reviewers.

Native task metadata and child transcripts provide terminal observation. They
are not WorkBuddy version-1 background descriptors, and this adapter does not
assume WorkBuddy's `TaskOutput` receipt format. An unknown or unreadable shape is
unavailable, never successful completion. Until the server reports background
readiness, detached requests remain pending; they never silently substitute a
foreground Reviewer. The explicit foreground-review mode above is a separate
manual choice. Existing requests/results stay readable; foreground Bundle
execution, U/S/T and KAG are independent of background GRA readiness.

Native `isMeta` / `origin.kind: task-notification` turns and their descendants
belong to background activity, not the foreground history. A real `human` turn
restores foreground presentation. This uses native parentage and origin fields,
never the occurrence of words such as GRA in user or assistant text.

Return to the [host integration index](../../HOSTS.md).

### Message latency diagnostics

The user-facing product name is **Yugoo Design**; QwenWork keeps its own assistant
identity. For delayed messages, measure three boundaries separately: native
verification before submit, QwenWork's acknowledgement, and recorded history
becoming visible. The adapter uses the shared Windows inspection helper without
caching process identity or weakening runtime pins. The shared Companion display
path avoids redundant full Git-open checks and recovers stalled read requests.
These changes do not promise token streaming or control when QwenWork flushes its
native transcript. Do not resend automatically when acceptance is uncertain.

## Suite packaging for adapter maintainers

If the organization requires a suite with no bundled connector, call `packageQwenWorkExpertKit` with
`{ includeMcp: false }` and write `qwenWorkConnectorConfiguration` to the connector
JSON supplied to the user. The suite ZIP then contains no `.mcp.json`; its Hooks
and Skill point to the exact persistent runtime. Store installed runtime assets
outside the operating-system temporary directory. This packaging does not edit
the user's installed suite, connector or host profile.

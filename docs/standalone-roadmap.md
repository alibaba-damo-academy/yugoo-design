# Standalone Design System roadmap

This roadmap delivers the [Design System architecture baseline](system-design-baseline.md). It reports implementation order and does not redefine the baseline's ownership or extension rules. Release acceptance must bind to one integrated source revision and its retained verification evidence; historical internal delivery waves are not a current capability or acceptance claim.

## Repository and package ownership

`dsh-design-system` is the superproject. Its `deepseek-harness/` submodule pins an official Harness `master` revision used as a read-only compatibility target for integration tests; Design System work does not patch that submodule. `dsh-design-system-dsh` is the sole DSH installation distribution. Harness represents it as a Profile Bundle, which is distinct from a Design Bundle. Its dependencies carry the internal runtime, browser, official Kit, declarative authoring, and Studio modules. Kit packages remain host-neutral content sources and never become additional Profile Bundles.

That submodule describes the development repository only. The public plugin
repository excludes the host application and its gitlink; integration tests
obtain the pinned official host separately. It is not a plugin install step.

The release installation target is one host-Agent-led guide and a pinned npm
entry for DSH, Codex, Claude Code, and other verified hosts. The user-facing
workflow is shared; native registration is selected by the active host and may
use different commands. GitHub supplies the public source, not a prerequisite
development checkout or a bundled host application. Host model and search
configuration remain host-owned. Package download, registration readback, and
MCP discovery do not replace an actual installed design-cycle acceptance test.
This target does not claim that every host adapter or production installation
route is currently enabled.

## Kit lifecycle

A content source declares a Mindset, Bundle definitions, and structured Kit bindings. The Kit compiler resolves exact Bundle versions, loads the conditional slots required by each presentation and execution profile, validates the complete dependency closure, and produces an immutable Kit version. Publishing a valid candidate atomically replaces the installed latest version; a failed candidate reports its diagnostics and leaves the last good version active.

Installed catalog updates and active-project updates are different operations. A new Design Project selects the latest Kit version. An active project remains pinned to the `{kit: {name, version}}` recorded in `project.json` and its Git checkpoint until the user upgrades it. Upgrade revalidates editable working copies and Design Files against the candidate schema, checkpoints the new pin on success, and fails without discarding working-copy changes when migration is unsafe.

Kit source changes, including Mindset Markdown, skills, schemas, validation rules, resources, and panel DSL, are eligible for restart-free version reload. Each validated version replaces the latest registry entry atomically, but several source-file writes are not one transaction and can publish independently valid intermediate versions. Runtime plugin code and new compiled browser component packages remain restart-required in production.

## Frontend extension levels

1. A content Kit composes the approved declarative component library. This is the default customization path and supports restart-free validated version reload.
2. A trusted provider plugin registers reusable platform components and renderers through the Harness client-plugin mechanism. It is compiled, reviewed code rather than Bundle-local JavaScript.
3. An isolated panel application is deferred. It becomes eligible only when real third-party requirements cannot be expressed through the first two levels; it would require a versioned iframe RPC, capability allowlist, theme bridge, and save adapter.

The authoring application must call the same Kit compiler, validation rules, panel interpreter, and save adapter as the runtime. Preview and deployment cannot define a second Bundle format.

## Host integrations

The Portable Kernel owns Host-independent Design Project, Kit, Bundle, validation, execution, journal, knowledge, advisory, and UI behavior. A Host Provider owns only identity, tool and command registration, model-context delivery, human questions, subagent access, workspace grants, and panel transport. DeepSeek Harness is the initial Host Provider integration and embeds the shared Design UI in its Web client through official extension points. This implementation description does not establish clean-install, complete design-cycle, or desktop acceptance; those gates must pass against the final candidate without modifying official DSH.

Host portability requires a shared Design System journal, a plugin-owned durable binding store keyed by opaque Host conversation identity, and explicit ports for model-context delivery, tool registration, human questions, subagent execution, panel transport, and workspace location. Host-specific transcripts remain execution records rather than authorities for Design Files or accepted design decisions. A cross-host conformance suite must run the same project binding, Kit activation, design write, panel save, version pin, validation, and continuation scenarios against every Host Provider.

The DSH Provider maps those ports to `agent.inject()`, `ctx.userQuestions`, `ctx.subagents`, Cordis commands and tools, package-owned `dsh.client` modules, and Design System Remote services. Codex and Claude Code providers begin by discriminating capabilities exposed by the installed Host version. They may use MCP, Skills, hooks, commands, native questions, native subagents, or a companion browser only after proving that capability; they do not claim a programmatic API that the Host does not publish. Foreground Bundle execution stays attached regardless of delegation tier. A missing detached-subagent capability selects cooperative or unavailable background execution only for G/R/A advisory profiles while preserving the same Kernel advisory and settlement semantics.

## Delivery sequence

### 0. Recoverable extraction and installation

- Preserve a verified plugin source snapshot and initialize the independent public repository without the DSH application or a host submodule. Pin and verify the official Harness separately as a development and integration-test target.
- Package the Web App Kit as host-neutral `designSystem.kit` content with package-addressed runtime loading.
- Produce declarations and complete package tarballs; make `pnpm run test:release:physical-distribution` prove isolated installation without workspace or ancestor `node_modules` resolution. The linked-profile and release stages own compatibility with the pinned DSH version.
- Resolve repository ownership, package scope, version policy, upstream provenance, icon licensing, ELK distribution obligations, and the Harness release tag before publishing.

### 1. Host-conversation binding and version registry

- Move active Mindset and design-state resolution from the root service into the selected Design Project reached through the Host-conversation binding store.
- Add immutable Kit versions, durable project pins, an atomic registry swap, last-good failure behavior, and panel catalog invalidation.
- Verify two concurrent sessions with different Kits, restart restoration, valid reload, invalid reload, and explicit upgrade failure without losing working-copy changes.

The binding store uses branded Host Provider, conversation, and project identities and contains only the minimum bootstrap association needed to resolve project-owned state. The selected project's exact version pins reconstruct the active prompt, skill catalog, Design File summary, and client projection. A watched source validates observed candidates through the same Kit compiler and atomically publishes the latest valid version; an invalid candidate leaves the last published version active. Transactional multi-file source publication and a Studio publish marker remain pending. An unavailable or corrupt durable pin keeps the general Host session usable while design writes fail with an upgrade diagnostic. Serialized save/upgrade mutation and explicit upgrade UI remain in this phase.

The current Design File mutation path serializes workspace writes, validates before filesystem changes, stages explicit paths, and creates at most one Git commit. Phase completion still requires startup reconciliation of interrupted Git and DesignJournal settlement and shared read/write confinement that rejects symlink traversal beneath `design_files/`.

### 2. Declarative UI coverage

- Complete the generic manifest/runtime, workbook/workspace interpreter, `doc_lifecycle_studio`, `rowview_workbench`, residue envelope, cross-panel references, and generic save/restore path before migrating a vertical Kit.
- Make the structured Kit bindings the validated Bundle allowlist, derive any Mindset-visible catalog from that authority, and provide generic model summaries without a skill-specific core dispatch.
- Prove the basis with domain-neutral fixtures, round-trip tests, and a browser scenario; an additional domain Kit is not a substitute for these foundation tests.
- A declarative Kit is complete when its author adds self-contained Skill Bundles and a Mindset without editing core or a React dispatch table; pure content versions are reloadable without restarting Harness.

### 3. Complete the Web App Kit

- The Web App Kit's members, including `page_design` and `web_app_prd_assembly`, are declared in its [exact Bundle mount list](../packages/skills-web-app/kits/web_app/kit.yaml). Presentation is selected by each loaded manifest, not a fixed Bundle or native-panel count.
- Migrate the Web App panels to the shared declarative runtime for the first public release. Preserve the reviewed layouts, interactions, complete Bundle methods, schemas, validation, artifacts and save/reopen semantics; a component or manifest unit test alone does not establish parity. Native presentation remains a supported explicit profile for Bundles that require a trusted provider, not the mandatory Web App authoring path.
- Complete migration and installed-package parity before advertising the public Web App Kit as accepted. Source work in an unmerged migration branch is not released behavior.
- Preserve owner/reference rules, provenance, confirmation state, stale references, and unresolved conflicts instead of copying facts between Bundles.

### 4. Gauge and additional Kits

- The U/S/T Clarity gauge uses a structured tool, version-pinned logged session state, replayable prompt context, nullable projection, and status card. Background rescue and score-based phase authority are intentionally absent. Actual cross-Kit scoring acceptance remains a separate release requirement.
- Additional game or professional-domain Kits are future extensions, not content promised by this release. Enable each only after establishing representative acceptance scenarios.
- After the declarative basis passes its independent acceptance suite, add domain Bundles, shared research/design-style memberships, standard-reference catalogs, and PRD assembly through the same public contracts, without adding skill-specific frontend dispatch. Private reference material is not a prerequisite or part of the public distribution.
- Run research fan-out through the trusted Web App execution contribution over attached Host-native Subagents; Design Files settlement stays parent-authoritative and version-pinned, and no ordinary Bundle work enters the detached Job subsystem.

### 5. Authoring Studio

- Manage a flat, searchable Bundle catalog and compose Kits through explicit many-to-many membership without copying Bundle source.
- Create, inspect, edit, version, deprecate, preview, validate, fixture-test, and publish Mindsets, Bundles, and immutable Kit versions.
- Resolve a Kit working copy's Bundle selections to exact immutable versions at publication; show reverse dependencies and never retarget published Kits or active sessions implicitly.
- Provide four acceptance layers: discovery, data/completion validation, UI save-and-restore, and a real local Harness scenario.
- Add isolated panel applications only after a reviewed requirement crosses the declarative and trusted-component limits.

### 6. Grounding, reflection, and alignment

- Preserve the authority separation: Bundle Design Files own facet-local design state, DesignJournal owns explicit human decisions, and the AI-maintained DesignGraph is a version-pinned knowledge projection rather than another design authority. Treat `ground.json` only as a migration or export format.
- Keep Question interaction in the existing Bundle mechanism. After accepted Alignment advice, the main Agent resolves the active Kit's semantic Question capability and invokes it; if absent, it asks directly. Do not add a second question-round lifecycle to the advisory subsystem.
- Add the provider-neutral `DesignKnowledgeService` for AI-authored deltas, proposals, journal-backed decisions, query, trace, impact, rebuild, and migration. Keep provider ids and query languages private. The current deterministic `projectDesignGraph` and accepted-assertion ledger are migration foundations, not the final online service.
- Let Kits declare domain entity and relationship mappings without adding Bundle names to generic runtime code.
- Define runtime-neutral advisory profiles and delivery ports for grounding, reflection, and alignment, including pinned inputs, bounded outputs, stale-result rejection, and no Design write authority.
- Implement DeepSeek Harness first as the native-detached reference adapter: design events enqueue DSH Subagents outside the foreground turn, reuse the active DSH model and credentials, and persist completion independently of the main conversation.
- Begin with configurable scheduling after authoritative Design File commits; tune debounce, coalescing, profile enablement, and budgets from observed product behavior rather than encoding one permanent trigger rule.
- Inject completed advice into the next natural main-conversation boundary without waking it. Show decision-worthy advice in a proactive review card; accept submits a normal user-authorized instruction to the main Agent, while reject and defer remain silent. Alignment execution then uses the Kit's existing Question capability or direct conversation fallback.
- Prove one end-to-end Web App scenario in which the foreground conversation continues during background grounding and reflection, a cross-Bundle conflict reaches the main conversation, a human decision is recorded, accepted changes use the normal write path, and later analysis converges on the new version.
- Add host capability negotiation and conformance fixtures before implementing Codex and Claude adapters. A cooperative CLI adapter must identify itself as non-guaranteed unless the host exposes a stable programmatic detached-spawn API.
- Add the standalone Pi adapter only as an explicitly configured fallback for independent Studio or unattended use; it uses the same advisory profiles and requires a user-selected model credential.
- Record explicit decision authority, including Agent proposals, delegated autonomous selections, human confirmations, rejections, and supersession, without persisting hidden reasoning or chain-of-thought.
- Provide the Alignment Workspace for evidence exploration, findings lifecycle, impact paths, proposal diffs, and explicit human decisions.
- Verify the experimental local Ladybug WASM provider against rebuild equivalence, provenance queries, deletion propagation, restart recovery, read-only model access, and real Node 22 Linux/macOS/Windows packaging. Remote providers remain optional future deployments; selecting the experimental default does not establish platform acceptance.

## Completion criteria

These criteria describe the full architecture migration, not the first open-source preview gate. That preview requires Agent-assisted Kit copying, modification, validation, use and sharing; the complete Authoring Studio editor and publishing workflow are subsequent work, without waiving the preview's installed-package, design-cycle or declarative-parity acceptance.

The migration is complete when a user can install one released DSH distribution, run an interactive multi-session design process, use all 14 Web App Bundles through their declared presentation modes with verified UI and persistence parity, create and compose declarative Bundles and Mindsets through the Studio without modifying runtime code, publish immutable content versions without restarting Harness, explicitly upgrade active sessions, and continue the foreground conversation while version-pinned grounding, reflection, and alignment Agents return reviewable reminders, suggestions, and review requests before any proposed design change is applied. These are acceptance requirements, not a claim that the current source or package candidate has passed them.

# Preview status and verification scope

Check the release and known host limits before installing. Setup steps are in
[getting started](getting-started.md); host-specific behavior is in
[host compatibility](hosts.md).

## Current release and use

**Release checked on 2026-10-21 UTC:** the official registry returned
`@yugoo-design/companion@0.1.0-beta.19` with its exact integrity. At that time,
`beta` selected beta.19 and `latest` selected beta.10. Use the
[shared installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host)
to resolve the requested channel and retain the exact version and integrity.
Reuse a matching retained runtime, or acquire a new version in a separate
retained directory. An unqualified install can select the older `latest`.

**Project commands:** current source uses `/yugoo kit <kit>` and
`/yugoo migrate <source-project-path>`. The migration rename has no legacy alias
and is **not included in the published Companion beta.19 archive**. Until a release
containing it is available, use the acquired package's own help and release
manifest. Updating source does not update an installed plugin.

**Foreground reviews:** on 2026-10-21 users completed manual GRA in QwenWork and
WorkBuddy. These reviews occupied the main conversation. They did not provide
nonblocking background review. See the [host choices](hosts.md#后台能力与评审降级)
and [tested versions](#foreground-review-record-2026-10-21) before relying on that
flow; the recorded runs do not cover every npm release.

Companion npm versions, native suite versions and Kit/Bundle pins are separate.
Older archives may also have different command spelling or default packages.
The dated publication, download and installation checks are retained below.

## Historical publication and candidate records

The following records retain their dates, candidates and failures. They describe
what was checked then; current acquisition starts from the section above.

### Historical beta.2 source assembly

The initial candidate npm namespace was `@yugoo-design`, with first beta target
`0.1.0-beta.1` and dist-tag `beta`. Directory builds used `install-codex.mjs`
separately. Earlier `0.1.0` tarballs remain preflight evidence for their own fixed
builds, not later beta releases. Fixture names and directory-installer checks do
not establish an npm installation.

For reference, the published beta.2 candidate was prepared with this same-source
non-fixture build command; further changes require a new unpublished version:

```sh
node --import tsx scripts/build-companion-npm-candidate.mjs --ladybug-dependency 0.21.1 --candidate-mode non-fixture --package-name @yugoo-design/companion --version 0.1.0-beta.2
```

Run this from the repository with its declared Node/pnpm toolchain and checked-in
dependencies. The build writes an isolated candidate and report outside the
source tree, verifies source stability, and retains resource, license and import
checks. The reported candidate still requires the listed runtime evidence and
installed-package verification; selecting a public name does not mark it accepted
or publish it. Omitting `--candidate-mode` selects the exploratory fixture route.

### Companion publication record, 2026-10-21

Companion publication and registry readback are confirmed; they do not verify
cryptographic provenance or every host's installed behavior. The current manual
[Companion publishing route](../../CONTRIBUTING.md#prepare-or-publish-the-companion-npm-beta)
is separate from public-source synchronization and DSH package publication.
Later changes in main require another package release; they do not modify beta.19.
Native suite numbers, Kit pins and the Companion npm version remain independent.

### Foreground review record, 2026-10-21

Both QwenWork and WorkBuddy completed the user-selected foreground review flow
on 2026-10-21; the main conversation remained occupied. WorkBuddy's confirmation
did not record the same complete candidate/version tuple as QwenWork, so those
versions and logs are not assigned to WorkBuddy. Suggestions, acceptance and
subsequent Design File changes remain separate outcomes. Focused source
regressions for the foreground path passed; they are not additional installed-host
acceptance.

**Recorded local QwenWork candidate, 2026-10-21 (UTC):** one user-confirmed foreground
Grounding/Reflection/Alignment batch completed on Windows QwenWork
`1.3.2-26101704`, native suite `0.1.5` and Companion `0.1.0-beta.18`. The main
Agent submitted all three results without a native child or readiness probe,
retained the existing `auto` policy, reused U/S/T, and did not modify Design Files.
This is the detailed local QwenWork result. WorkBuddy's separate user confirmation
above does not extend this exact candidate record. It establishes neither npm
publication, background readiness nor full Kit acceptance. See the [foreground scope](hosts.md#后台能力与评审降级).

### Development handoff verification records

The guide is written against the [architecture baseline](../system-design-baseline.md#design-to-development-handoff);
a fresh native agent in an empty code workspace has produced a source-linked brief
without inherited design conversation, using the published files directly rather
than KAG. That run asked the user to decide ordinary route and stack choices. Those
questions were unnecessary for the authorized task; material product decisions
still require clarification. A subsequent fresh agent used the
installed npm candidate to inspect the same published project, prepared its own
source-linked brief, and implemented the authorized two-activity list/detail/back
example in an isolated code workspace. Independent review found and corrected an
unsupported empty-state explanation in the implementation; the original design
was not changed. Static checks and initial browser list checks are recorded, but
browser screenshot and ordinary-click timeouts prevented that run's complete
interactive acceptance; those failures remain recorded.

A later fresh, low-cost coding-agent session organized the task using the existing
Spec Kit `spec.md` / `plan.md` / `tasks.md` convention, then implemented the approved
two-activity journey. The same candidate passed behavior and browser navigation
checks. A registered native Producer subsequently published a controlled location
change through the owning Page Bundle; the same coding-agent session reread the
new checkpoint and updated the existing spec and implementation. Independent
verification retained the original four behavior tests and passed one additional
fixed-value test, with six browser checks confirming the changed location,
unchanged second activity and ordinary return links. No unrelated design files
were changed. The browser harness required termination of its own Node process
after assertions and page/server cleanup because its CDP client remained alive;
this was not a natural-zero process exit.

This demonstrates the representative task-scoped design-to-development feedback
loop, not every host, general KAG coverage, pixel-perfect UI fidelity or automatic
continuous two-way synchronization. Spec Kit was an appropriate choice for the
empty code workspace, not a mandatory new product-specific spec format. Code
generation or a brief alone still does not establish implementation acceptance.

### Registry and download records

**Historical registry readback, 2026-10-17 (UTC):**
`@yugoo-design/companion@0.1.0-beta.3` and all eleven owned DSH packages below at
`0.1.0-beta.2` are published. Anonymous registry metadata checks matched all
twelve exact names, versions, archive URLs, integrity and SHA-1 values against
the reviewed publication plan. At that checkpoint each `beta` tag selected the version listed there.
`latest` remained `0.1.0-beta.1` for eleven packages; the sole exception was
`@yugoo-design/yugoo-design-git-native`, whose `latest` was `0.1.0-beta.2`.
Resolve `beta` and retain the exact version rather than installing an unqualified
package name for this preview.

At that checkpoint full archive verification was incomplete: eight anonymous downloads completed
and matched the reviewed bytes and registry digests. The native Git, Panel,
Web App provider and Companion archives returned HTTP 200, but their response
bodies remained partial when the 90-second transfer limit expired (`curl` exit
28). These are incomplete transfers, not observed digest mismatches; they do not
establish twelve verified downloads. Registry consumer installation, host
activation and version-to-version updates remain separate, open acceptance
steps. Network timeouts and dependency-resolution failures from installation
attempts remain recorded; no peer-check bypass or local archive substitution
establishes a clean registry installation.

**Bounded Companion installation, 2026-10-17 (UTC):** an offline, cache-only
installation of Companion beta.3 from previously acquired official npm content
completed, and its public CLI help returned successfully. Lifecycle scripts were
disabled. This did not perform a new registry download, load the native runtime,
register or activate a host, or test model use and Panel save/reopen. The earlier
network timeout and the operator-stopped follow-up remain recorded; this cache
result does not turn either into a successful cold registry installation.

The published set includes the in-library Git runtime for Windows x64/MSVC and
Linux x64/GNU. Normal Design versioning needs no system Git executable; other
platforms are not supplied by this release. The earlier bounded Git checks below
remain evidence for their exact candidates, not acceptance of this npm update.
Later source fixes, including removal of the redundant Panel footer guidance,
are not in those frozen archives. Trusted publishing configuration was still
deferred at that checkpoint; that record does not claim an OIDC publication.
The later Companion publication is recorded separately above.

**CPU-first embedding installation policy:** local text embeddings run on CPU;
GPU acceleration is outside the first-release scope. Host
generative models still supply conversation, design generation and reviews.
Before the first npm/npx acquisition, follow the
[shared installation entry](../../packages/companion/HOSTS.md#agent-led-installation-and-updates):
set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` for the acquiring process while keeping
normal dependency lifecycle scripts enabled. This skips the additional CUDA
download, not npm runtime dependencies or embedding model files. Prepare the
required model cache or explicitly allow its download under that version's guide.
This source/installation policy does not change the frozen beta.3/beta.2 archives,
turn the earlier lifecycle-disabled check into a normal installation, or establish
a successful CPU installation, semantic KAG or native-host acceptance.

**Historical registry readback, 2026-10-14:** `@yugoo-design/companion@0.1.0-beta.2` and the
ten DSH system modules at `0.1.0-beta.1` were publicly available, before the
native Git helper was added to the release set.
Anonymous downloads matched the reviewed archive SHA-256 and registry integrity
for every package in that set. At that checkpoint, Companion's `beta` tag pointed
to beta.2 and its initial `latest` remained beta.1; the DSH packages' `beta` and
initial `latest` tags pointed to beta.1.
Registry publication and byte verification do not establish host activation or
version-to-version update acceptance. Published versions are not overwritten.
Earlier local `0.1.0` candidates and native suite versions remain their own
evidence. Source changes do not update already installed packages or prove a
real version-to-version update.

### Current package set and version mapping

The default product supplies Web App. Decision Modeling is currently an internal
validation Kit, excluded from default product dependencies and the public source
export. Its internal source and the generic independent-Kit loading mechanism are
retained. The older DSH publication below keeps its original package set;
this documentation does not withdraw packages or rewrite their frozen bytes.
Use the acquired installer's exact mapping for DSH, independently of the
Companion release number.

The corrected source default below contains ten physical DSH package identities
under `@yugoo-design`, including the native Git helper, plus Companion. The helper
is a runtime dependency,
not an additional Loader entry or a package users must install separately.
The development workspace remains private; its internal package manifests are
transformed for distribution rather than published unchanged.

| Dependency order | Packages (each prefixed with `@yugoo-design/`) |
| --- | --- |
| 1 | `yugoo-design-git-native` |
| 2 | `dsh-design-core`, `dsh-design-skills-web-app` |
| 3 | `dsh-design-panel`, `dsh-design-knowledge-ladybug`, `dsh-design-studio` |
| 4 | `dsh-design-provider-web-app`, `dsh-design-studio-ui` |
| 5 | `dsh-design-studio-dsh` |
| 6 | `dsh-design-system-dsh` |

The earlier 2026-10-17 publication checkpoint included Companion `0.1.0-beta.3`
and eleven DSH packages at `0.1.0-beta.2`, including Decision Modeling. Those
publication facts are historical evidence, not the current default boundary;
published archives are not silently changed by a source correction.
At that checkpoint, metadata and full archive integrity had been checked for
the two content packages; complete archive-download verification of the DSH set
was still incomplete. Neither record established a complete host installation.

Internal dependencies and peers retain exact version selectors and point to an
earlier layer. The corrected DSH aggregate selects the nine preceding packages,
including the native Git helper used by Core. Companion bundles its payload and
its DSH installer selects the exact aggregate through
`release-hosts.json`. That runtime installation relationship is not an npm
dependency edge. Users should not install the internal modules manually.
Web App is supplied with the main installation: bundled in Companion and a
normal content dependency/Loader entry in DSH. This does not silently select a
Kit for existing projects or change their exact pins. See the
[official Kit list](kit-sharing.md#official-kits) for the current scope and
independent-Kit loading guidance. Exact corrected release versions and withdrawal
results must be checked against their actual release records before installation.

Ladybug remains the external official `@ladybugdb/wasm-core@0.21.1`; this plan
does not publish a replacement under the upstream scope. DSH supplies its
compatible host peers, and the Panel/Studio React peer contract remains React 18
(`react` and `react-dom` `^18.2.0`). Internal dependency ordering does not prove
external peer compatibility or a clean registry installation.

A historical Windows npm 10.9.8 installation of the beta.1 aggregate alongside declared
host pins failed with `ERESOLVE`: npm selected older DSH peers inside the
aggregate's peer set. That failed attempt is retained; no `--force` or
peer-check bypass was used. It is distinct from installing through the official
DSH CLI into an existing host, whose registry route still requires verification.

Native suite numeric versions, Kit/Bundle schema versions and external dependency
pins do not follow the npm beta numbering. The installation target is registry
acquisition of an exact package using the [shared prompt in the current host](../../packages/companion/HOSTS.md#default-prompt-any-supported-host),
normal host loading and functional verification. Local tarballs prove only their
candidate preflight boundary; required desktop importer confirmations remain
host-specific. This path has not yet passed registry/native update acceptance.

Publication remains a separate authorized operation. Registry metadata is
available; supported-host installation, activation and functional results
remain separate acceptance steps rather than consequences of publication.

yugoo-design is a standalone plugin. It does not distribute or replace the DSH application, and it does not require modifications to a host's source code. An internal installer-adapter package name containing `dsh` does not mean that the release includes the official DSH application. Your host provides the agents, model access, and search tools. The public plugin must not request a search API key or overwrite your existing model/search configuration.

**Earlier bounded host checks:** isolated official-host installations have verified synthetic non-Web record editing, saving, reopening and same-profile host restart. Initial records for that example were imported through the public validated save API, not generated by an agent. Separate native model runs through the dogfood gateway have verified Web App question generation and saved answers, a two-page browse/back journey, and a non-Web decision brief with an explicitly requested revision. Chinese/English shared-question checks and Companion language persistence cover the tested paths, not every interface string. These results do not establish installation or update acceptance for the current npm versions.

One isolated official-host run has also verified native model-generated A2UI without fallback, retained layout reopening, answer editing and saving, and persistence after another reopen. Follow-up installed checks resolved the observed narrow-dock save-button clipping and verified all three GRA profiles complete through the native host route after a schema-compatibility fix. Those earlier reviews used published files without matching KAG context after a bounded knowledge-read timeout. A later installed official-host check, following a targeted reader fix, verified one alignment review consuming three KAG items from the matching project, design revision and published checkpoint; its durable result recorded `knowledgeUsed: true`. The earlier timeout results remain failures. This is not general A2UI visual acceptance, proof that every GRA profile consumes KAG, or complete cross-host KAG/GRA integration acceptance.

Release acceptance is still open. The unmodified official DSH host has completed a supervised native file-Worker run, rejected an out-of-scope write and published a validated artifact through the public design tools. That Worker result alone does not establish autonomous model selection of the route, every approval interaction, complete Companion equivalence or Windows/macOS desktop coverage. Installed-package checks confirm existing design advisories stay collapsed on entry, session return and refresh; the sidebar badge remains visible and manual opening still works. No general installation or desktop-support claim is made by this draft.

**In-library Git candidate, 2026-10-16:** a fixed Core/DSH candidate at
`653f1d4` has passed two actual panel saves in each of an isolated Windows DSH
Web environment and the official Windows desktop application. The checks
covered reopening and restoring the edited values, delivery of the matching
save diff to the original main Agent, and successful `report_design_clarity`
calls whose exact checkpoint and assessment matched the durable journal and
latest project assessment. Separate native Agent calls read history, an older
file and the diff between saved versions. The candidate bundles its Git runtime
for Windows x64/MSVC and Linux x64/GNU; normal Design operations no longer
require a system Git executable. At that checkpoint, the candidate had not been
published as an npm update; the current published versions are listed above.
These results do not establish registry-to-registry updates, Companion
equivalence, other hosts or other desktop platforms. Save completion, the full
Agent reply and background review remain separate outcomes; post-save refresh
and notification behavior remains under observation.



The authoring target is **copy → modify → validate → use → share**. One synthetic workshop-delivery Kit has completed native agent-assisted authoring, resource reading, generation, validation, panel editing, saving and reopening. Its ZIP recipient completed the same use/save/reopen path in a separate clean profile on the same installed package graph, without changing the author's Kit or project. This does not establish another-machine or cross-host compatibility, dependency-bearing Kit installation, or general version-conflict handling.

## Studio source capabilities and installed acceptance

Current shared Studio UI and Companion source wire installed-file inspection,
local Kit/Bundle copies, explicit mount management, declarative YAML/sample
preview, native-host trial requests, a component library and content-archive
preparation/adoption. The [Studio walkthrough](usage.md#6-studio查看定制和检验套件)
explains the supported operations. Host adapters supply these capabilities
individually; source wiring does not establish every installed candidate or host.

Archive inspection confirms the compact **Browse official kits** link is included
in Companion beta.3 and DSH Studio UI beta.2; it was absent from Companion beta.2
and DSH Studio UI beta.1. The link does not install content or change project
pins. Its presence does not verify the configured public documentation destination
or native-host rendering; public source synchronization remains a separate step.
Use the maintained [official Kit list](kit-sharing.md#official-kits) for acquisition
and supported scope.

Local-copy saves and draft confirmation do not publish a new content version or
retarget an active project. Sample preview invokes no model. A trial uses an
isolated project and requires native execution evidence; its demonstration save
changes browser-local UI state only. Content adoption retains exact definitions,
and Kit adoption creates an unconfirmed working copy, without executing imports
or changing project pins. These are distinct outcomes, not a publishing marketplace.

The operations-modeling Kit's current migration, real solve/rerun and independent
contributor/recipient flow require their own acceptance. The earlier decision-brief
example below does not prove them. macOS native-host acceptance remains untested
in these records; Node portability does not substitute for that verification.



See the [non-Web Kit demonstrations](non-web-kit-demo.md) for two distinct tested paths: editing and saving imported synthetic field-operation records, and native Agent generation of a small decision brief followed by saved user answers and an explicitly requested revision. The latter retained all three answers and produced a real clarity assessment; its initial default save continuation did not perform the revision or scoring. Neither example establishes solver success, development handoff, cross-platform support, or complete release acceptance.

## Continue into development

With a Design Project selected, use `/yugoo compose_spec [feature scope]`, or
ask the main agent to “assemble the current design into a development spec for
[one user operation].” Include the authorized coding workspace. The main agent
uses the shared `design_command` action, reads the relevant published design
files and artifacts, and writes or updates the target repository's existing
spec convention. A prepared-task receipt is not a generated spec; completion
requires actual files and checks. This does not authorize implementation or
modify Design Files. Spec and PRD outputs are not re-ingested into KAG.

Give your coding agent a concrete implementation outcome, not an instruction
to build everything in the project. The proposed handoff can start with:

```text
Use the selected Design Project to prepare a development brief for [one user
operation]. Pin the published design checkpoint and identify the relevant
records, objects, rules, flow and UI evidence. Use KAG to discover related
sources if available, then verify them in the source files.

Treat published canonical design content as the design basis, following the
Kit's actual contract. Distinguish those decisions from unaccepted suggestions
and unresolved assumptions; do not invent evidence of personal user confirmation
or ask the user to reapprove every published record.
Explain normal behavior, important exceptions and observable acceptance checks.
Flag material conflicts or missing decisions before implementation. Do not alter
Design Files with coding tools; send design changes back through their Bundle.
Wait for my approval of this brief before writing application code.
```

This keeps the original design files authoritative and limits the context to
the task. A prototype or a high clarity score is not proof that every behavior
has been confirmed. The task-scoped handoff contract is documented in the
[practical handoff guide](../design-development-handoff.md). It explains
how a fresh coding agent can find task-relevant sources, prepare a brief,
implement the approved scope, and return design gaps through the owning Bundle.
The coding agent can choose ordinary implementation details within the authorized
scope; ask the user when a material product decision is missing. Keep using the
code workspace's existing spec convention. Spec Kit is one option, not a required
Yugoo Design format. The [recorded handoff checks](#development-handoff-verification-records)
cover a representative list/detail/back journey and a later design change; they
do not establish automatic two-way synchronization or every host's behavior.

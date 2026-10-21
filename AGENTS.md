# Contributor and coding-agent entry

## Start with the owning contract

Read the relevant parts of [the architecture baseline](docs/system-design-baseline.md)
and the owning package's README before changing a cross-layer contract. For Bundle
work, read [the Bundle contract](docs/bundle-contract.md), [the DSL](docs/dsl-spec.md)
and the relevant authoring skill under `.agents/skills/`. Treat documented plans
as plans: confirm implemented behavior in source and focused tests.

- `packages/core`: host-neutral project, validation and execution semantics.
- `packages/panel`: shared presentation, declarative interpreter and UI primitives.
- `packages/skills-*`: domain methods, schemas, examples and declarations.
- `packages/provider-*`: explicitly trusted executable/native contributions.
- `packages/companion`, `packages/dsh`, `packages/studio-dsh`: host integration.
- `packages/studio`, `packages/studio-ui`: shared authoring domain and UI.

Do not hard-code a Bundle name in a shared layer to repair one Bundle. Reuse
existing save, validation, publication and host adapters rather than creating
parallel authorities. A graph and its detail form edit the same canonical data.
Panel changes should reuse shared components/styles and preserve existing native
behavior. All Kits share one Panel foundation: sidebar/tree navigation, content
frames, typography, spacing, controls, and reading/editing/add/delete/disclosure
patterns. Maintain its base presentation in
`packages/panel/src/visual-components.css` and its behavior in the shared
components; no Kit-specific base stylesheet, copied control or CSS override.
Host chrome, theme resources and specialist canvas assets have separate owners,
but must not redefine the Kit's ordinary navigation or form foundation.
Bundle authors declare business objects, relationships, fields, ordering and
supported view choices. They do not tune fonts, gutters or basic action geometry,
or reconstruct shared interactions from low-level components. A missing reusable
pattern is a shared component gap, not permission for a local styling workaround.
Fix defaults at their owning definitions and remove superseded selectors. Reuse
unchanged evidence and check affected representative views across Kits, without
turning every content edit into a UI redesign or full-product audit. Choosing
useful information and a readable organization remains the Bundle author's duty.
React 18 is the current UI compatibility boundary.

For Panel, Studio or A2UI/DSL presentation work, read the shared
[Panel UIUX standard](docs/panel-uiux-standard.md). Choose a visual expression
from the user's decision and real data before selecting components. Reuse
semantic tokens, controls and state feedback; distinguish common defaults from
confirmed scene-specific baselines. The standard is authoring/review guidance,
not another DSL schema or proof of runtime conformance. Update it when a shared
interaction decision changes, and verify the affected representative view.

Panel UX must help people understand, think, express intent and align with AI.
For new, revised or migrated Panels, answer the standard's
[Panel self-review questions](docs/panel-uiux-standard.md#面板自查): does the
representation aid understanding and judgment; are interactions convenient and
familiar; do information density and organization support human rewriting; can
people see how their changes affect the design? Review a representative reading
and editing path, not only field coverage. Multiple internal tabs are discouraged
by default; do not turn storage sections into navigation. Justify necessary task
or view switches and preserve context. Keep findings in the existing work record;
this adds no separate approval stage or full-product test requirement.

Every independently editable Panel field must serve a concrete user purpose.
Explain who supplies or confirms it, which decision it informs or how it is used
later, and why an existing field cannot express the same fact. Schema presence or
a generic "design rationale" label is not sufficient. This applies to every
Bundle in every Kit: consolidate ordinary pending questions, assumptions,
rationale and source explanations into the object's optional remarks. Do not
add a generic "pending questions and evidence" section, split remarks into
several inputs, or merely rename such a field cluster. Keep uncertainty explicit
in the remarks without requiring a separate field for it. Independent business
rules, constraints, and purpose-built question/answer or evidence artifacts keep
their own meaningful controls. Present derived values and technical provenance
as readable context when useful rather than asking users to re-enter them.
Apply the [field-value guidance](docs/panel-uiux-standard.md#独立填写字段的价值)
when simplifying existing Panels: preserve user content, source references and
canonical semantics, and update methods/contracts if those semantics change.

For a Bundle with a canvas, follow the [canvas authoring convention](.agents/skills/design-bundle-creator/references/canvas-authoring.md).
Use its own `reference/canvas-guide.md` as the discoverable method entry, reachable
from both `SKILL.md` and the readable output contract. Standardize file ownership,
method coverage and verification, not the graph type or domain visual language.
Preserve and index existing specialized guides; do not create placeholder guides
for non-canvas Bundles or add a new loader requirement.

Keep Bundle capability descriptions in `SKILL.md` frontmatter, not a second
`skill.yaml` description. Optional translated picker copy belongs in the existing
panel locale resources (`bundleDescription`), not another routing authority.
Declarative manifests need `presentation.mode`, not
the fixed interpreter id; native renderer ids remain explicit. Simplifying
metadata must not trim domain methods or output contracts. Verify loaded
descriptions, execution policy, panel and summary parity after such changes.

Skill Body authoring follows the required questions in
`.agents/skills/design-skill-creator/references/standards.md`, not mandatory
chapter names or separate forward/reconstruction chapters. Explain domain
evidence and the differences between proposing a design, restoring observed
behavior and revising saved facts. Output contracts do not replace professional
methods. Shared critical constraints must remain Bundle-reachable from both
execution entry points; repository guidance is not installed runtime input.
Before reorganizing existing methods, provide a retention mapping for principles,
domain reasoning, failure handling and protocols. Only duplicated runtime
protocols may move to an existing system injection after verifying the actual
host, execution mode and phase coverage. Unverified protocols stay in place;
never delete methods under the label of standardization.
Retention does not justify conflicting executable instructions. Identify the old
statement and current owning contract, obtain direction where scope is unclear,
and record the authorized correction or supersession in the retention mapping;
never silently delete the conflict or present it as a current requirement.

When a Bundle needs cross-Bundle fact alignment or supplements, follow the
[cooperation authoring convention](.agents/skills/design-bundle-creator/references/cooperation-authoring.md).
Use the conditional `reference/cooperation-guide.md` content location and link it
from both the method and output contract. Fill only actual domain needs; this is
not a required loader slot, universal workflow or permission to write other
Bundles. The caller coordinates authorized target-owner invocations using the
existing validation, publication and handoff boundaries.

KAG tracks independent native design sources and artifacts. PRD/spec assemblies
and model-facing state summaries are derived, not independent knowledge sources.
For declarative Bundles, author optional summary rules in `skill.yaml.summary`,
not a separate `renderer.md`. Summary absence must not gate execution or Panel
save; explicit invalid rules still fail validation. Preserve summary semantics
and useful comments when migrating existing declarations.
Preserve source
references, user-owned fields, exact version pins and explicit migration paths.

## Work safely and in parallel

Check `git status` first. Existing uncommitted changes are not yours to discard or
include in a commit. Use a separate branch/worktree for concurrent implementation;
agree shared-file ownership and integrate fixed commits deliberately. When using
Chatroom, follow `.agents/skills/agent-comms/SKILL.md` and keep the existing ledger
accurate. Close a task only for its stated verified outcome, not an acknowledgement.

Keep test projects, runtime state, ports and outputs isolated. A temporary
`DSH_HOME` does not by itself isolate DesignService storage or Electron userData.
Do not change real user profiles, authentication or installed plugins without
explicit scope/authorization. Existing authorization remains valid within its
stated scope; do not repeatedly ask for the same permission. Native hosts own model access and credentials;
do not introduce a second model client to simulate a successful host integration.

Check disk capacity before large builds/copies. Reuse unchanged artifacts and
read-only dependencies where safe; do not repeatedly copy node_modules or entire
release trees. Keep bounded evidence and an explicit cleanup list. Stop only owned
processes; never broadly delete evidence, profiles or workspaces to free space.

## Verify the claimed result

Use the Node/package-manager versions declared in `package.json` and the checked-in
lockfile. Consult package scripts rather than guessing commands. Build dependencies
before tests that consume `lib`; source-alias checks must be reported as such.
Start with the smallest relevant regression/typecheck/build, then add integration
or real UI/host checks when the change requires them. Do not repeat the full product
suite for an unrelated documentation or local presentation change.

Report compilation, rendered interaction, durable save/reopen, native-agent
consumption and installed-package validation separately. A fixture or probe proves
only its tested boundary. Preserve meaningful negative tests; do not remove a
guard simply to make tests pass. Document untested behavior and concrete failures.

## Delivery boundaries

Follow the Wiki [naming and translation standard](docs/wiki/terminology.md)
for product copy and documentation. Chinese documents introduce the product as
语构设计系统（Yugoo Design） and pair Chinese terminology with its English name.
Keep executable commands, package names and protocol identifiers exact.

Public-facing README, Wiki, contribution and security guidance have one maintained
source at their formal paths in this development repository. Update the
[document sync contract](docs/public-document-sync.md) and existing export
classification when that boundary changes. Current public document exports
preserve their paths and bytes; internal plans and retained historical drafts
remain excluded. Verify local links/anchors and fixed-source parity before
synchronization. Do not restore a second public README authority.
Maintain complete Chinese and English README versions with corresponding
chapters, capabilities, examples and status. Before restructuring, map original
ideas to their retained destinations; verify content retention as well as links.
Include screenshots and their purpose in that mapping. Preserve the depicted
workflow and relevant interface context; a business artifact alone does not
replace a screenshot showing conversation and Panel interaction.

This repository is the internal development source. The public `yugoo-design`
tree is a reviewed export of a fixed main-branch commit, using the existing export
tools and policy; do not edit it as a second development source. New files require
classification under the existing export policy and normal maintainer review,
not a new per-file user-approval gate. See [contribution/release guidance](CONTRIBUTING.md).
Preserve native-reference implementations, provenance and third-party notices.
Apache-2.0 project licensing does not override a dependency's or imported Kit's
license. Source commits, public-source synchronization, npm packaging and publishing
are distinct operations; do not claim or perform one merely because another passed.

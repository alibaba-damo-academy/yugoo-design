# Contributing

yugoo-design welcomes improvements to the design runtime, reusable Kits, documentation, and host integrations. Start with the guide for your contribution:

- Runtime or host code: [Development](docs/wiki/development.md), including workspace preparation and focused checks.
- A Kit, Bundle, method or Panel: [Extension guide](docs/wiki/extending.md), followed by [sharing and recipient verification](docs/wiki/kit-sharing.md).
- Documentation, translations or examples: [terminology](docs/wiki/terminology.md) and [document synchronization](docs/public-document-sync.md).
- A problem or proposal: [feedback guide](docs/wiki/support.md); report sensitive issues through [SECURITY.md](SECURITY.md).

Source installation and full build results must be verified against the selected public snapshot.

Read the repository `AGENTS.md` before making a source change; it records package ownership, isolation, verification and delivery boundaries. It applies to contributors and coding agents.

## Your first contribution

1. Pick one improvement you can describe from a reader's or user's point of view: an unclear instruction, a missing Bundle example, an awkward Panel interaction, or a reproducible bug.
2. Check the [feedback guide](docs/wiki/support.md) for the current contact channel. For a substantial behavior or contract change, describe the proposed result before implementing it; an ordinary documentation correction can start as a small patch.
3. Work in an independent checkout or branch. Read the owning guide above, preserve unrelated changes, and check the affected result using the [development guide](docs/wiki/development.md).
4. Submit a focused patch with the problem, resulting behavior, verification and any remaining limitations. A Kit contribution also needs a matching method, Panel and sample; use the [extension checklist](docs/wiki/extending.md).

You can contribute domain expertise or report a confusing design interaction without writing code. Tell us what you were trying to decide, what the Agent or Panel showed, and what you needed to understand or change. Use synthetic or redacted examples.

## Choose the right layer

Put domain methods, output schemas, validation declarations, examples, and panel definitions in a Kit or Bundle. Keep the core independent of a particular domain or Bundle name. A genuinely new reusable component or execution capability belongs in the runtime and requires a runtime release; changing a supported panel declaration should not require rebuilding the host application.

Studio authoring uses the shared `packages/studio` domain and `packages/studio-ui` presentation, with host mounting in `packages/studio-dsh` or Companion. The current Panel draft service preserves an exact source snapshot and supports preview, save/reopen, confirmation and a new editable fork; it does not publish installed catalog content. AI collaborator definitions, methods and schemas belong in `packages/skills-web-app/bundles/ai_agent_capabilities`, while shared runtime behavior remains in Core and Panel. The [Studio walkthrough](docs/wiki/usage.md#6-studio查看定制和检验套件) distinguishes source inspection, editable copies, sample preview, native trials and adoption.

Keep host adapters thin. The host owns its agents, model access, search tools, and credentials. Do not add a development gateway, ask users for an unrelated search key, or require modifications to host source code as an installation step.

For a Bundle change, keep the method, schema, validation, summary, presentation, and examples consistent. Preserve design-data meaning and user-owned fields. Distinguish source facts, inferred relationships, proposed suggestions, and accepted user changes.

## Make a focused change

Start with the user problem and a minimal synthetic reproduction. State which layer owns the behavior and what must remain unchanged. For significant interface or data changes, discuss the proposed contract before implementing it.

For a behavioral bug fix, include a regression check that fails for the original problem. Match verification to the changed behavior: a documentation or file-selection change does not by itself require a new model run or the entire product suite. A successful script or mocked callback is not evidence of browser interaction, durable saving, a model-generated result, or a clean installation. For a UI change, record the actual rendered result and verify editing, saving, reopening, and read-only behavior where relevant. For a permission change, include a rejected-operation test that proves unrelated data remains intact.

Do not remove a security or compatibility check just to make a suite pass. Replace obsolete checks with checks for the current contract and retain meaningful negative cases. Record skipped checks and untested hosts or platforms explicitly.

For an official DSH integration run, isolate both the host profile and the plugin's design storage before opening the project list. A task-local `DSH_HOME` alone does not isolate the DesignService defaults: configure the `dsh-design-core` contribution's `projectsRoot` and `stateRoot` explicitly to owned temporary directories, then confirm the catalog is empty before creating synthetic data. Do not run profile-preparation commands against the user's default profile or reuse an existing user project. Keep model credentials out of fixtures; a failed follow-up model turn must be reported separately from a successful project creation or Panel save.

## Tie verification to the delivery

Before running a test or requesting a review, name the user-visible outcome or release requirement it will prove, the affected artifact, and the decision its result will change. Use the smallest check that answers that question without weakening the requirement. Passing a narrow check does not close a broader acceptance item.

Reuse evidence for unchanged artifacts and the same environment. Repeat a check when relevant code, dependencies, configuration, or the environment changes, or when a concrete failure requires reproduction—not merely to accumulate passing runs or a second status confirmation. Stop broad diagnostic work once it has produced an actionable cause; fix that cause and verify the affected outcome.

For agent-generated design acceptance, use the supported native host route and its configured model access. A hand-written fixture, mocked model response, or separate model client cannot substitute for the real generation, editing, saving, reopening, and continuation steps being claimed. Keep credentials private and do not overwrite the user's model configuration.

Security, privacy, licensing, and compatibility requirements still apply. Report a missing required check as incomplete rather than removing it. Record the concrete result, remaining limitation, and next delivery action; the number of tests or reviews is not a progress measure.

## Check the prepared workspace

Check the scripts in the selected snapshot and the [development guide](docs/wiki/development.md#从最小相关检查开始). In a workspace with its declared dependencies prepared, choose the relevant existing check:

```sh
# Public documentation and export fixtures
pnpm run test:public-documents

# Broader release-contract checks, when the change affects them
pnpm run test:public-contracts
```

These commands are not the entire product acceptance suite. The public-contract suite uses synthetic fixtures for many paths. Its public Settings Provider lifecycle case is skipped unless `DSH_SETTINGS_TEST_MODULE` identifies a separately verified official provider module; never use a private development path as a public installation instruction. Full build, installed-host, Kit authoring, KAG/GRA, and platform checks remain separate.

## Prepare and approve a source export

Maintainers export a reviewed fixed commit through the existing stage, inspect,
prepare, verify and apply workflow. The complete commands, exact-hash approval and
target-conflict rules are maintained in the [source export procedure](docs/public-document-sync.md#准备与核准源码导出).
Source synchronization, Git push and npm publication are separate operations.

## Official npm publication boundary

All official npm packages are published **only by GitHub Actions**, from a reviewed
commit in the public repository's `main` history and a matching release tag.
Local development, tests, builds and `npm pack` are allowed. Direct local
`npm publish` is prohibited, including for the separate DSH package chain.
Missing Actions or Trusted Publisher configuration must be resolved at that
boundary; it does not authorize a token-based or local publication workaround.

## Publish a product release

`yugoo-design` is the single product installation package and CLI. It provides
native DSH installation and Companion host integrations over the same design
infrastructure. The ten native DSH packages retain their Loader identities and
exact dependency boundaries; users acquire them through the product installer.
The official DSH application remains an external host.

[`release/product.json`](release/product.json) is the sole product identity and
version source. Use a canonical `X.Y.Z` version without prerelease or build
metadata. The product package and all ten native packages use this same version.
[`release/release-hosts.json`](release/release-hosts.json) is a host mapping
template: preparation derives its packaged `aggregateVersion` from the product
version. Do not maintain a separate Companion or DSH release version.
The [package template](release/product-package-template.json) owns the installer
metadata; exact package identity and version come from the product manifest.

Update the product version alongside the reviewed source, synchronize that fixed
main commit to the public repository, then push its matching `vX.Y.Z` tag.
The [product workflow](.github/workflows/publish-product.yml) builds, checks and
publishes the complete release, with native dependencies first and the product
installer last. Ordinary main pushes do not publish. Tags must match the product
manifest exactly, and their commit must belong to reviewed public main history.
There is no separate beta channel or legacy Companion package publication path.

For a build-only check, run the product workflow manually with **publish**
unchecked. An optional version input confirms the tracked value; it cannot
choose another version. Publication retries use the same matching tag with
**publish** enabled. A registry error is not evidence that a version is unused.

### Preparation and runtime checks

The workflow uses GitHub-hosted Ubuntu, Node `22.22.3`, pnpm `11.7.0` and npm
`11.21.0`. The product requires Node `>=22.19.0`. CI installs the same prepared
product archive into separate empty directories with `npm install --engine-strict`
on Node `22.22.3` and `24.22.1`. It runs the existing native Git, Sharp and Ladybug
WAL checks before publication. These checks do not establish model readiness,
browser interaction or actual native Host installation. Keep each result's scope
explicit and reuse unaffected Host evidence.

The isolated archive check is also available locally under each selected Node:

```sh
node scripts/check-product-node-runtime.mjs /absolute/PREPARED.tgz X.Y.Z /absolute/NEW_OUTPUT
```

Public exports currently omit the internal lockfile: on that input,
CI first resolves a public-registry lock, then performs a strict frozen install.
The resolved lock is a run input, not a committed reproducibility guarantee.
Dependency caching is explicitly disabled in both setup Actions.
Build permissions come only from `pnpm-workspace.yaml`; preserve exact approved
versions and explicit denials. The existing workspace overrides also pin reviewed
direct runtime inputs and observed transitive drift when public CI resolves its
lock. Keep pins inside the original incoming dependency ranges and preserve
coexisting versions. A reviewed `parent@exact-version>child` rule fixes one incoming
edge when a package-wide pin would conflict with another consumer's peer. An additional
package identity requires its own exact provenance and original materials.
Keep the Rolldown override at `1.2.4`: the retained
Pica/UI artifact verification used that compiler version. Recheck those artifacts
before reusing their evidence with a different compiler. Installation executes the approved native scripts
within the isolated runner, not within a user Host/profile.

Native Git inputs use the fixed public Companion `beta.16` archive for Linux
and Windows, plus the fixed raw Darwin arm64 addon from this repository's
`native-inputs-git-darwin-arm64-bd1cbdec` input Release. The archive's complete
SRI and historical SOURCE identity remain pinned; its two artifact declarations
must match the current `packages/git-native/SOURCE.json` exactly. The current
SOURCE alone owns all three binary sizes and hashes. Preparation then runs the
unchanged current source, native and original-notice checks. CI never rebuilds
or substitutes binaries, and an unknown source/input fails without fallback.

The input Release is separate from the product npm release. Its raw addon,
provenance and original license materials must be reviewed against the final
public source commit before that input Release is published. Its tag does not
match the product workflow's version-tag trigger. Publishing the inputs, running the
default unauthenticated acquisition, preparing a product archive and publishing
that archive are separate steps. Local preparation with an explicit native root
does not prove that the public input assets are available. Until those assets
exist, default preparation fails before downloading the larger legacy donor.
The Darwin request permits only HTTPS GitHub-to-reviewed-CDN delivery, omits
credentials, and enforces the current byte/hash pin and a bounded deadline.
A changed input identity needs a reviewed source/routing update. See the
[product workflow](.github/workflows/publish-product.yml) for the exact preparation command and optional native-root input. Use `node --import tsx` after preparing source dependencies. The optional artifact root still passes
the existing source/material gate.

### Original archives and recovery

Each normal package build runs with the existing module observation hooks, then
the existing assembler consumes the current observation receipt. Declaration
outputs remain verified; declaration-only module IDs do not become physical
runtime inputs. Missing runtime inputs still fail. The maintained material
manifest owns component identities, original materials, fonts and historical
observations. Current output hashes and associations come from the current build.
Workspace component identities must match both their manifests and the fixed Git
source; historical metadata is not current-source evidence. Unassociated
historical components remain historical. Receipts retain incomplete inventory
and license-acceptance flags; successful packing does not establish Host acceptance.

Before publishing, CI retains the eleven original archives, release receipt,
material observations and actual public lock. The bounded immutable artifact
excludes native input trees, staged packages and node_modules. Its run, attempt,
artifact ID, digest and receipt hash are recorded before npm publication; upload
or identity verification failure stops publication. Retention is seven days.

Keep the original producing run unchanged. Start a new workflow run and provide
both **resume_run_id** and **resume_artifact_id**. Do not select **Re-run all jobs**
on the producing run: its original artifact may become unavailable. Missing,
expired or ambiguous artifacts fail. Recovery never rebuilds or repacks them.
Fresh preparation requires every exact release version to be absent.

Recovery checks repository, workflow, permitted source ref and exact source SHA,
including successful original build, seal and upload steps even when later
publication failed. It verifies the downloaded ZIP digest and admits only the
expected regular files. Every tarball's raw hashes, size, metadata and exact
dependency pins must match. It restores the original frozen public lock. Fresh
registry results live outside the immutable payload; saved registry state cannot
authorize publication.

The workflow checks every exact registry version before publishing anything.
Only a version 404 means absent. An existing version is skipped only after its
metadata integrity and actual downloaded archive match the retained original.
Dependencies must be visible with matching bytes before their dependents publish.
The complete set is verified after publication. Mismatches and transport errors
stop the job; recovery never overwrites, unpublishes or blindly skips packages.
Official releases and retries share one concurrency group.

### npm trust and the release channel

Every package uses the same Trusted Publisher identity: GitHub organization
`alibaba-damo-academy`, repository `yugoo-design`, workflow filename
`publish-product.yml`, and no environment name. Enable direct **npm publish** and
**Allow npm dist-tag**; these are independent permissions. A previous workflow's
trust is not inherited by a new workflow or a new package. An inaccessible trust
listing does not establish that a configuration is absent.

npm requires a package to exist before its Trusted Publisher can be configured.
For a new package name, resolve that one-time registry setup with its maintainer
before attempting an OIDC release. This prerequisite does not authorize local
publication or a hidden token fallback. See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
and [Trusted Publisher settings](https://docs.npmjs.com/trusted-publishers/).

The publish job has `contents: read`, `actions: read` and `id-token: write`;
dry runs have only read permissions. OIDC permission covers the reviewed job's
installation and build steps, so approved dependency scripts and fixed inputs
are part of its trust boundary. Diagnostics show tool versions and whether OIDC
environment variables exist, never their URL or token values. Presence alone
does not prove a successful token exchange. Do not upload authentication logs.
Package repository metadata must match the public repository.

Publish only verified original tarballs. The release channel is `latest`, and
retrying an old source must never move it backwards. Channel selection considers
stable versions only; beta releases are not promoted by this workflow. Dist-tag
management requires npm `11.21.0` or later in the npm 11 series and its separate
Trusted Publisher permission. Dry runs never mutate registry tags. Actual
publication, registry readback, source synchronization and native Host acceptance
are distinct results. Public provenance is not independent native-binary
reproduction or proof of complete product acceptance.

## Recover an interrupted source export

Preserve the target, backups, journal and locks. Stop every executor for the
transaction before approving recovery; do not remove locks or blindly retry.
Follow the [interrupted-export recovery procedure](docs/public-document-sync.md#恢复中断的源码导出)
for evidence inspection, exact-plan approval, cleanup and separate finalization.

## Submit evidence without private data

Describe the change, affected contracts, actual commands and outcomes, dependency versions, and remaining gaps. Use synthetic design files instead of a real user's conversations or projects. Remove credentials and internal URLs from logs and images. Do not commit generated caches, local model configuration, installation tokens, or unrelated build outputs.

Preserve third-party copyright and license notices. Project-owned code is Apache-2.0; adding a dependency or copying code requires reviewing its source, license, notices, and distribution obligations. Do not claim that the project's license replaces a dependency's license.

## Maintain private security reporting

Keep [SECURITY.md](SECURITY.md) focused on people reporting an issue. Before
announcing a reporting channel and supported-version policy:

- Enable and test private vulnerability reporting in the actual public repository.
- List the supported package versions and verify that the README links to the policy.
- If an email alternative is offered, publish only an authorized, monitored
  security address and verify that it receives reports.
- Check that npm and source distributions contain no private reporting addresses,
  development credentials, or real user projects.

Complete these checks before activating the reporting policy; the local evaluation
package does not establish that they passed. GitHub and npm publication still
require the user's package testing and separate authorization. Do not announce
released or supported versions, response commitments or other support terms in
the security policy before they have been established.

## Release checklist

Verify a clean source install and build, replace draft installation guidance with the accepted instructions, and link this guide and the security policy from the public README. Recheck all commands and relative links in the exported repository. No npm publication or Git push is implied by running tests or contributing a patch.

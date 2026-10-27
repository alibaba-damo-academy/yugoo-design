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

## Prepare or publish the Companion npm beta

The [Companion workflow](.github/workflows/publish-companion.yml) covers only
`@yugoo-design/companion`; the DSH package publication chain is separate.

For a beta release, update `version` in
[`release/companion-version.json`](release/companion-version.json) to a new exact
`X.Y.Z-beta.N` value alongside the reviewed changes. After synchronizing the
reviewed commit to the public repository's `main`, create and push its matching
Git tag, `vX.Y.Z-beta.N`, in that repository. This tag push automatically builds,
checks and publishes the package. The tag must match the version file at that
exact commit, and the tagged commit must belong to `origin/main` history.
Ordinary `main` pushes, including version-file changes, do not publish a package.

The Git release tag identifies the source commit. npm's `--tag beta` selects the
package's distribution channel; it does not create a Git tag.

For a build-only check, use **Actions → Prepare or publish Companion beta → Run
workflow** and leave **publish** unchecked. Both automatic and manual runs use
the version file in the selected source revision. The optional **version** input
is an expected-version check: if supplied, it must match that file.
The manual entry also remains available for an explicit publication retry.
Dispatch that retry against the matching release tag with **publish** enabled;
the same tag/version and `main`-history checks apply. Publication requests against
branches or other refs fail explicitly.
Read the receipt summary in the run's logs. Prepared archives remain on the
temporary runner; the workflow does not upload downloadable artifacts.
Compilation, pack checks, installed runtime/Host acceptance and registry
publication are separate results. The preparation receipt retains flags for
checks that have not yet passed.

The workflow uses GitHub-hosted Ubuntu, Node `22.22.3`, pnpm `11.7.0` and explicit
npm `11.21.0` for preparation and publication. The package declares Node.js
`>=22.19.0`; CI focuses on Node 22 and 24 without imposing a major-version cap.
Before publishing, CI installs the
same prepared tarball into separate empty directories using
`npm install --engine-strict` on Node `22.22.3` and `24.22.1`. It exercises the
product's `check-runtime` checks for native Git and Sharp and the existing
Ladybug WAL check, then returns to Node `22.22.3` for OIDC publication. These
package-runtime checks do not establish model readiness, browser behavior or
actual Host installation. To run that check locally under each selected Node
version, use the same tarball and expected version with a separate output directory:

```sh
node scripts/check-companion-node-runtime.mjs /absolute/PREPARED.tgz X.Y.Z-beta.N /absolute/NEW_OUTPUT
```

Public exports currently omit the internal lockfile: on that input,
CI first resolves a public-registry lock, then performs a strict frozen install.
The resolved lock is a run input, not a committed reproducibility guarantee.
Dependency caching is explicitly disabled in both setup Actions.
Build permissions come only from `pnpm-workspace.yaml`; preserve exact approved
versions and explicit denials. Keep the Rolldown override at `1.2.4`: the retained
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

The input Release is separate from the Companion npm beta. Its raw addon,
provenance and original license materials must be reviewed against the final
public source commit before that input Release is published. Its tag does not
match the npm workflow's beta-tag trigger. Publishing the inputs, running the
default unauthenticated acquisition, preparing a Companion archive and publishing
that archive are separate steps. Local preparation with an explicit native root
does not prove that the public input assets are available. Until those assets
exist, default preparation fails before downloading the larger legacy donor.
The Darwin request permits only HTTPS GitHub-to-reviewed-CDN delivery, omits
credentials, and enforces the current byte/hash pin and a bounded deadline.
A changed input identity needs a reviewed source/routing update. See the
[preparation entry](scripts/prepare-companion-release.mjs) for the same local
`prepare VERSION ABS_OUTPUT [ABS_NATIVE_ROOT]` dry-run; use `node --import tsx`
after preparing source dependencies. The optional artifact root still passes
the existing source/material gate.

Before the first authorized publication, an npm package maintainer configures
its **Trusted Publisher** for GitHub organization `alibaba-damo-academy`,
repository `yugoo-design`, workflow filename `publish-companion.yml` (filename
only), and no environment name. Enable direct **npm publish** in Allowed actions;
new connections otherwise default to staged publishing. The manual dry-run job
has no OIDC permission. A matching release-tag push or explicit publication retry
against that tag in the public repository selects the publication job. The job
checks that the fixed tagged commit is in `origin/main` history, installs
dependencies, builds once, checks the archive against its receipt and publishes
it on the same runner,
without Artifact transfer. Its OIDC permission covers the whole job, including
installation and build steps: publication therefore trusts the reviewed tagged
source from `main` history, approved dependency scripts and toolchain. Invalid
refs, mismatched tags and commits outside `main` history are rejected before
publication. No npm token secret is
needed. See [npm's trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).
The packaged repository URL must match this public repository; it is maintained
in the package template, never patched into a prepared archive.

Both automatic and manually requested publication build, check and publish only
the exact prepared tarball with the `beta` tag through OIDC. An already published
version is reported and skipped; a registry/network failure is not treated as an
unused version. The workflow does not move `latest`,
run a separate dist-tag command, publish workspace packages, or configure real
Host accounts. npm can supply provenance automatically for eligible public
repositories; OIDC on a private repository does not establish public attestation.
Provenance does not prove independent native binary reproduction or complete
product acceptance.

## Prepare or publish the DSH npm beta

The [DSH workflow](.github/workflows/publish-dsh.yml) prepares the ten packages in
[the DSH dependency closure](packages/dsh/README.md). Its single version authority
is `hosts.dsh.aggregateVersion` in
[`release/release-hosts.json`](release/release-hosts.json), also consumed by the
Companion installer. All ten use that exact version. Companion retains its own
version file, workflow and publication result.

Update that existing DSH field with the reviewed source, synchronize the fixed
commit to public `main`, then push `dsh-vX.Y.Z-beta.N` at that commit. This tag
triggers only DSH publication. `vX.Y.Z-beta.N` remains the Companion trigger;
ordinary `main` pushes publish neither chain. For preparation only, choose
**Actions → Prepare or publish DSH beta → Run workflow** and leave **publish**
unchecked. The optional version input can only confirm the tracked value.
A publication retry must select the same matching DSH tag with **publish** enabled.
Branches, mismatched versions and tags outside reviewed `main` history fail.

The same Node, pnpm, npm, public lock-resolution and native-input policies described
above apply. CI runs each existing normal package build once, with optional
module observation hooks, then passes an explicit current observation receipt
to the existing ten-package assembler. The maintained material manifest still
owns component identities, original material hashes, fonts and prior observations.
Current raw output hashes and component/font associations come from that build;
third-party component metadata changes fail rather than inheriting an old
association. A workspace component carries its actual current manifest identity,
checked against both the disk file and the fixed Git source blob; its prior
metadata hash remains historical. Missing or forged current identities fail.
Unassociated historical components remain identified as historical only. Current
observations and package receipts retain the incomplete-inventory and
unaccepted-license flags; packing does not establish installed Host acceptance.
The runner retains the ten archives and bounded JSON receipts until its job ends;
this workflow does not upload archives or install a real Host.

Before any publication, CI checks all ten exact registry versions. Only a version
404 means absent. An existing version is skipped only when registry metadata SRI
and the downloaded tarball's actual size and SHA-512 match the newly prepared
archive. Any mismatch or network/registry error stops the job. Missing packages
are published in dependency order, with the aggregate last, through OIDC using
only the verified tarballs and `--tag beta`. Dependencies must be visible with
matching bytes before a dependent package is published; every publication and
the final complete set are checked again. A retry that builds different bytes
fails safely and requires a reviewed input/version decision; it never overwrites,
unpublishes, moves a separate dist-tag or blindly skips an existing version.

For **each of the ten scoped packages**, its npm maintainer must verify the
Trusted Publisher identity: GitHub organization `alibaba-damo-academy`, repository
`yugoo-design`, workflow filename **`publish-dsh.yml`**, no environment name, and
Allowed actions including direct **npm publish**. The publish job has
`contents: read` and `id-token: write`; the dry-run job has no OIDC permission.
No stored npm token is used. Preserve Companion's existing
`publish-companion.yml` identity. An inaccessible trust listing does not prove
that a publisher is absent; configuration and a successful OIDC publication
remain separate from source checks. See [npm's Trusted Publisher configuration](https://docs.npmjs.com/trusted-publishers/).

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

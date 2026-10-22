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

## Prepare or publish the Companion npm beta

The manual [Companion workflow](.github/workflows/publish-companion.yml) covers only
`@yugoo-design/companion`; the DSH package publication chain is separate. A source
push does not run it. In **Actions → Prepare or publish Companion beta → Run
workflow**, select the reviewed `main` commit and a new exact `X.Y.Z-beta.N`
version. Leave **publish** unchecked for build/pack checks and the receipt summary
in the run's logs. Prepared archives remain on the temporary runner; the workflow
does not upload downloadable artifacts. Compilation, pack checks,
installed runtime/Host acceptance and registry publication are separate results.
The preparation receipt retains flags for checks that have not yet passed;
review these before making a release decision.

The workflow uses GitHub-hosted Ubuntu, Node `22.22.3`, pnpm `11.7.0` and explicit
npm `11.21.0`. Public exports currently omit the internal lockfile: on that input,
CI first resolves a public-registry lock, then performs a strict frozen install.
The resolved lock is a run input, not a committed reproducibility guarantee.
Dependency caching is explicitly disabled in both setup Actions.
Build permissions come only from `pnpm-workspace.yaml`; preserve exact approved
versions and explicit denials. Keep the Rolldown override at `1.2.4`: the retained
Pica/UI artifact verification used that compiler version. Recheck those artifacts
before reusing their evidence with a different compiler. Installation executes the approved native scripts
within the isolated runner, not within a user Host/profile.

Native Git materials are acquired from the fixed public Companion `beta.16`
archive, verified against its complete pinned SRI, and checked against the
current `packages/git-native/SOURCE.json` by the existing builder. CI never
rebuilds or substitutes those binaries. A changed source/prebuild identity fails
until the maintained donor selection is reviewed. See the
[preparation entry](scripts/prepare-companion-release.mjs) for the same local
`prepare VERSION ABS_OUTPUT [ABS_NATIVE_ROOT]` dry-run; use `node --import tsx`
after preparing source dependencies. The optional artifact root still passes
the existing source/material gate.

Before the first authorized publication, an npm package maintainer configures
its **Trusted Publisher** for GitHub organization `alibaba-damo-academy`,
repository `yugoo-design`, workflow filename `publish-companion.yml` (filename
only), and no environment name. Enable direct **npm publish** in Allowed actions;
new connections otherwise default to staged publishing. The default dry-run job
has no OIDC permission. Only an explicit publication request on this repository's
`main` branch selects the publication job. That job installs dependencies, builds
once, checks the archive against its receipt and publishes it on the same runner,
without Artifact transfer. Its OIDC permission covers the whole job, including
installation and build steps: publication therefore trusts the reviewed `main`
source, approved dependency scripts and toolchain. A publication request on
another ref fails explicitly in the unprivileged job. No npm token secret is
needed. See [npm's trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).
The packaged repository URL must match this public repository; it is maintained
in the package template, never patched into a prepared archive.

Only after an explicit release decision for that version, rerun the manual
workflow on `main` with **publish** checked. It builds, checks and publishes only
that exact tarball with the `beta` tag through OIDC. It does not move `latest`,
run a separate dist-tag command, publish workspace packages, or configure real
Host accounts. npm can supply provenance automatically for eligible public
repositories; OIDC on a private repository does not establish public attestation.
Provenance does not prove independent native binary reproduction or complete
product acceptance.

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

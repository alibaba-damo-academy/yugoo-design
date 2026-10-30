# Sharing, customizing, and maintaining Kits

English · [简体中文](kit-sharing.md)

Use this page to share and receive Yugoo Design Kits. You can copy the [community workshop example](../../examples/community-workshop-delivery/README.md) directly; see [extension development](extending.en.md) for authoring rules. Kit content and Design Projects are different materials: sharing a Kit does not include user projects, conversations, model credentials, or host installations.

**Version scope:** The in-place Studio editing, direct source import, and project-owned `design_kit` files described below require the unreleased development runtime. The current stable runtime does not provide this workflow. Check [host support](hosts.en.md) and [release status](preview-status.md) before using them. The historical records below retain their original scope.

Choose the delivery method supported by the target release: Studio receives files through source import, complete content directories use the host's loader, and npm packages use release and host-registration paths. On first receipt, verify in an independent project to avoid overwriting content already in use.

## Official Kits

The purposes, delivery status, and actual integration scope of Official Kits are listed below.

Before choosing, read the [official Kit user guide](official-kits.md) to learn what each kind of Panel helps you judge and how to start a small scenario. This section maintains versions, acquisition methods, and integration scope.

**Install the main plugin first, then choose a Kit.** Web App is the official Kit delivered with the main plugin by default; users do not need to install its internal npm modules separately. Companion carries complete Web App content in its payload; the complete DSH distribution loads it through dependencies and package entry points. Bundled content is available, but this does not automatically select it for every project. On first use, create a project through the current host's `yugoo` entry point and select `web_app`. Existing projects continue using their own Kit files; see [restoring older project content](#update-and-restore-project-content) below. See the [installation guide](getting-started.en.md) for obtaining the main plugin.

| Official Kit | Purpose and methods | Acquisition and scope |
| --- | --- | --- |
| Web App (`web_app`) | Software-application requirements, flows, rules, data, pages, AI capabilities, and handoffs; see [methods and content](../../packages/skills-web-app/README.md) | Provided with the main `yugoo-design` plugin; no separate installation of internal content modules is needed. Obtain the required release through the [installation guide](getting-started.en.md). |

npm product releases and Kit/Bundle content are managed separately. Beyond the current default Kit, you can use the public community example below and customize your own methods. Exploration in other domains does not mean those domains ship with the product. See [release status](preview-status.md) and [host scope](hosts.en.md).

### Ask the current Agent to install and select the default Kit

Copy the following request to your current host's Agent along with the [general installation prompt](../../packages/companion/HOSTS.md#default-prompt-any-supported-host):

```text
Follow the general installation prompt to install Yugoo Design for the current host,
preserving existing model, credential, plugin, and project configuration.
Unless I explicitly request a version, resolve npm latest and verify that it is a stable
release; report and stop if it resolves to a prerelease or the requested release is
unavailable. An explicit version takes precedence.
Fetch and verify the exact release version. Web App should come with the main plugin;
do not ask me to install its internal modules individually.
After the host's required activation or new session, check for web_app among the
actually available Kits. Create a new Design Project for me and select it, stating
the Kit identity and content source actually used.
Give specific manual import, authorization, or activation steps only when needed;
if installation fails, report the concrete missing requirement.
```

### Ask the current Agent to connect a delivered independent Kit

Obtaining a package, importing into the local content library, host discovery, and project selection are different results. The request below is for an independent Kit you have received from its author. Do not treat successful `npm install` as automatic registration or overwrite an existing project to try a new Kit:

```text
I have received an independent Kit from its author and want to try it in a new project.
Read the delivered README for the Kit's purpose, content source, existing license
notices, Bundle dependencies, and host compatibility. If delivered through npm,
also verify the exact package entry point supplied by the author.
First inspect the import or complete-content-package loading entry points the
current installation actually provides.
When importing through Studio, retain the original files. If supporting definitions
are missing, open the editor, explain the specific gaps, and complete them.
Do not treat successful import as proof the content is runnable. If no integration
path is available, report the missing capability rather than inventing commands.
Do not overwrite existing Kits or projects, or automatically install external
execution dependencies.
Select the prepared Kit in a new project, check the project's own Kit and Bundle
files, then verify a nonempty Panel, saving, and reopening. Report acquisition,
loading, saving, and actual native-Agent use separately.
```

For directory integration of complete content packages, see [DSH discovery and selection](#dsh-directory-discovery-and-explicit-selection) and [Companion explicit entry points](#companion-explicit-directories-and-project-selection). Studio source import is described below. The local library keeps one current saved source for each identity; Edit saves it in place, while Copy creates an independent identity. A new project receives a complete content copy when it first selects its Kit. Library changes do not change existing projects. To update one, ask the Agent to compare files and preserve customizations; see [updates and recovery](#update-and-restore-project-content).

## Share through Studio content archives

Studio provides import, editing, and export in the existing Kit and Bundle workspaces; check the target host's version for the available interface. They use the same current saved source, without a separate preparation/adoption or local-version publication step.

For authors sharing current content:

1. Open the Kit or Bundle you want to share and save the changes to deliver.
2. Export the current source ZIP. A Kit export includes mounted Bundle files and resources; Bundles can also be exported independently. Unfinished definitions can be exported for someone else to help complete. Source and license metadata are optional, while existing LICENSE, NOTICE, and source notices remain in the files.
3. Supply a short README: the intended task, host/plugin version, optional or required external environment, one synthetic request, and the actual verification scope. Follow the license and attribution requirements below.

For recipients importing and trying it:

1. Select a source ZIP, folder, or single `SKILL.md` through the existing import entry point. A standalone Bundle needs `SKILL.md`; a Kit needs `mindset.md` and `kit.yaml`. The same entry point can parse legacy archive JSON and import its files.
2. Import creates an independent identity and retains the original files. Repeated display names are disambiguated automatically; existing content is not overwritten. Missing supporting files or incomplete definitions can still be saved and completed in the editor, with diagnostics showing the specific gaps.
3. Complete the content through source files and mount management. You can ask the current host's Agent to help, reviewing and saving its changes through the same diff and save path. Editing does not require separate provenance/license fields or their approval.
4. Select the prepared Kit in an independent new project, check the complete Kit and Bundle files copied into that project, then complete [recipient verification](#minimum-checks-for-author-and-recipient). Mount an independent Bundle in a Kit explicitly before using it.

Import receives source content without executing scripts, installing models or Providers, or changing existing projects. Successful import, loadable definitions, a working Panel preview, and actual native-Agent consumption are different results. Existing source versions and archive hashes retain provenance and integrity; they are not a local version selector. See the [archive contract](../../packages/studio/docs/content-archive.md) for transport formats and resource boundaries.

## Delivery format and dependencies

A runnable Kit delivery must retain **the Kit and its complete mounted Bundle content**. The current file layout separates `kits/` and `bundles/`. A content package can organize them with an entry point declared by `package.json.designSystem.kit`. Pass the package root to an entry point supporting package resolution; a bare Kit directory also needs a Bundle resolver matching its declarations. The presence of `mindset.md` alone does not establish complete dependencies. See [current content organization](extending.en.md#current-content-organization).

ZIP and Git can transport complete files. For a directory loader, unzip first and then use the package or directory entry point. Studio receives files through its source-import entry point. Its archive wrapper retains file hashes; check the installed version and [archive contract](../../packages/studio/docs/content-archive.md). Sharing only a Panel or a user's Design Files does not replace a complete Kit.

Each delivery should contain, or list in its README:

- The Kit's stable `name`, each Bundle's identity, and existing source versions. Retain manifests, methods, schema, validation, Panel, summary declarations, locale resources, and method-referenced files. Declarative summaries use `skill.yaml.summary`.
- Original LICENSE/NOTICE materials and required attribution for copied content and third-party materials. Compression and Git sharing do not change licenses; do not attribute a runtime component's license to Kit-owned code.
- Compatibility requirements: the actual host/plugin version and required declarative components, resource protocols, or native Providers. Only verified versions can be called supported. Loading a manifest does not establish that every interaction is compatible.
- Scripts and external dependencies: list invoked scripts, environments, packages, and services, stating which are included and which need separate installation. A directory loader does not execute installation scripts, resolve npm dependencies, or download external Kits automatically. Report specific missing dependencies rather than asking the Agent to invent replacements.
- Restorable originals and update notes: share a complete, identifiable directory snapshot, optionally with file hashes, and explain schema or semantic changes. Version metadata or provenance alone cannot replace complete content backups.

The community workshop example is a content Kit requiring no external service or solver, reusing installed generic Panel components. Its directory/ZIP results are described below. Kits requiring native Providers, additional script environments, or external packages must provide their dependency installation paths; this example does not establish that those Kits run merely by unzipping them.

### Choosing npm content packages

npm distributes the plugin and independently updated content packages; GitHub provides public source. A Kit may be delivered as an npm package, Studio archive, or complete directory, optionally zipped. State the format so recipients can choose the appropriate installation, import, or loading entry point.

The Kit loader has no universal npm installation, dependency-resolution, or automatic-registration entry point. Successful `npm install` does not mean the Kit is selected. Distribution still needs an agreed package Kit root, identity/version, retained licenses, and a host explicitly connecting the installed directory to its loader. Packages with runtime code separately need host registration, dependencies, and security requirements. The unified product package is `yugoo-design`; internal `@yugoo-design` modules and historical `beta` records are not another product installation path. See [release status](preview-status.md) for available releases.

npm publication retains its release-version process. Saving local content is not npm publication and does not require changing upstream version metadata. Publishing your own package requires account permission and its separate release procedure. For official content, use the list above; other Kit authors must provide accurate package names, versions, and host integration instructions.

## First save restorable originals

1. Save the complete content package or equivalent complete file set: `mindset.md`, `kit.yaml`, optional relation declarations, each independent Bundle's methods and resources, LICENSE, and NOTICE. Record Kit, Mindset, and Bundle identities and existing source versions. Legacy examples' `skills/` layout uses its compatible loader; it is not the directory convention for new content.
2. Keep unmodified originals or a complete ZIP outside discovery directories. Use independent copies for trials and customization rather than overwriting recipients' existing content. A directory name alone does not change a Kit identity.
3. Match delivery formats to entry points: Studio accepts source ZIPs, folders, and the minimal method files described above; directory loaders accept extracted content packages, while bare Kit directories need their Bundle references resolvable.
4. For first use, create a new project, check its actual Kit identity, then generate, edit, and save.

A runtime implementing the current contract copies complete content when a project first selects its Kit:

```text
design_kit/
  source.json
  kit/                 # Mindset, kit.yaml, and Kit-owned resources
  bundles/<identity>/  # complete methods, definitions, and resources of mounted Bundles
```

Agent methods, schema, validation, Panel, summaries, and resource reads all use these project files. Subsequent edits or removal of library Kits/Bundles do not affect existing projects; new projects take current content when they first select a Kit. Back up the whole project and Git history, including `design_kit`, rather than only `design_files`.

This does not include separately installed native Providers, external services, or execution environments. Copying content does not grant runtime-code trust. An older project without `design_kit` can initialize it only from the original Kit/Bundle content it actually recorded and retained. A pin or content hash cannot replace originals; restore missing content rather than silently substituting a newer version.

## Independent customization: copy to a new identity

To change an existing method, choose Edit in Studio and save in place. This creates no local version and requires no publication confirmation or remount. Choose Copy explicitly when you want to preserve the original method and maintain an independent variant:

1. Give the copy an independent stable identity and adjust its display name, description, methods, and examples. Renaming a directory alone does not create a new content identity.
2. Check Bundle manifests, resources, and identity references. If `relations.yaml` exists, update its Kit namespace and domain references. Do not blindly replace user data or canonical field names.
3. A Kit copy continues mounting library Bundle identities and uses their current saved content. It does not automatically receive an independent copy of each Bundle. To customize a Bundle independently, copy that Bundle explicitly and adjust the Kit's mount.
4. For file-based sources, a new Bundle directory and `skill.yaml.identity` identify the independent content; the mount's `name` in `kit.yaml` points to that identity. Runtime `skill.yaml.name` and mount `bindingKey` retain their existing conventions and canonical data paths. `<design_skills>` is the model-facing projection of mounts, not a second membership authority.
5. Retain source attribution and license materials. A new identity does not inherit native Provider trust, and runtime bindings must not be duplicated within one Kit. Select the copy in a new project and verify it; older projects continue using their own files.

Do not change a Kit `name` directly in a DSH source already loaded by the running process. Prepare the independent copy in a new directory, then connect it through the actual discovery entry point. A project's initial copy of the complete Kit and Bundles is different from Copy Kit within the library; see the file layout above.

<a id="dsh-discovery-conflicts-and-explicit-version-switching"></a>

## DSH: directory discovery and explicit selection

The installed default discovery root is `$DSH_HOME/design-system/kits`, or `~/.dsh/design-system/kits` when DSH_HOME is unset. Put the Kit in a direct child directory; additional roots use the loader's `discoveryRoots` configuration. It does not recursively scan all workspaces or execute Kit scripts. Check that the installed version includes discovery; source changes do not update an older installation.

A DSH loader with content watching can revalidate and reload valid changes in the running process. Invalid changes or temporarily moved sources retain the last successfully loaded content and report diagnostics. A selectable catalog entry therefore does not prove the new changes loaded. Check the displayed identity, version, and source, then verify the changes in an independent project.

Last-good content is retained only in process memory, not as a complete backup. Deleting the source directory may also remove its scripts; after restart, only actual existing sources can be read. Restore complete originals rather than relying on process caches. Valid content reload affects what later new projects receive, without rewriting existing projects' `design_kit` files.

For a new project in the current DSH session, use these entry points; older installed candidates follow their bundled guide:

```text
/yugoo new workshop-copy
/yugoo kit community_workshop_delivery
```

You can also select through the host's actual Design selector or Agent. Check the displayed Kit identity and source, and inspect the content copied into the new project.

**Two directories with the same name are not merged by version.** Explicit sources load first. Default discovery roots precede additional roots; additional roots follow configuration order, and directories within each root follow name order. Different sources with the same name produce a diagnostic while retaining the registered source, even if their declared versions differ. Keep both backups, move the unused same-name directory out of discovery roots or give an independent customization a new identity, then restart normally and check the catalog. Do not rely on directory ordering to choose an upgrade.

**When a new project first selects a Kit**, the runtime validates the complete Kit and copies its files and all mounted Bundles. Incomplete library content can still be saved, but missing definitions needed to run it must be completed first. Successful import is not a substitute for checking that it loads.

Reselecting a same-name Kit in an existing project does not copy library changes over its files. To change identity or update content, explain the goal, preserve project customizations, and compare files. See [updates and recovery](#update-and-restore-project-content); changing only version strings or project metadata does not replace content.

<a id="companion-explicit-directories-and-upgrade-limits"></a>

## Companion: explicit directories and project selection

Companion for Codex, Claude Code, and Qoder CLI uses the installed plugin's actual entry points, with `--kit /absolute/content-entry` naming an entry point supported by that release. A structured content package uses its package root. A bare Kit directory must resolve complete mounted Bundle definitions; moving only `mindset.md` does not make dependencies discoverable.

Project commands, MCP, and Panel services must use the same directory and project-management state, retaining the host's existing session/thread binding and startup instructions; see [Companion documentation](../../packages/companion/README.md). Do not reuse DSH discovery roots expecting automatic Companion discovery or invent a universal installation command.

### Create a new project with a complete content package

The Bash example below uses the project runtime entry point inside the target npm installation. Check that it includes `payload/shared/scripts/design.mjs` and supply a complete Kit and Bundles through the [content-package entry](extending.en.md#current-content-organization). `yugoo-design` is the product installer command, not a replacement for these project commands. Have the current Codex Agent supply the actual installation directory, complete package root, and current session ID. State and project directories must be new and independent rather than borrowing existing project configuration:

```bash
YUGOO_RUNTIME="/absolute/npm-install/node_modules/yugoo-design"
YUGOO_KIT="/absolute/my-content-package"
YUGOO_STATE="/absolute/new-companion-state"
YUGOO_PROJECTS="/absolute/new-design-projects"
YUGOO_THREAD="当前 Codex 会话的真实 ID"
yugoo_args=(--kit "$YUGOO_KIT" --state-root "$YUGOO_STATE"
  --projects-root "$YUGOO_PROJECTS" --host codex --thread "$YUGOO_THREAD")
node "$YUGOO_RUNTIME/payload/shared/scripts/design.mjs" command \
  --input "new Workshop" "${yugoo_args[@]}"
node "$YUGOO_RUNTIME/payload/shared/scripts/design.mjs" command \
  --input "kit my_kit" "${yugoo_args[@]}"
```

The Chinese placeholder for `YUGOO_THREAD` means “the real ID of the current Codex session”; replace it with that actual ID.

`my_kit` must match the delivered package's Mindset `name`. Check the returned available Kits, project root, and Kit files copied into the project. Then follow the target host guide so MCP and Panel services use the same `--kit`, project-management state, and real session binding, and connect to the new service. Claude Code and Qoder CLI use their own `--host` values and native session arguments rather than the example's Codex session.

This step uses the complete package delivered by the author, not Studio's storage directory. Do not pass a single local Kit record's `sourceRoot` as a package root containing all Bundles to `--kit`. Studio-imported content uses the existing library-selection entry point in the same state directory. Complete missing mounts in the editor rather than reassembling the library's internal storage files.

Companion's `kit <kit>` selects a Kit provided by the current service. New projects receive complete content copies; existing projects keep their own files when library content is saved. To try a Kit separately, use actual new project directories and their corresponding service connection, preserving the original project. A connection file still bound to old directories is not a new connection. Check the target installed version to confirm that commands, MCP, and Panel all implement this contract.

<a id="missing-versions-and-restoring-original-content"></a>

## Update and restore project content

Editing the library prepares methods for future projects. Updating an existing project changes that project's own Kit files:

When the Agent edits project files directly, it uses the host's existing write permissions. If the project is outside the current workspace, use the host's access settings or permission prompt to confirm write access to that directory before continuing. When editing in Studio, use its normal Save action.

1. Save pending edits and retain the complete project and Git history. Identify the intended source and goal; new library files or upstream versions do not authorize an automatic update.
2. Ask the current host Agent to compare the project's `design_kit` with the target content, explain meaningful differences, and preserve project customizations, resources, and identifiers. Schema or method changes also require inspecting affected Design Files, cross-Bundle references, and genuinely missing business decisions.
3. Check and record the changes through existing validation, saving, and project Git workflows. Revisions to design facts still use the owning Bundle's existing validated publication path. Local content updates add no candidate, adoption transaction, page-observation gate, or upgrade state machine.
4. Open affected Panels and check reading, editing, saving, and reopening, then confirm the Agent uses the new project files. Actual project-definition changes during an invocation produce a conflict; retry against current files rather than combining old and new definitions. Library edits alone must not invalidate an existing invocation.

If a project with `design_kit` fails to load, repair the indicated file or restore the needed originals from that project's backups and Git history. Invalid project files do not silently fall back to the library. Restoring methods or Panels does not automatically undo saved design data; check that their meanings still agree.

For older projects without this tree, retain project files, Git history, and original Kit backups. Restore the complete Kit/Bundle content actually referenced, including recorded Bundle overrides and resources, so the corresponding runtime can initialize it. If originals are missing, report that and restore them, or let the user explicitly choose an update. Do not relabel new library content with an old version string and call it the original. Process-level last-good content is not a complete backup.

The `migrate` project command preserves an original project while moving its Design Files into a new project for validation and adaptation. It is separate from content maintenance within the same project, does not download or recover missing Kits, and does not copy complete history unchanged. See the [command reference](commands.md) for arguments and [project files](project-files.md) for what is retained. Git repositories, marketplace installation, and automatic external-dependency installation are not implied capabilities. See the [project content contract](kit-sharing.en.md#update-and-restore-project-content).

## Verified scope and applicability limits

<a id="verification-scope-for-selection-after-adoption"></a>

### Verification scope for selection after legacy adoption

The records below concern the older archive preparation/adoption flow. They describe its actual results, not acceptance of the simplified import, in-place editing, or project-owned Kit file contract above. Current-source checks, browser interaction, native-Agent consumption, and installed-package verification must be recorded separately.

Importing materials, selecting a Kit, running methods, saving changes, and Agent continuation are different results. First confirm the Kit/Bundle identities and complete methods and resources in an independent new project, then perform the author/recipient checks below. Content needing models or external tools must actually run in the target host. One example with no external dependencies does not establish compatibility for other Kits or hosts.

### Minimum checks for author and recipient

A shareable Kit must do more than import. Author and independent recipient each record the plugin version, Kit/Bundle identities and actual source files, existing source versions, synthetic materials, and actual results:

| Check | Author | Independent recipient |
| --- | --- | --- |
| Complete resources | Read complete methods, contracts, and referenced resources through the runtime entry point | Read them using only delivered materials and public guides |
| Loading and validation | A valid nonempty example passes; invalid input is rejected | Load the corresponding content in a clean, independent configuration |
| Native design | Generate a valuable design result | Generate a result without the author's original session or private files |
| Interaction and continuation | Edit, save normally, reopen, and let the Agent continue from changes | Independently repeat the same loop |
| External execution | Actually run as needed, retaining inputs, results, and limits | Verify dependency availability; explicitly record capabilities not run |

An operations-research modeling Kit claiming solving capability must also actually solve, explain results, and recompute after constraints or parameters change. Generating a model, reading a manifest, previewing a Panel, or importing an example does not prove solving completed. Recipients cannot depend on private absolute paths, source workspaces, or undelivered dependencies on the author's machine.

These are delivery-verification requirements. Verification of an ordinary declarative Kit does not replace real solving and recomputation for an operations-research Kit, or other extension testing involving execution dependencies. There is no promise of automatic migration for every historical content format. `migrate` retains an existing Design Project's original and validates/adapts content to the current contract in a new project, separately from restoring missing exact Kit originals.

### Existing example records

The public community workshop example uses the legacy compatible layout. Its complete directory and ZIP previously completed loading, generation, Panel editing, saving, continuation, and reopening in author and independent-recipient profiles in the corresponding installation setup. This is a historical record for that older installation setup, not evidence that every step of the simplified current content-maintenance flow has had a new end-to-end run. It does not generalize to every host or a second machine. Follow the target installed version's actual capabilities and error messages. That historical example does not prove a new independent content combination has completed the same acceptance. This guide does not require rebuilding the runtime for declarative Kits.

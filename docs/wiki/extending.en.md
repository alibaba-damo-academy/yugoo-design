# Extension development

[中文版](extending.md)

This page is for Yugoo Design Kit and Bundle developers. The [Bundle contract](../bundle-contract.md) and [architecture baseline](../system-design-baseline.md) govern runtime responsibilities, versions, and publication rules.

The in-place editing and project-owned content described below apply to the current development source. Installed releases support them only when they include the corresponding runtime. The library retains current content for each identity; new projects copy the complete Kit and mounted Bundles into their own `design_kit`, while existing projects keep using their own files. Source versions provide provenance, and ordinary local saves require no release. See [project content maintenance](../project-content-upgrade.md) for the file lifecycle.

For a first customization, try the [minimal client-delivery rules tutorial](custom-kit-tutorial.en.md): copy a complete declarative Bundle, write domain guidance, change Panel copy and a nonempty example, then validate and inspect it. The references below cover responsibilities, structure, and validation questions for changes beyond that exercise.

## First decide what you want to change

A Kit combines a Mindset and its mounted Bundles: a domain expert's way of working and toolbox. The Mindset describes the expert's personality, thinking patterns, and special considerations; a Bundle carries a design dimension that can be examined and maintained independently.

| Goal | Where to change it | Example |
| --- | --- | --- |
| Change domain guidance and method selection | An independent Kit's Mindset | Add a domain strategy to “check existing evidence before deciding whether to ask” |
| Adjust a dimension's method or interaction | An independent Bundle and related contracts | Add domain judgment to function modules, or change how cards and details are presented |
| Combine existing capabilities | A Kit's Bundle mounts | Choose capabilities suited to the domain, rather than copying every official Bundle |
| Add an interaction existing components cannot provide | A shared component or trusted Provider | A new domain editor; requires runtime implementation and distribution |

Organize a Bundle around a design result that people can examine, save, and continue revising independently. Functional scope, business flows, and mathematical models each contain things to understand and judge; one result can also use a canvas, table, and detail form together. A button, menu, or single tool call usually does not constitute an independent Bundle.

When separating Bundles, explain which facts each owns, which existing results it references, and what judgment the user makes there. A mathematical model and its solve results may separately maintain the model definition and execution evidence; table and matrix views may instead be two representations of the same data. Connect Bundles through references and existing cooperation mechanisms without storing the same fact twice.

## A minimal authoring loop

1. **Define the task and result.** Identify the intended users, decisions they need to make, available materials, and the smallest valuable design result. Use a synthetic scenario as an example and make unknowns explicit.
2. **Choose an existing starting point.** Edit an existing identity to save its current content. For an independent alternative, copy the Kit, copy relevant Bundles as needed, and adjust its mounts. Retain complete methods and licensed resources with the copy; see [scaffolding and copying](#create-a-scaffold) below.
3. **Maintain methods and data together.** Explain how to choose evidence, produce a design, and revise existing facts, then define the output structure and validation. A schema link or generic operating hints cannot replace the method body.
4. **Represent and check the result.** Choose suitable diagrams, tables, cards, or workspaces from components supported by the target version, and bind editing to canonical fields. Maintain a nonempty, validatable synthetic example for each new or updated Bundle; declarative Panels needing Studio preview use the `reference/preview.json` read by that entry point. See [examples and validation](#examples-and-validation); this adds no universal required loader slot.
5. **Use the actual runtime entry point.** Load complete content, confirm that methods and referenced resources can be read, and check valid and invalid inputs. Then generate, edit, save, reopen, and continue in an independent project, checking whether changes affect related results.
6. **Hand it to an independent recipient.** Supply complete resources, versions, dependencies, licenses, and a minimal request so the recipient can import or load it using public instructions and complete the same loop; see the [sharing guide](kit-sharing.en.md#minimum-checks-for-author-and-recipient).

The authoring Skills divide responsibilities as [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md) → [Bundle Creator](../../.agents/skills/design-bundle-creator/SKILL.md) → [Skill Creator](../../.agents/skills/design-skill-creator/SKILL.md). This combines authoring methods; it does not require extra Agents. One executor can complete them sequentially. Copy changes alone, successful loading alone, and example previews cannot replace acceptance through real use of a new capability.

## Design the Kit and Bundles together

Mindset authoring is available through the shared [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md); see the [Mindset authoring standard](../../.agents/skills/design-kit-creator/references/mindset-authoring.md). The automatically mounted catalog already provides ordinary Skill entries. The body adds the expert's identity, personality and thinking style, important cross-Bundle dependencies, special conventions, and professional judgment while keeping persistent context concise. Creators choose the expert's collaboration style; they need not copy the official Kit's consulting-style chapters or repeat descriptions of every capability.

Bundles provide concrete methods and tools for expression. The Mindset organizes their use and combines with Bundle handoff strategies to form a collaboration rhythm. Official Kits use consulting-style guidance; other Kits may explore outputs in a batch and review them together. Good domain guidance chooses methods from what the user already knows, the current purpose, and existing design, explains why the work is worthwhile, and reassesses next steps after results are saved.

For example, an optimization-modeling Kit for users who know their business but not mathematical modeling should first use familiar business language to show objects, rules, and small examples for confirmation, then gradually explain the model and computed results. If a data Panel asks users to fill fields, the Mindset cannot describe that same interaction as “the system has already prepared everything from your materials; simply confirm.” Both must describe the actual interaction together.

When changing a Bundle's responsibilities, fields, results, or interactions, also review the Kit introduction, mount descriptions, and Mindset. Does it still recommend the right capability? Does it know what users can see and change in the Panel? Can it explain the result and its later effects? Use a bounded case—“user states a goal → Agent develops a concrete result → user gives feedback → Agent revises or suggests the next step”—to check coherence; the case need not run every Bundle.

## Maintain content with Studio

Studio helps authors inspect how their professional methods are actually expressed. Start by viewing existing Bundle methods and examples, operating the relevant views, and recording the specific objects, expected behavior, and actual problems before changing them.

In the current Studio, choose “编辑” (Edit) to open the current files under the same identity; use “复制” (Copy) for an independent alternative. You can save incomplete source and complete it using the actual loading or preview diagnostics. Versions supporting Host-conversation authoring can hand the current object and change request to the original Host Agent, inspect proposals in the same source and preview, and explicitly save them. Without that connection, a development Agent can maintain the complete Bundle's methods, data structure, validation and components in an independent authoring source, then return to Studio for inspection. A native “试运行” (Trial run) checks generation from saved methods; still check saving, reopening and continuation in a Design Project.

In each round, check the identity and source Studio is reading, then inspect saved methods, resources and examples. Changes to Panel declarations supported by existing components are content maintenance; new shared components require a corresponding runtime build and release. Library saves affect future projects. To update an existing project, ask the Agent to compare the library with its `design_kit`, preserve customizations, and use ordinary file editing, validation and Git. Check previews, source saves, project-file updates and npm publication separately; local editing needs no extra publication or adoption step. See the [Studio usage guide](usage.en.md#6-studio-inspect-customize-and-check-kits) for operations and [sharing and project maintenance](kit-sharing.en.md) for delivery.

## Choose an extension type

A purely declarative Kit contains only content and does not require Core changes. A Bundle can use the generic declarative Panel. Add a Provider plugin only when trusted execution logic, a native React Panel, or specialized artifact handling is needed.

A Kit cannot create its own model Client or control whether Design Projects, Studio, or G/R/A are started or stopped. Models, credentials, questions, and Subagents always come from the Agent Host.

When choosing an interaction form, declarative layouts or A2UI can organize questions, tables, charts, prototypes, and whiteboards from supported components; specialized editors can also be reused. Save current library files, or revise a project's own files when its update is requested. New runtime components or trusted native providers require a corresponding runtime release. See the [Bundle contract](../bundle-contract.md) and [Panel DSL](../dsl-spec.md).

## Create a scaffold

You can begin by copying the [field-operations content example](../../examples/field-operations-shared/README.md). It contains a complete Mindset, a declarative Bundle, bilingual labels, an output contract, and a nonempty example clearly marked as synthetic. Connect the copy through the Host's supported Kit-loading entry point, then select it for a new project; this content customization requires no Core changes. The example README records the results of loading from an independent directory and reading the customized content back.

The target directory must not exist, even as an empty directory or symlink, to avoid overwriting a Kit already created. Kit and Bundle directory identities use letters, digits, or underscores, begin with a lowercase letter, and are checked by the target loader. Bundle identity is independent of Kit identity; one Kit cannot mount the same identity twice or occupy the same runtime binding twice. A scaffold is only a starting point, not a complete professional method or a Kit accepted through a real Agent.

### Ask an Agent to copy and customize the Web App Kit

You can give the following request to an existing Host Agent:

> Copy the complete Web App Kit from the actual current installation or source to an independent directory that does not yet exist.
> Preserve LICENSE, NOTICE, third-party notices, and every method resource. Change the copy's Mindset name
> to workshop_web_copy. Initially change only the domain guidance and retain all Bundle identities and mount declarations in kit.yaml.
> Do not change Core, the original Kit, existing project files, fields, stable IDs, or artifact paths.
> Load the copy through the public Kit loader of the target installed version, read the method's referenced resources,
> and validate a nonempty synthetic example and invalid inputs. Report actual results, then provide the Host's existing explicit selection entry point.

A Kit's identity comes from the frontmatter of `mindset.md`; changing only the directory name or npm package name does not create a new Kit identity. To publish an independent npm package, choose your own package name and version without overwriting the original package. Copying a Kit retains its Bundle identity references; it does not also create an independent identity for every Bundle. To customize the UI copy or methods of a Bundle such as `function_modules`, use the target version's supported independent Bundle-authoring entry point to create a new directory identity (catalog identity), change the copy, and explicitly update the Kit mount. This identity is separate from the runtime `name`: retain the original runtime name, method conventions, and canonical data paths, without bulk-replacing user fields. A new identity does not inherit the original native Provider's trust; runtime bindings within one Kit must still be unique. Retain originals and restorable backups; use copying for an independent identity rather than just renaming a directory.

If an independent Bundle copy changes only translations, edit its `locales/`. If fields or interactions change, check schema, validation, Panel, and output contract together. Existing declarative components can be reused through content loading without recompiling Core; new interaction capabilities still require shared runtime implementation. The complete Web App Kit has script dependencies; copying its directory does not install them. Follow its README to distinguish an independent directory from a self-contained Companion.

After customization, inspect affected methods, copy, resources, and examples in an independent project, then confirm the experience through actual generation, editing, saving, and reopening. Existing checks of unchanged example content can be reused; new methods or interactions need validation of their changes. Choose checks by risk, then share the complete directory. See the [Kit sharing guide](kit-sharing.en.md) for discovery, project selection, and restoring originals.

### Current content organization

A Kit combines methods and Bundle identity references; each Bundle independently maintains its methods, data, and presentation contracts. The current Web App content package is an example:

```text
my-content-package/
├── package.json
├── kits/
│   └── my_kit/
│       ├── mindset.md
│       ├── kit.yaml           # 精确 Bundle 挂载清单
│       └── relations.yaml     # 可选：Kit 级 KAG 关系扩展
└── bundles/
    └── my_bundle/
        ├── SKILL.md
        ├── skill.yaml         # 身份、执行与交接；可选 summary
        ├── schema.yaml
        ├── validation.yaml
        ├── panel.yaml         # 声明式面板
        └── reference/
            └── artifact-contract.md
```

In this tree, `kit.yaml` is the exact Bundle mount manifest; `relations.yaml` is an optional Kit-level KAG relationship extension; `skill.yaml` declares identity, execution, handoff, and optional summary; `panel.yaml` declares the declarative Panel.

`package.json.designSystem.kit` declares the Kit `root`, `mindset`, mount `manifest`, and Bundle search directory `bundles`. **All four paths are relative to the package root** and cannot be absolute or escape the package directory; `mindset` and `manifest` are not relative to `root`. The directory above can use:

```json
{
  "designSystem": {
    "kit": {
      "root": "./kits/my_kit",
      "mindset": "./kits/my_kit/mindset.md",
      "manifest": "./kits/my_kit/kit.yaml",
      "bundles": "./bundles"
    }
  }
}
```

An npm package is only a distribution container; Kit and Bundle identities, versions, and lifecycles are independent. Loading a package root uses the generic Kit resolver; loading only a Kit directory also requires a resolver for its mounted Bundles. The Bundle directory name corresponds to `skill.yaml.identity`; a mount's `name` uses that identity, and `bindingKey` matches the runtime `skill.yaml.name`. The Mindset's `<design_skills>` displays method entries by `bindingKey`. See the [official content package](../../packages/skills-web-app/README.md) for configuration and [Companion explicit selection](kit-sharing.en.md#companion-explicit-directories-and-project-selection) for actual loading steps.

The repository's old `scripts/create-design-system.mjs` scaffold still generates a `mindset.md + skills/` layout and cannot directly serve as the current independent-directory template. For new content, use the existing [Kit Creator](../../.agents/skills/design-kit-creator/SKILL.md) and current content package. Examples with the legacy layout must be checked against their target loader version. Kit content remains Host-neutral and contains no Cordis profile patch, model Provider, or DSH dependency.

## Optional KAG relationship extensions

Core provides a small, cross-Kit vocabulary of generic relationships. A Kit needs a root `relations.yaml` only when its domain relationships cannot fit Core's vocabulary accurately; no fields are added to Bundle schemas or Design Files. Studio's display and editing entry points depend on the actual installed version; relationship declarations must still pass Core validation and exact-version resolution.

```yaml
schema_version: 1
relations:
  - type: my_kit:validates
    meaning: supports
    direction: forward
    label:
      zh: 验证
      en: Validates
    description:
      zh: A 的证据验证 B
      en: Evidence from A validates B
    # 以下约束全部可选。类型 id 来自 Studio/图谱详情显示的
    # `{kit}/{bundle}#{schema-pointer}`，不是 Design File 新字段。
    domain: [my_kit/research#/properties/evidence/value]
    range: [my_kit/research#/properties/claims/value]
    cardinality: { from: many, to: one }
    reasoning: { impact: true, causal: false, transitive: false }
    evidence: { minimum: explicit }
```

The constraints below the example's comment are all optional. Their type IDs come from the `{kit}/{bundle}#{schema-pointer}` shown in Studio / graph details, rather than new Design File fields.

- `type` must use the current Kit's `kit_name:local-name` namespace and cannot override Core types.
- `meaning` can reuse Core semantics or declare more specialized semantics in the current Kit's namespace.
- Structural `contains` is maintained only by Design File projection; it cannot be reused by Kit extensions or inferred by GRA.
- `direction` must be `forward` or `symmetric`; when reusing Core semantics, direction must match.
- `label` and `description` must both provide Chinese and English. Declarations are compiled with an exact Kit version and produce a content pin.
- `domain`, `range`, `inverse`, `cardinality`, `reasoning`, and `evidence` are optional conservative constraints. Referencing a nonexistent ontology type or relationship fails Kit loading, without falling back to guesses.
- Agents prefer an accurate Kit extension, then an inferable Core relationship. If neither fits, they write a bounded raw type such as `unknown:related-context`. Core classifies it as `unknown`, retaining the raw type for display and exact queries without assigning causal, dependency, or directional semantics.

Each Kit's ontology types and property shapes are automatically compiled from existing `schema.yaml` files, so Kit authors do not need an `ontology.yaml` or `designRoles` in Design Files. Graph details show each instance's automatic type, and Studio displays optional relationship extensions and their constraints. Content changes use the editing and saving entry points supported by the actual installed version.

## Declare optional knowledge projection

Bundle authors can use `knowledge` on `schema.yaml` fields to distinguish technical metadata, explicit references, and content granularity. Declarations affect only the derived knowledge graph: they do not remove values from Design Files or require users to fill in separate graph-classification fields. Without declarations, ordinary content is retained; metadata and business relationships are not guessed from field or Bundle names.

```yaml
type: object
properties:
  schema_version:
    type: number
    knowledge: { role: metadata }
  records:
    type: map
    value:
      type: object
      properties:
        name: { type: string }
  selected_record:
    type: string
    knowledge: { role: reference, target: '#/records' }
```

- `metadata` excludes the field or subtree from graph nodes, node context, and downstream semantic indexes while retaining the original value. Business names such as `version` are not automatically treated as technical metadata.
- `reference` declares an explicit reference on a string leaf; array references are declared on `items`. Optional `target` is `#/集合路径` within the current file or `bundle/bundle.json#/集合路径` in another canonical file, where “集合路径” means the collection path. It limits matching scope without granting file access or cross-Bundle write permission. Missing or ambiguous references preserve their literal evidence and produce diagnostics.
- `content` with `granularity: container | unit | property` expresses a content container, independent content unit, or property of its owning content. An optional `label` supplies a readable title without changing identity or source facts. For example, the [function-detail schema](../../packages/skills-web-app/bundles/function_modules/schema.yaml) divides details into core behavior, inputs, results, and boundaries; the [style schema](../../packages/skills-web-app/bundles/design_style/schema.yaml) distinguishes style containers from specific guidelines.

These are optional content-projection declarations, not the responsibility classification `designRoles`. After creation or revision, use the target version's existing schema and Bundle validation entry points, then check that nodes, references, and sources express the original design. Do not change business data to make a graph look attractive. See the [knowledge-source rules](../design-knowledge-source-policy.md) for the distinction between independent sources and assembled outputs, and the [usage guide](usage.en.md#view-kag-and-index-status) for reading the graph.

## Bundle file responsibilities

- `SKILL.md`: frontmatter provides the capability description; the body defines professional methods, how to revise existing artifacts, validation, and close-out requirements.
- `skill.yaml`: stable identity, version, execution placement, handoff, and presentation declarations; optional `summary` defines the model summary. Omitting a summary does not block execution or saving; an explicitly invalid summary must still be fixed.
- `schema.yaml`: validates the on-disk structure of Design state.
- `validation.yaml`: reusable rules and trusted validation contributions.
- `panel.yaml`: generic Panel DSL declaration; see the [Panel DSL](../dsl-spec.md) for syntax.
- `reference/`: readable output contracts and professional references the Bundle needs. Declarative summaries use `skill.yaml.summary`; handle legacy `renderer.md` according to the [Bundle summary migration rules](../bundle-contract.md#declarative-model-summary), without retaining it alongside new declarations.

A Bundle may write only the Design state and artifacts it declares as its own. Cross-Bundle reading supports understanding and validation. To supplement or revise another Bundle, the caller invokes the target owner within existing authorization, validation, and publication boundaries.

Bundles with canvases collect domain canvas methods in `reference/canvas-guide.md`. Use `reference/cooperation-guide.md` when there is an actual cross-Bundle cooperation need. Both must be reachable from `SKILL.md` and the readable output contract, preserving existing specialized guides. Do not create placeholders without the corresponding need; neither guide adds a required loader slot or cross-Bundle write permissions. See the [canvas authoring convention](../../.agents/skills/design-bundle-creator/references/canvas-authoring.md) and [cooperation authoring convention](../../.agents/skills/design-bundle-creator/references/cooperation-authoring.md).

## Panel choices

Prefer declarative Panels so Kit content can load without recompiling the Panel runtime. If native React or executable behavior is needed, the Provider registers a stable contribution ID and the Bundle references only that ID.

The authoring entry point is [Bundle Creator](../../.agents/skills/design-bundle-creator/SKILL.md)'s [Panel declaration guide](../../.agents/skills/design-bundle-creator/references/panel-authoring.md). First choose a representation from the user's decision and actual data, then check properties and field bindings against the target version's component catalog. Do not guess component names from familiar UI frameworks. Component-query scripts target source checkouts; an npm installation need not include development source. After Companion installation, its MCP `design_list_panel_components` can query the component catalog with `{}`, or an exact name with `{ "name": "record_workspace" }`. No project creation or connection is required first. Confirm the entry point in the actual installed version's `tools/list`; an old installation does not gain tools from source changes. The catalog helps select capabilities and is not a complete property schema; properties and bindings must still be checked against the target version's contract, without guessing from names. See [installed component discovery](../../packages/companion/README.md#discover-panel-components-before-authoring). New packages carrying authoring references can use the same tool on demand, for example `{ "name": "record_form", "reference": "contract" }`, or set `reference` to `docs` or `examples`. A returned `read` object can be passed as the same tool's next arguments. For exact nested declarations, add `type`, for example `ComponentNode.navigation_map.edges`, only for `contract`. These calls read resources in the same package and require no source checkout. Missing materials or a mismatch with the component catalog are explicitly rejected, without searching local source instead. Returned values state documentation coverage, the absence of existing use cases, and limits of structural-only validation. Host callback declarations do not grant DSL permission to execute scripts. [Skill Creator](../../.agents/skills/design-skill-creator/SKILL.md) maintains method instructions; changes involving Panel, schema, or bindings must return to the Bundle layer for coordinated work.

All Kits share one Panel foundation. Shared components and `packages/panel/src/visual-components.css` own sidebar navigation and trees, content frames, font sizes, spacing, controls, and reading/editing operations. Bundles declare business objects, relationships, fields, order, and needed views. Do not attach base CSS, adjust font sizes, or copy controls to fix a local layout. If existing components cannot express a reusable interaction, treat it as a shared component gap; see the [Panel UIUX standard](../panel-uiux-standard.md).

Every independently editable field must have a concrete purpose: who supplies or confirms it, which judgment it affects, and how it is used later. Consolidate ordinary pending matters, assumptions, design rationale, and source explanations into the object's optional remarks. Preserve rules, constraints, and specialized evidence artifacts with independent business meaning. Panel self-review should check whether the representation helps people understand and think, whether operations are familiar and convenient, whether organization supports rewriting and expression, and whether the effect of changes is visible. By default, do not turn storage sections into multiple internal tabs. See [field value](../panel-uiux-standard.md#独立填写字段的价值) and [Panel self-review](../panel-uiux-standard.md#面板自查).

When revising declarations, retain each existing operation: selection, addition, deletion, editing, ordering, attachments, references, saving, and reopening. Preserve canonical paths and stable IDs, without bulk-rewriting user data for a new layout. Put UI copy in Bundle locale resources; switching language does not translate or rewrite users' business text. Changes confined to `panel.yaml` or locale resources should take effect through content reload; only new shared runtime components need a corresponding build and release.

At delivery, check section/field data paths, schema and locale resources together; see the [Panel declaration guide](../../.agents/skills/design-bundle-creator/references/panel-authoring.md#绑定与内容更新的交付检查) for checks. Confirm that the actual Panel reads the saved content you intend to test. In the current source, library saves affect future projects. Existing projects use their own `design_kit`; when an update is requested, compare and revise those files while preserving customizations, then use existing validation and Git. A source-directory edit does not update an installed npm package, and ordinary local saves require no publication, remounting or adoption step.

Panel saving must pass through Schema, validation, controlled file writes, and a Git checkpoint. Do not write project files directly from the browser.

## Execution placement and Subagents

A Bundle's `execution.mode` determines whether it runs in the main conversation (`main`) or uses an independent Producer (`subagent`); the Panel type does not determine this. Methods must let the chosen executor complete work serially; `main` does not need an invented Producer. Optional Worker fan-out reduces latency for independent work items, but cannot be required for correctness or transfer responsibility for publishing canonical data. See the [Bundle execution contract](../bundle-contract.md#execution-placement) for execution placement and publication responsibility.

## Local verification

### Examples and validation

Every new or updated Bundle should have a nonempty synthetic example showing its main purpose, maintained alongside changes to methods, fields, and interactions. Examples let authors and recipients judge readability and interaction. A schema permitting empty collections does not mean an empty interface is sufficient for acceptance.

| Content | Minimum example coverage |
| --- | --- |
| Records, relationships, or data tables | Distinguishable records, real field types, and meaningful relationships; a few values sufficient for understanding |
| Formulas or mathematical models | Readable formulas, business explanations, and symbol meanings, distinguishing assumptions, definitions, and conclusions requiring verification |
| Charts, reports, or file previews | Actual readable, bounded example files with matching references, allowing inspection of content and regional layout |
| Bundles without interactive Panels | Readable inputs, expected outputs, and a validation method, without faking a Panel to satisfy a screenshot requirement |

Current installed Studio Panel preview targets existing declarative Panels. It prefers `reference/preview.json` and can also use declared initial values or explicit example input supported by that version. Native Panels do not provide this YAML preview; verify examples through a UI their Provider supports or an independent project. Examples referencing HTML, graphics, or reports must include bounded resources rather than an empty path alone. Mark examples clearly as synthetic: simulated solve data does not prove a solver ran, and preview interactions do not write user designs.

Examples should cover the main states affected by the change, such as populated/missing values, editable/read-only states, and switching between a chart and its explanation. Also provide invalid input triggering relevant constraints. Select representative states by risk rather than requiring every component combination on every change. Record loading, validation, actual rendering, save/reopen, and Agent use separately.

### Validate an independent content package

There is currently no generic `kit validate` command accepting arbitrary package roots and example JSON. Repository smoke scripts check the specific official Kits they name. Companion's `validate --project ... --skill ...` checks canonical files in an existing project and cannot directly serve as a content-package validator.

You can reuse Core's exported `resolveDesignKitPackage`, `loadDesignKit`, and `validateSkillDesign`. The following is an API-call example, not a new product CLI. Run it from the root of a development checkout with matching Core build artifacts. Pass, in order, the complete package root, the Bundle's **runtime `name`**, and the absolute path to a nonempty synthetic JSON example. Do not pass the directory identity (`identity`):

```bash
node --input-type=module - /absolute/my-content-package supply_needs /absolute/example.json <<'JS'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveDesignKitPackage, loadDesignKit, validateSkillDesign } from './packages/core/lib/index.js'

const [packagePath, runtimeName, examplePath] = process.argv.slice(2)
if (!packagePath || !runtimeName || !examplePath) throw Error('Provide package, runtime name and example paths')
const packageRoot = resolve(packagePath)
const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}
const location = await resolveDesignKitPackage(fs, packageRoot)
if (!location) throw Error('Missing package.json.designSystem.kit entry')
const kit = await loadDesignKit(fs, location, { sourceId: packageRoot })
const skill = kit.skills.find(item => item.name === runtimeName)
if (!skill) throw Error('Runtime Bundle name is not mounted in this Kit')
const state = JSON.parse(await readFile(resolve(examplePath), 'utf8'))
const issues = await validateSkillDesign(skill, state, { scopes: ['state', 'completion'] })
console.log(JSON.stringify({ kit: kit.name, version: kit.version,
  bundle: skill.catalogName ?? skill.name, runtimeName: skill.name,
  valid: issues.length === 0, issues }, null, 2))
if (issues.length) process.exitCode = 1
JS
```

This example only reads content and example data. It does not create a Design Project, run Bundle scripts, or request a model. Loading checks exact mounts, declarations, schema, Panel bindings, and locale resources; example checks use existing data and completion rules. Run Chinese and English examples separately and provide invalid examples that trigger actual constraints. Bundles with file artifacts also need a real, bounded `artifactText` reader, or the existing project validation entry point in an isolated project. JSON examples alone do not prove files exist, scripts execute, or domain computations are correct. For an installed version, separately check its actual Core export entry point; a source build is not acceptance of the installed npm package.

### Repository regression and real use

First validate nonempty examples with the target version's Kit loader, schema, and Panel DSL, checking exact mounts, method resources, locale resources, and field bindings. Then edit, save, and reopen in the Panel, confirming that unrelated fields were not overwritten. Check pure declaration or locale-resource changes through content reload without recompiling the entire product.

Add relevant negative cases according to the change, such as missing required definitions or resources, invalid declarative Panels, and invalid summaries. Omitting an optional summary should still allow loading. Bundles with artifacts also require actual-file checks; new methods need real use in the target Host. Record loading, structural validation, Panel interaction, and Agent use separately so recipients can understand the applicable scope.

If shared component or Provider code also changes, add the owning package's typecheck, build, and necessary browser interactions. Follow the [development guide](development.md#从最小相关检查开始) to choose checks from current checkout root scripts or owning-package scripts and prepare matching build artifacts first. Internal repository shortcuts apply only to their corresponding source environment; ordinary content authors can use the public APIs above and the target Host.

The official Web App Kit illustrates separating content from Providers:

- [`packages/skills-web-app`](../../packages/skills-web-app/)
- [`packages/provider-web-app`](../../packages/provider-web-app/)

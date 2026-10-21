# Page output contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

Shared by authoring and reconstruction; this defines representation, not which Pages or design to invent. The installed schema/validation remain authoritative.

## Installed resource addressing

This contract and the validator are installed Bundle resources, not project
WorkingCopy files. DSH binds `read_skill_resource` to this Bundle: read
`reference/artifact-contract.md` without a `page_design/` prefix. It binds
`run_skill_script` below the installed `scripts/` directory: use
`path:"page-design.mjs"`, not `scripts/page-design.mjs`. The script's
`input_file` and `input_files` are Design-Files-relative project artifacts.
An empty project `list`/`glob` for scripts or references does not mean the
validator is unavailable. Invoke the actual tool; a failure is a diagnostic,
not permission to invent bindings or omit required file validation.

## Files and shared inputs

Canonical state is `page_design/page_design.json`. Preserve stable Page/connection IDs, full orders, valid upstream references and user-authored canvas positions/sections. The panel renders the map directly from JSON.

`common_spec.source: "design_style"` means the actual saved Style result. Read its JSON and landed tokens before artifact work. The spec contains shared layout description, Logo, ordered navigation with existing Page targets and semantic icon references, and component/pattern decisions; not HTML or a second stylesheet. `logo.mark_ref` resolves to Style's SVG `brand.mark_id`; for raster Logo omit it and use `brand.logo_image.path`. Each navigation `icon_ref` resolves to `config.icons`. `uses_shared_layout: false` preserves a surface with its own layout; menu membership, page hierarchy and shell membership are distinct. Match actual source surfaces during reconstruction, not an invented universal shell.

Connections store `id`, `source_page_id`, `target_page_id`, `label` (not `trigger`). Each `function_ref` and `evidence_ref` must resolve to the same semantic capability, not just an existing ID.

A connection may carry `preview_context`, a flat string map of selection
metadata, for example `{"selection":"garden"}`. It is not a copy of the
selected entity's facts, a URL, a routing expression or persisted form state.
Use at most 16 keys, ASCII identifier keys matching
`[A-Za-z][A-Za-z0-9_-]{0,63}`, string values of at most 256 UTF-16 code units,
and at most 4096 UTF-8 bytes for the sorted-key JSON object. Reject
`__proto__`, `constructor` and `prototype`; nested objects, arrays and other
value types are invalid. Omission preserves existing context-free navigation.
Different source hotspots may use separate stable connections to the same
target Page, with distinct selection values; do not add a Page per sample.

On a runtime supporting this contract, the Host resolves context from the
current canonical connection and injects a single reserved
`<script type="application/json" id="dsh-design-preview-context">` into the
target preview. Never author that element or send context in frame messages.
Target artifact code may read the block's `textContent` and `JSON.parse` it to
select already-present synthetic/accepted content. Use DOM text operations,
not `innerHTML`, URL routing, storage, network requests or executable string
interpolation. Without a block (including manual Page selection), show an
honest default or a request to select an item, never an unrelated item's
details. Unknown selections must show a clear unavailable state. Returning,
manual selection or a source revision/reader change clears inbound context.
This is preview selection, not application persistence or a business-data
model. Older installed runtimes without this capability remain a disclosed
limitation; source declarations alone do not upgrade them.

File validation checks context shape/budgets and reserved-element ownership;
it does not prove that the target JavaScript uses the selection correctly.
Actually click each materially distinct source choice, inspect the target's
identity and return path, then repeat the affected route after a revision.

Bind each artifact through `design_delegate` or serial `design_focus_artifact`: kind `page_html`, ID = stable Page ID, file = exact Page path. Supply current Page descriptor, common_spec, incoming/outgoing connections, focused evidence, token map and Style asset authority to a Worker.

For forward-design synthesis and the bounded Worker brief, use
[task-to-page-method.md](task-to-page-method.md). Keep evidence locators and
material conditions with excerpts; exact assets and validator inputs remain
file-backed. Do not require every Worker to reread complete upstream files.

## Map file check

Before delegating or serially generating HTML, run `page-design.mjs` with
`args: ["validate-map-file"]`, `input_file: "page_design/page_design.json"`
and `input_files: ["design_style/design_style.json"]`. The script reads the
exact saved `config` including SVG bytes; never copy or summarize Style into
`input_context`. This checks map references without
HTML generation. If an icon or brand reference is missing, fix a wrong Page
reference using a semantically correct existing asset, or report the precise
Style gap to the main Agent. Do not invent SVG authority or send every Worker
into the same missing-asset failure. Rerun after shared references change.


## HTML and preview bindings

Each Page is a complete standalone HTML document at `page_design/pages/<page-id>.html`; no HTML in JSON, nested page shell, fragments or generated page-map SVG. Use local assets. The panel supplies the landed `design_style/tokens.css`; consume its existing `--ds-*` names, never declare a competing namespace or reference unknown tokens. Original raster brand/images use plain `img src` paths relative to the HTML (PNG/JPEG/WebP); SVG icons use the exact Style authority. Unsupported assets/presentation remain a reported limitation.

- Cross-page controls use `data-prototype-page="<target-page-id>"`.
- Meaningful interactive elements have unique `data-prototype-id` and readable `data-prototype-label`.
- Mark every outgoing connection exactly once with `data-prototype-connection="<connection-id>"`; do not mark incoming connections.
- The validator returns `bindings` for canonical `source_element_id` and `source_element_label`; do not invent bindings before HTML exists.
- No remote dependency, navigation URL or cross-page routing script. Optional `data-design-icon` / `data-design-brand` markers resolve to current Style IDs; they are not fidelity tests.

## Validate and integrate each file

For every serial or delegated Page artifact, call `run_skill_script` with
`path: "page-design.mjs"`, `args: ["validate-html-file"]`, `input_file`
equal to its exact pre-bound HTML path, `input_context: {"page_id":"<page-id>"}`,
and `input_files` containing exactly these authoritative paths:

```json
["page_design/page_design.json", "design_style/design_style.json", "design_style/tokens.css"]
```

The Host reads those files directly; the script derives state, assets and token
names from their bytes. Do not send copied `state`, `style_authority`, SVG or
`authoritative_tokens` objects. File mode never falls back to those objects when
a required file is missing. Workers use this same call: script inputs are
read-only; their only writable file remains their assigned HTML artifact.
The Host passes the file bytes directly to the script; never read and resend
the complete HTML through model tool arguments. Repair the same file on a
non-zero result. On success, use the returned `bindings` and update the
matching canonical state. Validate every new or changed Page this way,
persist each successful Page immediately in the current files without an
intermediate Git publication, then run `design_validate` and close through
`design_publish({action:"complete"})` once. Do not assemble every Page HTML
into a publication payload.

The checks establish mechanical integrity, not source fidelity. If shared source-based Style is missing or wrong, report that exact owning-Bundle issue to the main Agent; do not change Style files or invent a Page-private replacement.

## Native CLI equivalent (Codex, Claude Code, Qoder)

When the host uses native shell instead of `run_skill_script`, use the same
installed script, not a recreated validator. ROOT is the exact Design Files
directory returned by the host; SCRIPT is this Bundle's installed script path.

```sh
node "$SCRIPT" validate-map-file --design-files "$ROOT" --input-file page_design/page_design.json
node "$SCRIPT" validate-html-file --design-files "$ROOT" --input-file page_design/pages/home.html --page-id home
```

Replace the example `home` with the assigned stable Page ID and artifact path.
The CLI reads the same fixed authority files, rejects escaping paths/symlinks,
and writes nothing. Both modes return diagnostics and compact bindings on stdout.
The old stdin context envelope remains supported for already-loaded callers;
new work uses file-backed inputs. No inline fallback occurs in file mode.

## Failure and recovery

- Exit 2 / `kind: input_error`: fix the call or missing/malformed input file.
  Do not interpret missing transport context as a missing design decision.
- Exit 1 / `valid: false`: the supplied files fail mechanical validation.
  Repair the named Page defect; a true missing Style asset goes to its owner.
- Exit 0: mechanical validation passed, not proof of visual/interaction quality.

At resume, inspect accepted refs and existing files at planned stable paths.
Validate existing HTML against current file inputs before regenerating it. If
it passes, restore/integrate its artifact ref and returned bindings through the
executor's canonical JSON tools; the script never writes JSON. An existing file
alone is not acceptance. Preserve valid siblings, repair only failed pages, and
recheck affected artifacts if the shared map or Style changes before publication.
Do not race map/Style edits with a Worker frontier. Repeated identical diagnostics
without progress must be reported, not retried indefinitely or bypassed by
deleting required connections. Cancellation is not permission to start fallback
work; resume only on a later authorized request. Report unfinished pages honestly.

## Independent-page frontier

For two or more independent pages and an available `design_delegate_frontier`,
submit `{batch_id, items}` once. Each item must include `artifact_kind: "page_html"`,
`artifact_id`, exact `artifact_file`, and a complete bounded `prompt` pointing to
this contract and the required file-input paths. A batch ID is an idempotency key,
not a stored task list: never call the tool with only `batch_id`. Reuse it only
with the identical ordered items. Use `design_delegate` for one page or when the
frontier tool is unavailable; native hosts use their documented subagent adapter.
Integrate every successful receipt, then address failed/not-started pages within
the remaining budget. Neither a receipt nor a normal Worker exit substitutes for
the Producer's file validation and canonical integration.

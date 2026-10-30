# Kit and independent Bundle content archives

## Studio source import and export

The Studio imports source files into editable S2 working copies through
`StudioInstances.importSources({kind, files:[{path, base64}], title?})`. A Bundle
ZIP, folder or bare `SKILL.md` needs its method file; a Kit needs `mindset.md`
and `kit.yaml`. Other missing or invalid definition files remain visible through
`readiness` diagnostics and can be completed in the existing editor. Each import
creates an independent identity and an automatically disambiguated display title;
it does not overwrite an installed definition or adopt an immutable catalog pin.
The original source bytes are retained. Saved-source exports include the current bilingual display title as optional archive metadata, independent of catalog identity. Reimport retains that title and uses the existing numeric suffix for collisions; it does not replace it with a runtime name or technical identifier.

The current Studio UI reads source ZIPs and files through that S2 entry. For
self-exported ZIPs or legacy JSON envelopes, `readStudioContentArchive` parses
the envelope and checks its file integrity without creating a stored import.
Definition diagnostics do not block source import. The UI forwards `archive.files` and its optional bilingual `title` to `importSources` and does not
create an additional adoption or publication step.

`exportStudioSourceArchive(snapshot, request)` captures the saved source tree
without requiring a complete, loadable definition. The instance export uses it
for a direct source ZIP, including unfinished working copies and retained Kit
Bundle files. Original files and byte hashes use the existing archive transport.
Source, provenance and license metadata are optional, including individual
fields. Provided values and LICENSE/NOTICE files are preserved; import and export
do not require or check a license declaration. Choosing AI completion opens the
existing editor and prefills its Host conversation; the user sends the request
and reviews changes through the normal prepare/diff/save path.

## Archive transport and optional definition validation

The public Studio library exports `readStudioContentArchive`,
`exportStudioSourceArchive` and `exportStudioContentArchive`. Hosts provide the
same stateless decoder and current-source export behind their ordinary Studio
adapters. There is no stored-import, adoption, local-version publication or
confirmation service.

`exportStudioContentArchive(snapshot, request)` reads a host-resolved immutable regular-file snapshot. `snapshot.fs` supplies the existing Core loader view, `listFiles()` lists the complete relative tree, and `readBytes(absolutePath)` preserves exact bytes. The host must reject symlinks, special files and filesystem escapes before supplying this port; it must not provide a mutable installed directory with inconsistent text and byte views.

A standalone Bundle snapshot explicitly supplies `snapshot.bundle` with its exact
own pin. The independent Core loader validates that source without inventing a
Kit. This is an explicit source kind, never a fallback after failed Kit loading.
Installed-content export opens its current catalog identity through the existing
instance service, then exports that saved source. It does not create a separate
copy or local version. Requests cannot supply arbitrary host directories.
The Node instance service supplies such immutable byte snapshots directly from
the exact saved S2 id/revision, including overlays and the retained mounted
closure for a Kit. No source extraction or new archive format is involved.

Archive validation uses Core's optional attached-resource projection to keep
explicit binary assets opaque (`bin`, PNG/JPEG/GIF/WebP/AVIF/ICO/BMP, PDF,
WOFF/WOFF2/TTF/OTF/EOT and WASM). These files remain in the complete directory
and byte snapshots and count toward resource budgets; they do not become
model-facing text. Required definition slots and explicitly referenced text
still use strict UTF-8 reads, as do unknown resource types, Markdown and scripts.
An invalid text encoding is never accepted as replacement-character text or
silently reclassified as an asset. Existing loader adapters without the optional
resource port retain their previous behavior. Opaque transport does not validate
an asset's media format or grant execution authority.

The JSON envelope is `studio-content-archive/v1`. It holds kind (`kit` or `bundle`), exact current-loader name/version, optional bilingual display title and declared source/license text, exact Bundle dependencies, sorted regular files (`path`, canonical base64, bytes, SHA-256), and a canonical-envelope SHA-256. It is a transport wrapper, not a replacement Kit/Bundle directory format. Independent Kit files retain `mindset.md`, `kit.yaml`, optional resources and licensing notices byte-for-byte. The host supplies `snapshot.bundles` with exact name/version, source identity and immutable byte snapshots; exports include only the mounted Bundle closure under `bundles/<name>/<version>/`. That prefix is transport placement, not an installed layout or authority. Kit-owned files colliding with this reserved transport directory are rejected rather than dropped. Legacy v1 Kit envelopes containing `skills/<name>/` remain readable. An independent Bundle contains only files relative to its own root; its containing Kit is not invented as a dependency.

Kit dependency pins are derived in original catalog order from the existing Core loader. Bundle dependency pins are explicit caller declarations, not a new dependency inference mechanism. Core's independent Bundle loader validates dependency-free Bundle content without a Kit. Explicitly declared dependencies require a host-resolved immutable Kit context and exact matching pins; missing context produces an unvalidated diagnostic. When the context already mounts the imported pin, the complete imported Bundle tree replaces that Bundle's context subtree for validation, without retaining deleted files or writing to the context. Catalog identity (`identity` in the Bundle manifest) and the runtime binding name are kept distinct; both archive identity and Core authority retain the existing lowercase snake-case name boundary. Missing or wrong-version declared requirements and mismatched content identities fail validation. This slice does not claim to discover undeclared semantic requirements.

`readStudioContentArchive(json)` checks bounded shape and integrity, rejecting unknown fields, traversal, absolute paths, Windows ADS/device/unsafe names, case collisions, file/directory collisions, links, modes and malformed/noncanonical base64. Limits are 4096 files, 16 MiB decoded content and 32 MiB JSON. The transport uses the current loader's local directory identities, not a newly invented namespace syntax.

The validated export uses the Core loader internally to check the supplied
complete definition and dependency context. Its diagnostics are not an import
or ordinary-save prerequisite. That internal helper is not a separate public
import workflow, and its former adoption receipts are not exposed by Hosts.

The archive preserves ordinary scripts as content. It carries no file permissions,
executable modes, link targets or installation paths. Known native payload
extensions (exe/dll/node/so/dylib/com/msi/sys) report unsupported; copying a provider
id does not register a trusted provider. Source and license declarations remain
optional provenance, not import qualifications; supplied LICENSE/NOTICE files are
preserved.

A successful import creates one editable catalog identity. The user can save it
in place or explicitly copy it. Kits mount current Bundle identities. Existing
projects continue using their own `design_kit` files; see
[project content maintenance](../../../docs/project-content-upgrade.md).

Focused source-plane test with explicit Core source resolution:
`pnpm --filter dsh-design-studio test:content-archive`. Typecheck:
`pnpm --filter dsh-design-studio typecheck`. No installed-package, durable
working-copy, GUI or host-execution outcome is claimed by this primitive.

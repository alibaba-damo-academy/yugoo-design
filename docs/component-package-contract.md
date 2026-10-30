# Trusted component packages

语构设计系统（Yugoo Design） accepts executable presentation contributions only
from explicitly trusted Provider code. This contract describes the first bounded
package format for that existing entry: **native Panel API 1, using Host React
18**. Bundle content still cannot install code, claim Provider trust or introduce
a DSL component kind. The [DSL catalog](dsl-spec.md#component-trusted-extensible-library)
and [trust rules](system-design-baseline.md#trust-and-extension-rules) retain their
existing owners.

Use this contract to prepare and check a Provider's exact file set, inspect its
dependencies and register its native presentations. The runnable
[minimal package](../packages/core/test/fixtures/component-package/minimal/)
contains real server/client JavaScript entries, a package identity, a license and
an inventoried byte manifest. Its
[external pin](../packages/core/test/fixtures/component-package/minimal-pin.json)
is separate from the package being checked.

## Package declaration

The complete example is
[component-package.json](../packages/core/test/fixtures/component-package/minimal/component-package.json).
All declared objects reject missing or unknown fields. A package declares:

| Field | Meaning |
| --- | --- |
| `format` | Exactly `yugoo-component-package/v1`. |
| `name`, `version` | npm-style lowercase package name and an exact three-part version; no ranges or implicit latest. |
| `namespace` | Dotted Provider namespace. Each component has a versioned ID within it, such as `org.example.notice.panel/v1`. |
| `summary` | Human-readable package purpose; every component also has a summary. |
| `compatibility` | `nativePanelApi: 1`, `reactMajor: 18`, `reactSource: host`. Unsupported contribution types and interfaces fail explicitly. |
| `entry` | Inventoried compiled `server` and `client` `.js`/`.mjs` paths, matching `package.json` exports `.` and `./client`. |
| `license` | Declared SPDX identifier and a nonempty inventoried license file. The bytes and npm license declaration must agree; this check is not a legal compatibility review. |
| `files` | Every regular file except the manifest itself, with its actual SHA-256. No omitted, extra, duplicate, case-conflicting, escaping or file/directory-conflicting paths. |
| `dependencies` | Exact `{name, version, integrity}` pins for other component packages. All packages in the supplied closure must be reachable; missing, cyclic, conflicting and unused packages fail. |
| `components` | Native presentation IDs with `kind: native-panel` and a summary. `dsl-component` and executable runtime/validation/capability claims are unsupported in this format. |

`package.json` identity and license must match. Its runtime `dependencies` must
equal the exact component-package dependency pins. React and ReactDOM are Host
peers, never private runtime dependencies. This first format accepts exact or
caret full React 18 peer versions, for example `18.3.1` or `^18.2.0`, and checks
the actual Host versions against them. Other npm range expressions and
optional/bundled dependencies are rejected rather than guessed.
Supported private dependencies must themselves use this package format. This
checks the declared closed file set, not arbitrary JavaScript's import graph or
general npm dependency resolution.

Limits are 128 packages, 128 files per package, 128 KiB of manifest bytes, 8 MiB
per package and 32 MiB per complete closure. Paths are portable, relative and
bounded to 32 segments. The byte API receives a complete regular-file map; an
eventual filesystem installer must separately enforce confinement and regular-file
reads. This contract does not introduce that installer.

## Byte identity and admission

`validateComponentPackageClosure(sources, rootPin, host)` is a data-only Core API.
Each source contains the exact UTF-8 manifest bytes and a `Map` of file bytes.
The validator snapshots them, checks all file digests and returns dependency-first
immutable admission records only after the entire closure succeeds. No entry
path is imported or evaluated by this API.

Package integrity is SHA-256 of the UTF-8 bytes of this JSON representation:

```js
JSON.stringify({
  manifest: sha256(exactManifestBytes),
  files: sortedFilePaths.map(path => [path, sha256(actualFileBytes[path])]),
})
```

Paths sort by JavaScript string comparison, not locale collation. The root pin
must come from the trusted caller's expected artifact identity; a self-declared
hash does not establish trust. The fixture's
[byte reader and independent Node hash calculation](../packages/core/test/fixtures/component-package/fixture.mjs)
show the algorithm. They read the checked-in fixture, not arbitrary user paths.

Failures carry a stable `ComponentPackageError.code`, declaration `path` and
message. For example:

| Invalid declaration or bytes | Diagnostic |
| --- | --- |
| `version: ^1.0.0` | `package.value` at `$.version` |
| React source `bundled` or major 19 | `package.compatibility` at `$.compatibility` |
| Foreign component namespace | `package.namespace` at `$.components[0].id` |
| `kind: dsl-component` | `package.contribution_type` at `$.components[0].kind` |
| Changed client bytes | `package.digest` at the corresponding `$.files[i].sha256` |
| Missing/mismatched exact dependency | `package.dependency_pin` at its dependency path |
| Different Provider React object | `package.react_source` at `$runtime` |

[Invalid declaration instances](../packages/core/test/fixtures/component-package/invalid-declarations.json)
are explicit mutations of the real minimal manifest with expected codes and
paths. Focused tests execute them against the validator.

## Existing trusted registration entries

Server Provider code calls `registerComponentPackageContributions(registry,
checked, contributions)` after Core byte admission. It delegates every declared
native presentation to the existing `registerBundleContribution` entry with
the caller's existing Bundle authority. Global ID conflicts, authority checks
and live-reference disposal guards retain their original implementation. An
incomplete or unsupported claim set is refused, and a failed batch rolls back
only its own new registrations.

The browser's existing `NativePanelRegistry.registerPackage(sources, rootPin,
createDefinitions, runtime)` validates the bytes in that registry's own artifact
before calling the trusted definition factory. It checks API shape, exact IDs,
namespace/ID conflicts and Host/Provider React and ReactDOM object identity.
Validation records are not serialized as authority across server/browser or
separately bundled modules.

Definitions use the original registry and effect ownership. `get`, `ids` and
`installedDefinitions` discover them; the latter exposes immutable
`metadata.componentPackage` provenance. There is no second catalog or content
store. Existing providers that call `register(definition)` retain that behavior.
The data content store and Studio content archive remain Kit/Bundle content
adoption mechanisms; neither becomes a code installer.

The minimal package's client entry receives the actual Host React/ReactDOM
references and renders with the supplied React. Tests import its real entries,
register the server claim, render the browser definition, inspect discovery and
dispose it. Descriptor checks and matching runtime arguments do not prove that
arbitrary trusted JavaScript never embeds another React copy. Only the tested
minimal entry has that demonstrated boundary; general build provenance and
installed Host validation remain separate work.

## Focused verification

From the repository root using the declared Node/pnpm versions:

```sh
pnpm --filter dsh-design-core test:component-packages
pnpm --filter dsh-design-panel test:component-packages
```

These are source tests. They distinguish actual fixture byte/entry verification
from synthesized closure/negative cases and do not imply a durable installation.
Typechecks, built artifacts and installed-package checks must be reported
separately. Package acquisition/adoption, first-load orchestration, leases,
updates, removal and native Host delivery are later lifecycle work; this slice
does not add those authorities or alter Bundle execution.

After building Core and Panel, the isolated built probe also compiles the minimal
package entries, fingerprints the resulting bytes and exercises both built
registries plus Node React rendering:

```sh
COMPONENT_PACKAGE_TEST_OUT=/absolute/owned/evidence node packages/panel/test/component-package-built.mjs
```

It retains a small candidate and `built-result.json` in that directory. This is a
host-neutral Provider bootstrap example and Node rendering check; it does not
exercise a DSH/Companion plugin installation or a browser.

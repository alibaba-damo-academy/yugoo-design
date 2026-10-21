# Third-party licensing inventory

Original Yugoo-design code and documentation are licensed under Apache-2.0,
except where otherwise identified. Third-party material retains its original
license. This inventory is a preparation record, not a complete release SBOM
or a substitute for license texts, source provision, or other obligations.

## Known components requiring release checks

| Component | License / location | Release requirement to verify |
| --- | --- | --- |
| `yugoo-design-git-native` | Controlled local-Git Node-API package, derived from the retained upstream MIT source; its original licenses and exact build inputs are in that package's `LICENSE`, `NOTICE`, `SOURCE.json` and `third-party/` | Install the normal package dependency, including its maintainer-built platform prebuild. No Git executable or user compiler fallback is provided. This binding's declared and verified platform inventory is authoritative; the historical upstream binary is not its runtime or build provenance. |
| `isomorphic-git@1.44.2` | External pure JavaScript MIT dependency; original text and exact source/integrity locators in `third-party/git-js/` | The Node-only adapter uses the exported index codec on caller-supplied bytes; the existing owner retains filesystem locks, snapshots and publication. Install the normal dependency tree and retain its own transitive notices. This does not provide a header-only object reader or establish native binary provenance. |
| `iconv-lite@0.7.3` | External MIT dependency; original text and exact source/integrity locators in `third-party/git-js/` | Preserve the installed package and its dependency notices when distributing the Node-only commit-encoding decoder. Do not inline it into browser clients. |
| Historical `@napi-rs/simple-git@1.2.0` comparison materials | External Node-API dependency; wrapper MIT, retained original binding source and known libgit2/git2 license texts in `third-party/simple-git/` | Keep the native addon outside JavaScript/browser bundles and preserve these original materials. `SOURCE.json` identifies retained bytes and tested native packages. The published binary's exact Cargo/vendor build source and complete native license closure remain unresolved; wrapper MIT and an internal comparison do not establish public-distribution acceptance. |
| Official Ladybug WASM dependency `@ladybugdb/wasm-core@0.21.1` | Package declares MIT; original text and public source locator in `third-party/native/ladybug-wasm-core-0.21.1/` | Current `packages/knowledge-ladybug` dependency route. Preserve Kùzu Inc./Ladybug Memory Inc. notices and verify actual release inclusion. The installed package has no separate third-party inventory or precise build-provenance file; embedded components and source/build correspondence remain unresolved. Package MIT is not a blanket license for the complete WASM. |
| Historical vendored Ladybug WASM runtime | MIT; `vendor/ladybug/runtime/LICENSE` | Separate legacy route: preserve its own copyright/license, provenance and patch if distributed. Do not use its patch/source evidence as the build provenance of the official npm dependency. Compiled-in component checks remain separate. |
| DSH code and reused utilities | MIT; `deepseek-harness/LICENSE` | Retain original notices; distinguish external host from copied/bundled utilities. |
| Pinned DSH JSON value utility (Core) | MIT; repository `packages/core/third-party/dsh-json/LICENSE`, Core package `third-party/dsh-json/LICENSE` | Preserve the original license and provenance README with the Core tarball; verify actual packed files. |
| Pinned DSH subprocess worker utilities (Core) | MIT, Copyright (c) 2026 DeepSeek; the complete identical upstream license text is packaged at `third-party/dsh-json/LICENSE` | The private `dsh-git-worker.js` build inlines `@deepseek-ai/dsh-subprocess@0.2.0-rc.2` (`src/control.ts`, public `./control`) and `@deepseek-ai/dsh-subprocess-local@0.2.0-rc.2` (`src/output.ts`, public `./output`). Original source: `https://github.com/deepseek-ai/deepseek-harness`, package paths `packages/subprocess/subprocess` and `packages/subprocess/subprocess-local`. Retain that license in the Core tarball; verify the physical worker contains these utilities only, with no native Koffi/node-pty or Host service implementation. Source tests do not establish the built/packed closure. |
| ELK / elkjs | EPL-2.0 | Include license and corresponding source availability information; verify actual bundled version and modifications. |
| sharp | Apache-2.0 | Preserve applicable license and upstream notices. |
| Prebuilt sharp/libvips dependency bundle | Local `@img/sharp-libvips-*` package declares LGPL-3.0-or-later; contains multiple licenses | Inventory all bundled libraries per platform; provide required corresponding source/build materials and verify replacement/relinking conditions. libvips upstream alone is LGPL-2.1-or-later; do not confuse that with the distributed bundle's terms. |
| bpmn-js | bpmn.io License | Include original license/copyright; keep the required watermark visible and unchanged. |
| Design-style reference material and icon assets | Apache-2.0, MIT, ISC | Preserve the detailed notices in `packages/skills-web-app/skills/design_style/THIRD_PARTY_NOTICES.md`; verify required full license texts are distributed. |

## Scope exclusions

- `deepseek-harness/` and `vendor/ladybug/` are not relicensed by the root LICENSE.
- External packages keep their own licenses even when bundled into an output.
- Separately licensed Kit content and assets keep their explicit licenses.
- Downloaded model weights require their own version-specific license review;
  the inference engine's license does not license the weights.

## Release work still pending

Generate a versioned inventory from actual tarballs and CLI plugin outputs,
include every required license/NOTICE, arrange corresponding source access for
applicable components, and verify Linux/Windows/macOS packaging separately.
See TODO.md. Do not label a release compliant based only on this inventory.

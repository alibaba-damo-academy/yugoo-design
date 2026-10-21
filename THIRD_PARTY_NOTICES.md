# Third-party licensing inventory

Original Yugoo-design code and documentation are licensed under Apache-2.0,
except where otherwise identified. Third-party material retains its original
license. This inventory is a preparation record, not a complete release SBOM
or a substitute for license texts, source provision, or other obligations.

## Known components requiring release checks

| Component | License / location | Release requirement to verify |
| --- | --- | --- |
| Official Ladybug WASM dependency `@ladybugdb/wasm-core@0.21.1` | Package declares MIT; original text and public source locator in `third-party/native/ladybug-wasm-core-0.21.1/` | Current `packages/knowledge-ladybug` dependency route. Preserve Kùzu Inc./Ladybug Memory Inc. notices and verify actual release inclusion. The installed package has no separate third-party inventory or precise build-provenance file; embedded components and source/build correspondence remain unresolved. Package MIT is not a blanket license for the complete WASM. |
| Historical vendored Ladybug WASM runtime | MIT; `vendor/ladybug/runtime/LICENSE` | Separate legacy route: preserve its own copyright/license, provenance and patch if distributed. Do not use its patch/source evidence as the build provenance of the official npm dependency. Compiled-in component checks remain separate. |
| DSH code and reused utilities | MIT; `deepseek-harness/LICENSE` | Retain original notices; distinguish external host from copied/bundled utilities. |
| Pinned DSH JSON value utility (Core) | MIT; repository `packages/core/third-party/dsh-json/LICENSE`, Core package `third-party/dsh-json/LICENSE` | Preserve the original license and provenance README with the Core tarball; verify actual packed files. |
| ELK / elkjs | EPL-2.0 | Include license and corresponding source availability information; verify actual bundled version and modifications. |
| sharp | Apache-2.0 | Preserve applicable license and upstream notices. |
| Prebuilt sharp/libvips dependency bundle | Local `@img/sharp-libvips-*` package declares LGPL-3.0-or-later; contains multiple licenses | Inventory all bundled libraries per platform; provide required corresponding source/build materials and verify replacement/relinking conditions. libvips upstream alone is LGPL-2.1-or-later; do not confuse that with the distributed bundle's terms. |
| bpmn-js | bpmn.io License | Include original license/copyright; keep the required watermark visible and unchanged. |
| Design-style reference material and icon assets | Apache-2.0, MIT, ISC | Preserve the detailed notices in `packages/skills-web-app/skills/design_style/THIRD_PARTY_NOTICES.md`; verify required full license texts are distributed. |

## Scope exclusions

The rendered Companion client includes victory-vendor 37.3.6, whose package
declares MIT AND ISC and author Formidable. Its attribution, original README and
thirteen original lib-vendor LICENSE texts are retained in
`licenses/bundled-js/victory-vendor@37.3.6/` in the Companion package.
Each vendor retains its own terms; the package expression does not replace those
texts or claim that every attached vendor is rendered.

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

# Upstream Node CPU embedding materials

Formal npm releases carry the existing Transformers.js Node entry, ONNX Runtime
CPU prebuilds and sharp JavaScript as intentionally assembled npm bundles. The
shared assembler is `scripts/prebuilt-embedding-runtime.mjs`. It fetches exact
official npm archives, verifies their pinned SHA-512 integrity and records every
retained file's bytes and SHA-256 in the packaged `licenses/prebuilt-embedding/SOURCE.json`.
It does not copy a developer's installed dependency tree or execute build scripts.
The normal product preparation passes its existing npm CLI. Direct stable use of
the same-source builder supplies that locator through `--npm-cli`; verified
archive inputs can be reused by the JavaScript assembly API without fetching again.

The supported CPU prebuilds are Linux x64 GNU, Windows x64 and macOS arm64.
Platform-specific sharp binaries remain ordinary optional npm dependencies.
The Node entry uses the same upstream runtime and model policy; the unused
browser ONNX runtime and protobuf dependency path are not distributed in this
Node bundle. Full upstream package metadata and scripts are retained unchanged.
The enclosing npm bundle owns installation, so pnpm need not execute those nested
dependency lifecycle scripts. Model preparation remains a separate operation.

Transformers.js and sharp retain their npm-provided licenses. ONNX Runtime's npm
archive omits the top-level license and third-party notice files; these exact
upstream v1.21.0 files supplement it:

- [LICENSE](https://github.com/microsoft/onnxruntime/blob/v1.21.0/LICENSE), SHA-256 `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`.
- [ThirdPartyNotices.txt](https://github.com/microsoft/onnxruntime/blob/v1.21.0/ThirdPartyNotices.txt), SHA-256 `8c06e8cff286a4a117b3b246a4c7da68428a144af757823db50e3d6520941ec6`.

These materials preserve attribution and provenance. They do not establish
platform execution or complete release license acceptance; those remain separate
checks against the actual staged release and native platform.

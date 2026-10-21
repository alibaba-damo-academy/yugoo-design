# Official Ladybug WASM package license material

`LICENSE` preserves the unmodified MIT license from the actual installed
official npm package `@ladybugdb/wasm-core@0.21.1`, including the Kùzu Inc.
and Ladybug Memory Inc. copyright notices. `SOURCE.json` records its public
package/archive URLs, the archive integrity recorded by the installed npm
lock, and the copied license's SHA-256. The old temporary evaluation archive
is unavailable; this material uses the current installed package bytes and
does not claim a new archive-integrity check.

This is the official dependency route selected by
`packages/knowledge-ladybug/package.json`. It is separate from the historical
vendored runtime under `vendor/ladybug/`; that runtime's local patch and
provenance do not establish the build source of this official package.

The installed official package supplies this LICENSE but no separate NOTICE,
third-party inventory or precise build-provenance file was observed. Its
package-level MIT declaration must not be treated as the license for every
component embedded in the WASM. `BUILD-SOURCE.json` now records the public
registry provenance declaration's fixed source and workflow pins, but does
not claim cryptographic verification or independent reproduction of the binary.
`source-materials/INDEX.json` indexes fourteen original fixed-source licenses;
`source-materials/header-notices/INDEX.json` preserves six original headers,
generated-source markers and extension license materials. Generated markers
are not grammar licenses. `source-materials/fulltext-supplement/SOURCES.json`
links the pinned cpp-httplib and CRoaring release license texts and preserves
the limits of their correspondence to modified vendored sources. Both CRoaring
license alternatives remain intact; no alternative is selected here.

Three precise upstream inputs remain missing: the original Cypher grammar's
copyright/license lineage, the original WASM job's exact Emscripten/LLVM
versions and runtime notices, and a recorded compiled-in component inventory
for this npm binary. Source CMake targets are not an exhaustive binary inventory;
a successful workflow step or today's emsdk version does not supply the original
toolchain identity. Complete licensing and source/build correspondence therefore
remain unresolved. The
existing Rust dependency-lock/source gap belongs to the separate
sharp-libvips/librsvg source-delivery work, not this Ladybug dependency.
This material does not resolve that separate gap or generate a replacement lock.

This directory prepares a distributable license and public source locator.
Actual inclusion in release packages and complete licensing/source-delivery
acceptance remain separate requirements.

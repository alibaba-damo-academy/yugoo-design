# Historical native Git comparison materials

This folder retains the unchanged upstream source and provenance of the earlier
experimental `@napi-rs/simple-git@1.2.0` comparison. It is no longer Core's runtime
dependency. The controlled runtime package is
[`yugoo-design-git-native`](../../../git-native/package.json); its current
[source, build and artifact receipt](../../../git-native/SOURCE.json) identifies
the local changes, Cargo lock and maintainer-built prebuilds.

The earlier candidate declared `@napi-rs/simple-git@1.2.0`.
Its published Node-API loader selects an exact `1.2.0` platform package.
The platform `.node` file stays in the installed dependency tree; it is not
inlined into Core's JavaScript, copied into the browser client, or compiled
on the user's computer. Enabling the experimental backend and its remaining
CLI operations belong to Core's Git implementation, not this material folder.

`LICENSE` is the unchanged MIT text from the independently integrity-verified
root npm package. It does not relicense libgit2 or other embedded native code.

## Retained source and license materials

`SOURCE.json` records public origins, exact archive integrity and native file
hashes for the Windows x64 and Linux x64 GNU packages used in the isolated
comparison. It also records every retained source and license file's SHA-256.
These pins identify bytes; they do not establish complete build correspondence.

`binding-source/` contains unchanged Rust sources, `Cargo.toml` and `build.rs`
from the root package's npm `gitHead`:

- Repository: <https://github.com/Brooooooklyn/simple-git>.
- Commit: `0cdb713269151a7af05718c745a718f0f2bd37f9`.
- Original MIT license: the adjacent `LICENSE`.

This is preserved dependency source, not a second implementation or a runtime
build step. The upstream source archive is public at the URL in `SOURCE.json`.

The original `libgit2-v1.9.2-COPYING` retains GPLv2, its linking exception and
the third-party texts in that reference release. The original git2 0.21.0
MIT and Apache-2.0 alternatives are retained separately. Their explicit
reference versions must not be presented as verified versions of every
component embedded in the published native binary.

## Historical upstream-binary distribution boundary

The upstream binding source has no `Cargo.lock`; `git2` and `libgit2-sys`
constraints do not pin a complete native build. The exact published native
binary's Rust/libgit2/OpenSSL and other vendored component closure, corresponding
source and all applicable notices remain unresolved. Retaining the available
source and known original license texts is not complete licensing acceptance.
An exact npm version or the wrapper's MIT declaration cannot close that gap.

This material supports an internal opt-in comparison candidate. It is not a
public-release approval, a statement that all platforms have been tested, or
a claim that the product no longer needs the Git CLI. No user compiler,
source checkout or manual binary modification is required for the candidate.

# macOS arm64 maintainer build

This source adds the `aarch64-apple-darwin` target. Intel Mac and other targets
remain outside this build's support. User installation loads a prepared addon;
it never installs Rust, compiles code or falls back to the Git executable.

Use the Rust 1.99.1 cargo, rustc and rust-std archives recorded in `SOURCE.json`.
Verify their SHA-256 against the pinned official manifest before extracting.
Install into a development-only prefix, with separate `CARGO_HOME` and
`CARGO_TARGET_DIR`. Set `CARGO` and `RUSTC` to that prefix's executables.
The recorded build used Apple clang 21.0.0 and SDK 26.5. Set
`DYLD_FALLBACK_LIBRARY_PATH` to the isolated Rust prefix's `lib` directory so
the archive's rust-objcopy resolves its bundled LLVM library. This setting is
for the build process; it is not a user profile or installed-host setting.

From the repository root:

```sh
node packages/git-native/scripts/build.cjs aarch64-apple-darwin
node packages/git-native/scripts/check-artifacts.cjs --target aarch64-apple-darwin
node --test packages/git-native/test/header.test.mjs
```

The addon has a relocatable `@rpath/yugoo_git.darwin-arm64.node` install name.
Only system dylibs/frameworks remain external. Preserve `Cargo.lock`, the
existing Linux/Windows artifact pins and third-party licenses. After a source
change, update the `SOURCE.json` input hashes and record the actual new artifact
hash, size and toolchain. Do not commit generated binaries into public source.

`--target` is an explicit local artifact check. The ordinary no-argument check
and `prepack` still require the complete declared inventory, with all hashes
and all source inputs verified. A Mac-only checkout does not pass that release
gate by checking its own addon.

The first Mac run passed all three header tests, including packed objects and
bounded header access with Git absent from PATH. Full Core project creation,
save and reopen have a separate gate: Core must canonicalize both staging and
source-parent paths for macOS `/var` → `/private/var` aliases. Desktop message
delivery and installed-package acceptance are also separate from this addon.

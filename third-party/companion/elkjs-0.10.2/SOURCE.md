# ELK source availability and local transformation

The distributed ELK/elkjs portions remain under EPL-2.0. Source for the
JavaScript wrapper/build configuration of elkjs 0.10.2 is available at:
https://github.com/kieler/elkjs/tree/f64a4813dcab63c30fe67a32470cd1c05f4f7031
An archive can be obtained from:
https://codeload.github.com/kieler/elkjs/tar.gz/f64a4813dcab63c30fe67a32470cd1c05f4f7031
The npm 0.10.2 registry gitHead and official 0.10.2 tag agree on that commit.

ELK's algorithms are Java source compiled through GWT. The official elkjs
0.10.2 release identifies ELK Java commit
28e5173243cab0cf4e2c9816c803bc0d5c47ab24 as its source base:
https://github.com/kieler/elkjs/releases/tag/0.10.2
The fixed Java source tree is:
https://github.com/eclipse-elk/elk/tree/28e5173243cab0cf4e2c9816c803bc0d5c47ab24
An archive acquisition URL is:
https://codeload.github.com/eclipse-elk/elk/tar.gz/28e5173243cab0cf4e2c9816c803bc0d5c47ab24
Both fixed-commit archives were retrieved and retained as original bytes on
2026-10-02. Their acquisition identities are recorded in
release-source-binding.json. The wrapper archive is 1,867,912 bytes, SHA-256
26c7456029827cf5522a80f24aec68c9b00090d5fc5a0cb5a60847bc8207ebe7;
the Java archive is 9,350,528 bytes, SHA-256
f432e8f53006e96f178da9470ced34f551bbb278ffce52ea094a3fe54cb3420c.
Their member lists contain only regular files/directories beneath their exact
repository-and-commit roots, with no absolute or parent-traversal paths. Wrapper
sources/build configuration and Java algorithm sources are present. No archived
script or build was executed. Public delivery of the retained archive bytes has
not been approved; these acquisition records are not a published source offer.

The Java archive's root NOTICE.md and its directly referenced DEPENDENCIES
are supplied verbatim alongside this statement. Both archives' root LICENSE.md
matches the already supplied EPL-2.0 license. The upstream dependency list
covers that repository; it is not a verified inventory of our emitted bundle.

The upstream release declaration establishes the Java source identity. Five
installed elkjs file Git blob identities, including the generated workers and
bundle, match the official fixed wrapper tree. The compact evidence is in
release-source-binding.json. This establishes upstream-declared provenance and
artifact identity; independent regeneration has NOT been verified. Fixed source
acquisition is now recorded. Complete incorporated-component notices, public
source delivery and final shipped-archive acceptance remain unverified.

The supplied fixed-commit build.gradle reads ../elk Java sources, and its CI
checks out that repository's master branch. The release notes supply the Java
commit identity that the CI configuration itself does not pin. A snapshot
metadata compiler dependency and exact tool artifacts remain unrecorded.
The upstream README/build.gradle/CI files are included verbatim for review.

Local graph-worker transformation: before bundling an elk.bundled.js module,
our tsdown plugin prepends `var document = {};` in its lexical scope, so ELK
exports its in-process shim inside our owned worker. The full local plugin is
included as graph-layout-worker.ts. It invokes tsdown to produce a self-contained
IIFE and minifies the result. The separate Flow layout script also bundles ELK;
this graph-worker-specific sentinel is not claimed as a Flow source change.

To modify the local transformation, edit the supplied plugin source and rebuild
with the project build toolchain; retain ELK's license/notices and the source
availability statement. The project root license covers our original plugin
code, not the embedded ELK code. No project public-repository URL is invented
here: the complete local transformation source is supplied with these materials.
Independent regeneration and whole-release source/notice acceptance remain
unverified; this document does not certify a completed EPL release gate.

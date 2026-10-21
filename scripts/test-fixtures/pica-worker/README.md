# Fixed pica Worker gate fixtures

These are fixed byte fixtures retained from an exploratory same-source web build and a scoped Chromium probe. They support static source checks and synthetic validator tests; they are not execution receipts for a new candidate. The [fixed notice/source map](../fixture-notice-map.json) records the retained artifact and notice identities and the limits of source correspondence. Pica 7.1.1 and webworkify 1.5.0 source inputs and their local MIT notices accompany the fixtures, including the two copied Offscreen support scripts derived from the emitted Pica function. Official-original source verification and the full dependency-license inventory remain separate requirements.

The report template retains that task's outcomes but is explicitly marked `fixtureOnly`. Its origin and Blob URLs are synthetic placeholders; no original machine paths, ports or session identifiers are carried as public runtime facts. Tests remove that marker and synthesize candidate paths, inventories and runner/report associations in temporary directories solely to exercise the validator. Those synthetic associations are not evidence that a new candidate has run in a browser; no test launches a browser. The validator rejects reports still marked `fixtureOnly`. Production candidates require their own actual relocated probe.

Exact retained emitted pica artifact SHA-256: `c79c7f30b9c2b043072d5b975caf1dbe27007204fe72480ce4a9dbe5c27bdbce`. Exact runtime SHA-256: `43716186c8575b2ba466c74735300a1a0295debbc765bbd16c5ac72c944ed56f`. Source and byte-slice pins are in `scripts/pica-worker-evidence.mjs`; they must be reviewed together with these fixtures.

Generated Blob sources remain unmodified. Their random wrapper IDs are fixture evidence, not cross-run pins. Do not refresh these bytes or allowed pins automatically.

## Copied-code notices

Preserve [pica MIT](source/pica/LICENSE), [webworkify MIT](source/webworkify/LICENSE), [glur MIT](source/glur/LICENSE), [inherits ISC](source/inherits/LICENSE), [multimath MIT](source/multimath/LICENSE), and [object-assign MIT](source/object-assign/license) with the fixed bundle and large Worker sources. The emitted runtime also carries [Rolldown MIT](source/rolldown/LICENSE) and its original [third-party notices](source/rolldown/THIRD-PARTY-LICENSE).

The [fixed notice/source map](../fixture-notice-map.json) records exact bytes and bounded module correspondence. Identical code across versions does not uniquely establish historical dependency resolution. Whole-payload inventory and release acceptance remain false.

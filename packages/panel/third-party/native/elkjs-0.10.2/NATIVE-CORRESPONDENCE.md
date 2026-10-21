# Native Panel ELK source scope

The retained native packages/panel/tsdown.config.ts imports graphLayoutWorker
from scripts/graph-layout-worker.ts and includes elkjs in noExternal. Its
client/graph-layout.mjs imports elkjs/lib/elk.bundled.js, and the worker entry
uses that layout implementation. The three unchanged native source files are
included under native-source/; the unchanged plugin is graph-layout-worker.ts.
This confirms that the graph-worker transformation described in SOURCE.md is
used by the native Panel build configuration, rather than inferred from the
Companion package. SOURCE.md's Flow statement describes a separate consumer.

This source/configuration correspondence does not establish independent
regeneration of the actual minified output, complete incorporated-component
notices, or public source delivery. The fixed Java/wrapper archives have now
been acquired as recorded in SOURCE.md and release-source-binding.json; no
archived script was executed. Acquisition does not establish regeneration or
approve shipping the archive bytes. Those remaining obligations stay open for
native distribution. The original Java NOTICE.md and directly referenced
DEPENDENCIES are supplied without treating the repository dependency list as
a verified inventory of the emitted native bundle.

# Project-owned Kit content and updates

The local library contains one current saved file set for each Kit or Bundle
identity. A Design Project uses its own complete Kit definitions. This keeps
library customization simple while preserving the behavior of existing projects.
The [architecture baseline](system-design-baseline.md) owns the cross-layer
contract; this page describes its file lifecycle in the development source.
Installed releases support it only when they include the corresponding runtime.

## Library editing

Studio **Edit** opens the same identity and saves its current files. **Copy**
creates an independent identity. Saving does not publish a local version, require
a version bump, or ask the user to confirm and lock the content. Source files may
be incomplete during editing; preview and execution report the actual missing or
invalid definition they need. A failed preview does not discard or forbid saving
source work.

A Kit's local mounts refer to stable Bundle identities and use their current saved
content. Source versions remain useful provenance. Internal revisions and hashes
identify a particular read or prevent a conflicting write; they are not a local
release catalog or a user-operated version selector. Product npm releases and
Design Files publication/handoff keep their existing owners and contracts.

## Project source files

On first Kit selection the Host materializes the complete selected closure:

```text
design_kit/
  source.json
  kit/                 # mindset, kit.yaml and Kit-owned resources
  bundles/<identity>/  # each mounted Bundle's complete files and assets
```

`source.json` records the local source layout and provenance. The source loader
preserves custom entry paths and binary resources. Every consumer—Agent methods,
schema, validation, Panel, summaries and resource reads—loads the project's tree.
An installed executable contribution still needs its normal trusted runtime;
copying declarative files does not install that contribution.

The initial copy is staged and checked before it becomes visible. Once present,
the tree is authoritative: an invalid or partially edited file produces its real
diagnostic, rather than silently reverting to the library. Library edits or
removal do not change existing projects. New projects take the current library
content when they first select their Kit.

A project created before this layout can initialize it from its actual retained
Kit closure, including recorded Bundle overrides. If that original source is
missing, restore it or explicitly choose an update; a newer library definition
must not be substituted as though it were the original.

## Updating an existing project

Ask the Host Agent to compare the project's `design_kit` files with the desired
library content, explain meaningful changes, and edit the project files while
preserving project-specific customizations. For a schema or method change, it
also inspects affected Design Files, preserves saved facts and IDs, and asks the
user only for genuinely missing product decisions. Use the existing validation
and project Git workflow to check and record the result.

There is no separate local release, upgrade candidate, adoption transaction or
page-observation gate. Ordinary file edits and existing validation are sufficient.
A running invocation holds one coherent definition set; if the actual project
files change before its result is saved, the runtime reports a conflict instead
of combining old methods with a new schema. Subsequent reads use the current
project files. Merely changing the library must not block an existing invocation.

## Verification

Focused regression checks cover complete source copying, binary assets, current
library edits, old-project isolation, real retained overrides, corrupt-source
errors and concurrent definition changes. UI checks separately exercise Edit,
Copy, Save, reopen and preview. Native Host checks confirm that the Agent reads
the project-owned methods and resources. A source fixture or successful preview
alone does not establish native-agent or installed-package validation.

Use the current package scripts and the reusable
[agentic E2E scenario C-CURRENT](testing/agentic-e2e.md) for reproduction. Record
source/build, rendered interaction, durable saves, native consumption and
installed-package results separately.

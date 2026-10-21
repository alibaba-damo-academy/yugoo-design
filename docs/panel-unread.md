# Panel update indicators

`new` means that a panel has content the user has not viewed. It is not a
publication count, a dirty-draft indicator, or an indication that an Agent is
running. This behavior belongs to the shared Panel workspace, not the harness.

- Compare every panel's canonical JSON content and owned artifact digests.
  JSON object key order and canonical-file whitespace do not count as updates.
  Publication sequence numbers retain their tab-order/save-provenance role,
  but do not by themselves create unread indicators.
- First loading an existing project establishes a baseline, not a wall of
  historical `new` indicators. Subsequent new panels are unread until viewed.
- A panel is viewed only when the Design Files view is open, that panel is
  selected, and its renderer is available. Graph, experience, picker, closed
  dock and A2UI waiting/error views do not acknowledge content.
- Changes to a currently visible panel show `已更新` / `updated` for 1.5 seconds.
  Ordinary rerenders do not restart this timeout. Hidden updates show `new`.
- User save echoes do not create new indicators. Dirty-draft dots retain
  display priority; the underlying unread state is not discarded.
- Per-project fingerprints and unread receipts are stored locally in the
  browser. They survive refresh and conversation switches, but are not synced
  between browsers/devices. No Design File text or unsaved drafts is stored by
  this feature. Missing/blocked browser storage degrades to in-memory receipts.

Validation: `pnpm --filter dsh-design-panel test:tabs` and Panel typecheck/build.

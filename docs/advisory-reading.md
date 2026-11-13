# Design advisory reading behavior

The shared DSH and Companion advisory card shows newest publications first.
Publication revision determines order even if the system clock changes;
legacy entries fall back to reverse publication/projection order. New
publications record their publication time in plugin-owned journal metadata.
Old entries without a timestamp display “时间未记录” / “Time not recorded”.
Publication time is not changed by accepting, rejecting or deferring advice.

- Automatic reopening targets the newly arrived suggestion, not an older page.
- Manual reopening prefers the newest unread suggestion. If all have been
  viewed, it restores the last selected surviving suggestion.
- While a card is open, incoming suggestions do not change the selected ID or
  interrupt expanded reading. A “有新建议 · 查看” action visits the newest unread.
- Read/unread is browser reading state, distinct from durable pending/deferred
  disposition. Viewing advice does not accept it. Reading positions are kept
  in memory per conversation/project scope and survive closing/reopening the
  inbox; a browser reload establishes fresh reading state.
- Removing the selected card picks the nearest survivor. When none remain,
  show the empty state. Acceptance and execution authority are unchanged.

Validation: Panel `test:advisory-reading`, Design Journal/repository smokes,
Core and Panel typechecks/builds, Companion typecheck and review tests.

## Review settings

The inbox contains a compact settings trigger rather than a full-width form.
It opens a shared, theme-styled dialog bounded by the viewport. The close
button or Escape cancels unsaved setting changes. Save applies the selected
automatic/scheduled/off policy, timing and review scope. Scope choices are
Current design, Related designs and Entire project; they control the evidence
to investigate rather than the number or severity of findings. A missing scope
in an older project uses Related designs (`standard`). Manual review dispatch
and the existing policy-save boundary remain unchanged. The component and styles are shared by DSH and Companion.
Validation: Panel `test:review-settings`.

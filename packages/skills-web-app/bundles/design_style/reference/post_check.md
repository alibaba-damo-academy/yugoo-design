# Persisted preview review

Read the exact file in `config.preview_page.html_file` — the panel renders it
for the user. Judge the page itself (structure, tokens, states), not file
existence. Use the Agent's available browser or visual inspection capability at
desktop and mobile widths when present; `scripts/design-style.mjs` remains the
portable deterministic source check.

Check:

1. **Product specificity** — page name, roles, content, primary action, and
   states reveal this product rather than a generic dashboard.
2. **Hierarchy** — workspace identity, current object/view, work surface, and
   one interaction focal point have a clear reading order.
3. **Token fidelity** — `./tokens.css` is linked; color, type, radius, shadow,
   density, and width use `var(--ds-*)`; HTML declares no competing tokens.
4. **Layout** — no edge collisions, overlap, clipping, unreadable measure, or
   desktop chrome squeezed into mobile.
5. **Assets and states** — local image paths exist, alt text is meaningful,
   icons are coherent inline SVGs from the bundled catalog rather than emoji,
   and relevant focus/selected/error states are visible.

If one real defect is visible, make one targeted native edit, resubmit the
complete state so projections/hydration refresh, and render once more. Do not
regenerate an image that already failed or loop on an intentional placeholder.

If visual inspection is unavailable, inspect the HTML source once for structure, token
link, asset paths, and responsive rules, then report that rendered visual review
was unavailable. If inspection finds a defect, repair the named preview in the
same Producer WorkingCopy and inspect again.

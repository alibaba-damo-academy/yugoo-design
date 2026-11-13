# Web App native presentation adapter

This package registers the retained native Web App renderers with the shared
Panel runtime. It contributes canvas and domain presentation, including BPMN,
React Flow and whiteboard assets; the declarative Bundle definitions belong to
`packages/skills-web-app`.

The client declares `dsh-design-panel` as an injected dependency. That Panel owns
the common UI tokens, theme aliases, preflight, controls and workspace. Native
styles inherit those definitions instead of publishing another palette or reset.
Both stylesheet load orders must keep shared surfaces readable in light and dark
appearance. Isolated renderer fixtures load the same generated Panel stylesheet
explicitly before the provider; their fake registry is not another theme owner.

Build with `pnpm --filter dsh-design-provider-web-app build` after building Panel.
`node smoke-panel-css.mjs` checks the composed style boundary and retained canvas
assets. The focused shared-footer browser regression lives in
`../panel/test/host-theme-browser.test.mjs`; browser checks complement actual Host
walkthroughs rather than accepting native execution or durable saves.

Retained native-source provenance and third-party notices remain in `NOTICE` and
`third-party/`. They are independent of the shared UI ownership above.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { register } = await import('tsx/esm/api'); register()
const { previewVariables, previewValue, inlinePreviewStylesheet } = await import('../src/preview-tokens.ts')
const { styleConfigToCSSVars } = await import('../../provider-web-app/src/client/ported/design/DesignStylePanel/styleVariables.ts')
const { PALETTE_PRESETS } = await import('../../provider-web-app/src/client/ported/design/DesignStylePanel/presetThemes.ts')
const manifest = JSON.parse(await readFile(new URL('../../skills-web-app/bundles/design_style/panel.yaml', import.meta.url), 'utf8'))
test('declarative style projection matches native preview variables for every existing palette', () => {
  for (const preset of PALETTE_PRESETS) {
    const config = { ...preset, layout: { density: preset.density } }
    assert.deepEqual(previewVariables({ config }, manifest.ui.live_preview.tokens), styleConfigToCSSVars(config))
  }
  assert.deepEqual(previewVariables({ config: {} }, manifest.ui.live_preview.tokens), styleConfigToCSSVars({}))
})
test('preview binding reads only own properties and preserves custom strings', () => {
  assert.equal(previewValue({ config: Object.create({ hidden: 'private' }) }, 'config.hidden'), undefined)
  assert.equal(previewValue({}, '__proto__.constructor'), undefined)
  assert.deepEqual(previewVariables({ value: '10px' }, [{ variable: '--radius', path: 'value', values: { full: '9999px' } }]), { '--radius': '10px' })
  assert.deepEqual(previewVariables({ value: 'Custom font' }, [{ variable: '--font', path: 'value', font_fallback: 'sans-serif' }]), { '--font': 'Custom font, sans-serif' })
})
test('stylesheet text cannot escape its style element into executable markup', () => {
  const html = inlinePreviewStylesheet('<html><head></head><body>saved</body></html>', '</style><script>bad()</script>')
  assert.ok(!html.includes('</style><script>'))
  assert.ok(html.includes('<body>saved</body>'))
})

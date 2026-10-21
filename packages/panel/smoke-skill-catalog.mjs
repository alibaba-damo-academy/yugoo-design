/** Keyless acceptance for the runtime-loaded, locale-aware Design skill picker. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildSkillRouteText,
  catalogFromListSkills,
  groupEntriesByLayer,
} from './src/client/ported/design/skillCatalog.ts'

const response = {
  mindset: 'community_kit',
  skills: [
    {
      id: 'community_notes',
      description: '- **Capability**: legacy routing description.',
      manifest: {
        title: { zh: '社区笔记', en: 'Community Notes' },
        label: { zh: '整理社区笔记', en: 'Organize community notes' },
        description: {
          zh: '- **能力**：整理社区提供的笔记。',
          en: '- **Capability**: organize community-provided notes.',
        },
        icon: 'notes',
      },
    },
    {
      id: 'legacy_digest',
      description: '- **Capability**: keep the legacy fallback.',
      manifest: {
        title: { zh: '旧版摘要', en: 'Legacy Digest' },
        label: { zh: '生成旧版摘要', en: 'Create legacy digest' },
      },
    },
  ],
}

const zh = catalogFromListSkills(response, 'zh_CN')
const en = catalogFromListSkills(response, 'en_US')
assert.ok(zh !== null && en !== null)
assert.deepEqual(zh.community_kit.entries.map((entry) => entry.id), ['community_notes', 'legacy_digest'])
assert.equal(zh.community_kit.entries[0].title, '社区笔记')
assert.equal(zh.community_kit.entries[0].description, '- **能力**：整理社区提供的笔记。')
assert.equal(zh.community_kit.entries[0].pickLabel, '整理社区笔记')
assert.equal(en.community_kit.entries[0].title, 'Community Notes')
assert.equal(en.community_kit.entries[0].description, '- **Capability**: organize community-provided notes.')
assert.equal(en.community_kit.entries[0].pickLabel, 'Organize community notes')
assert.equal(zh.community_kit.entries[1].description, response.skills[1].description)
assert.equal(en.community_kit.entries[1].description, response.skills[1].description)
assert.equal(buildSkillRouteText(en.community_kit.entries[0]), 'Organize community notes')
assert.deepEqual(groupEntriesByLayer(en.community_kit).map((group) => group.entries.length), [2])

Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
assert.equal(catalogFromListSkills(response)?.community_kit.entries[0].title, '社区笔记')
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
assert.equal(catalogFromListSkills(response)?.community_kit.entries[0].title, 'Community Notes')

// The catalog stays data-driven: arbitrary runtime Bundle ids render without
// any Core or Panel registration table, and missing localized fields fall back
// through the manifest before using the opaque id.
const community = catalogFromListSkills({
  mindset: 'third_party',
  skills: [{
    id: 'vendor_canvas',
    description: 'Vendor fallback',
    manifest: { title: { zh: '供应商画布' }, label: { en: 'Open vendor canvas' } },
  }],
}, 'en_US')
assert.equal(community?.third_party.entries[0].title, '供应商画布')
assert.equal(community?.third_party.entries[0].pickLabel, 'Open vendor canvas')

// Guard the AutoAgent 2404326a2d card geometry/content treatment retained by
// the DSH port: responsive two-column cards, shared tokens, Markdown body, and
// keyboard activation remain source-owned by the generic picker.
const pickerSource = await readFile(new URL('./src/client/ported/design/SkillCatalogPicker.tsx', import.meta.url), 'utf8')
for (const marker of [
  'grid grid-cols-1 gap-3 sm:grid-cols-2',
  'rounded-xl border p-4',
  'hover:border-[var(--ds-brand-6)] hover:bg-[var(--ds-brand-1)]',
  'ReactMarkdown',
  "event.key === 'Enter' || event.key === ' '",
]) {
  assert.ok(pickerSource.includes(marker), `picker lost upstream UI marker: ${marker}`)
}

console.log('SKILL CATALOG PICKER OK')

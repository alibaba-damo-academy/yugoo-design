/** Small independent content definitions for host-neutral catalog tests. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'

export const contentNotices = Object.freeze({
  LICENSE: 'Synthetic catalog fixture license.\n',
  NOTICE: 'Synthetic catalog fixture notice.\n',
  'THIRD_PARTY_NOTICES.md': 'Synthetic catalog fixture; no third-party content.\n',
})

async function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
}

export async function writeContentBundle(root, { name = 'alpha', version = '0.1', files = {} } = {}) {
  const definitions = {
    'SKILL.md': `---\nname: ${name}\ndescription: Inspect and retain the ${name} fixture evidence.\n---\nRead [the output contract](reference/artifact-contract.md), then record the supplied summary.\n`,
    'skill.yaml': stringify({ name, version, title: { zh: `夹具 ${name}`, en: `Fixture ${name}` },
      label: { zh: `编辑 ${name}`, en: `Edit ${name}` }, presentation: { mode: 'declarative' },
      execution: { mode: 'main', handoff: 'none' }, summary: { fields: [{ source: 'summary', title: 'Summary' }] },
    }),
    'schema.yaml': stringify({ type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } }),
    'validation.yaml': stringify({ skill: name, rules: [{ id: 'summary', scope: ['completion'], code: `${name}.summary`,
      message: 'A summary is required.', check: { non_empty_string: 'summary' } }] }),
    'panel.yaml': stringify({ version: 1, panel_kind: 'document', sections: [], fields: [],
      i18n: { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json', 'zh-CN': 'locales/zh-CN.json' } },
      ui: { component: 'stack', id: name, children: [{ component: 'text_block', id: 'guidance', text: 'Synthetic catalog evidence' }] },
    }),
    'locales/en-US.json': JSON.stringify({ bundleDescription: `Retain ${name} fixture evidence.` }),
    'locales/zh-CN.json': JSON.stringify({ bundleDescription: `保留 ${name} 夹具证据。` }),
    'reference/artifact-contract.md': `# Fixture output\n\nPersist ${name}/${name}.json with a summary string.\n`,
    ...contentNotices,
    ...files,
  }
  await writeFiles(root, definitions)
  return { root, name, version, files: definitions }
}

export async function writeContentCatalog(root, { name = 'catalog_fixture', version = '0.1',
  bundles = [{ name: 'alpha' }, { name: 'beta' }] } = {}) {
  const kitRoot = join(root, 'kits', name), bundlesRoot = join(root, 'bundles')
  const definitions = await Promise.all(bundles.map(bundle => writeContentBundle(join(bundlesRoot, bundle.name), bundle)))
  await writeFiles(root, { 'package.json': JSON.stringify({ name: `fixture-${name}`, designSystem: { kit: {
    root: `./kits/${name}`, mindset: `./kits/${name}/mindset.md`, manifest: `./kits/${name}/kit.yaml`, bundles: './bundles',
  } } }), ...contentNotices })
  await writeFiles(kitRoot, {
    'mindset.md': `---\n${stringify({ name, version, description: 'Synthetic catalog method.',
      display_description: { zh: '合成目录方法。', en: 'Synthetic catalog method.' } })}---\n<design_skills>\n${definitions.map(bundle => `\n## ${bundle.name}\n\nRetain the supplied ${bundle.name} evidence.\n`).join('')}\n</design_skills>\n`,
    'kit.yaml': stringify({ version: 1, mounts: definitions.map(bundle => ({ bindingKey: bundle.name, name: bundle.name, version: bundle.version })) }),
    ...contentNotices,
  })
  return { root, kitRoot, bundlesRoot }
}

/** UI-only fixture: actual workbench/styles, in-memory persistence, no native Host. */
import { createRoot } from 'react-dom/client'
import { InstanceWorkbench, type StudioInstance, type StudioInstanceClient } from '../src/InstanceWorkbench.tsx'
import { STUDIO_WORKSPACE_CSS } from '../src/styles.ts'
import { StudioWorkspace } from '../src/StudioWorkspace.tsx'
import { StudioWorkspaceController } from '../src/controller.ts'
import type { StudioManagementClient } from '../src/types.ts'

const query = new URLSearchParams(location.search)
const locale = query.get('locale') === 'en' ? 'en' : 'zh'
const files: Record<string, string> = {
  'SKILL.md': '# Preview fixture\n\nRead the current source and compare the sample.\n',
  'panel.yaml': 'version: 1\nsections: []\n# ' + 'Source line\n# '.repeat(80),
}
let record: StudioInstance = { id: 'preview-alignment', kind: 'bundle',
  title: { zh: '面板预览布局检查', en: 'Panel preview layout check' }, revision: 0,
  source: { bundle: { name: 'preview-fixture', version: '1.0' } }, mounts: [], refs: [],
  files: Object.entries(files).map(([path, content]) => ({ path, bytes: content.length, editable: true })),
}
const client = {
  list: async () => [record], read: async () => record,
  editCurrent: async () => record,
  readFile: async ({ path }) => ({ id: record.id, revision: record.revision, path, content: files[path] }),
  saveFile: async ({ path, content, expectedRevision }) => {
    if (expectedRevision !== record.revision) throw Error('Fixture revision conflict')
    files[path] = content; record = { ...record, revision: record.revision + 1 }; return record
  },
  preview: async () => ({ preview: { revision: record.revision, panelYaml: files['panel.yaml'], sample: {} }, diagnostics: [] }),
} satisfies Partial<StudioInstanceClient>

const renderPreview = () => <article style={{ padding: 24 }}><h2>{locale === 'zh' ? '样例面板' : 'Sample Panel'}</h2>
  {Array.from({ length: 36 }, (_, index) => <p key={index}>{locale === 'zh' ? '样例内容' : 'Sample content'} {index + 1}</p>)}
  <p data-testid="preview-end">{locale === 'zh' ? '预览末尾' : 'End of preview'}</p></article>
const catalog = {
  workspace: async () => ({ query: '', kits: [], bundles: [{ name: 'preview-fixture', version: '1.0', description: 'UI fixture', usedBy: [] }] }),
  readBundleWorkspace: async () => ({ workspace: { name: 'preview-fixture', version: '1.0', description: 'UI fixture', files: [{ path: 'panel.yaml', bytes: files['panel.yaml'].length }], panel: { kind: 'declarative' } }, diagnostics: [] }),
  readBundleFile: async () => ({ file: { path: 'panel.yaml', content: files['panel.yaml'] }, diagnostics: [] }),
  previewInstalled: async () => ({ preview: { bundle: { name: 'preview-fixture', version: '1.0' }, revision: 0, panelYaml: files['panel.yaml'], sample: {} }, diagnostics: [] }),
} as StudioManagementClient
const controller = new StudioWorkspaceController(catalog)
createRoot(document.getElementById('root')!).render(query.has('catalog')
  ? <StudioWorkspace client={catalog} controller={controller} locale={locale} renderPreview={renderPreview}
      instances={{ ...client, list: async () => [] } as StudioInstanceClient} />
  : <div className="ygd-studio-workspace">
  <style>{STUDIO_WORKSPACE_CSS}</style>
  <InstanceWorkbench client={client as StudioInstanceClient} id={record.id} locale={locale}
    readOnly={query.has('readonly')} initialView="preview" onBack={() => {}} onChanged={() => {}}
    renderPreview={renderPreview} />
</div>)

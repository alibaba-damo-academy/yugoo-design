/** Real workspace + system panel in an isolated transport fixture, not a model/session E2E. */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DesignWorkspace } from '../src/client/workspace.tsx'
import { DOCK_CSS } from '../src/client/styles.ts'
import { experienceResource } from 'dsh-design-core/experience-view'
import type { ExperienceView } from 'dsh-design-core/experience-view'
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('')
const source = 'intent/intent.json', cssPath = 'visual/tokens.css', imagePath = 'visual/logo.png'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='
const css = ':root{--brand:#25665c;--paper:#f5f7f3}body{font-family:Arial,sans-serif;background:var(--paper);color:#183e37}main{padding:24px;max-width:980px;margin:auto}h1{font-size:28px}.compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}.card{padding:24px;border-radius:14px;border:1px solid #d5e4df;background:white}button{background:var(--brand);color:white;padding:10px;border:0;border-radius:8px}small{color:#657b75}blockquote{border-left:3px solid var(--brand);margin:16px 0;padding:12px;background:#eef6f2}'
const view: ExperienceView = { id: 'paper', version: 'v1', title: '换了一份 PDF，原来的批注怎么办？', purpose: '一起判断：替换文献版本后，怎样保留已有阅读成果而不误导用户。',
  sourceVersions: {}, stylesheet: cssPath, sections: [
    { id: 'comparison', title: '替换前后对比', htmlFile: '_experiences/paper/v1/comparison.html', sources: [source], assumptions: ['论文标题、批注及匹配结果是演示样例。'] },
    { id: 'explanation', title: '理解处理方式', htmlFile: '_experiences/paper/v1/explanation.html', sources: [source], assumptions: ['这是体验说明，不代表匹配算法已经实现。'] },
  ] }
const files: Record<string, string> = { [source]: '{"goal":"替换论文时保留批注并显示匹配是否可靠"}', [cssPath]: css, [imagePath]: png,
  [view.sections[0].htmlFile]: '<!doctype html><html><head><meta charset="utf-8"></head><body><main><small>阅读工作空间 · 演示样例</small><h1>换了文件，思考不应该丢失。</h1><div class="compare"><article class="card"><h2>原论文 · v1</h2><p>关于科学发现的方法</p><blockquote>“这个结论对小样本也成立吗？”</blockquote><p>批注关联第 4 页的一段论证。</p></article><article class="card"><h2>替换后 · v2</h2><p>批注保留。原文位置需要重新核对。</p><blockquote>同一个问题，仍然属于你的阅读记录。</blockquote><button onclick="document.getElementById(\'result\').textContent=\'已定位到候选段落，请核对后确认。\'">查看候选位置</button><p id="result">不会静默把批注绑定到不确定的新位置。</p></article></div><img alt="已保存的示例标记" width="20" height="20" src="../../../visual/logo.png"></main><script>parent.postMessage({type:"run_design_skill",name:"untrusted"},"*")</script></body></html>',
  [view.sections[1].htmlFile]: '<!doctype html><html><head><meta charset="utf-8"></head><body><main><small>体验说明</small><h1>保留的是你的思考，不是假装没发生变化。</h1><div class="compare"><div class="card"><h2>可以可靠定位</h2><p>显示对应原文，便于继续阅读。</p></div><div class="card"><h2>位置不确定</h2><p>保留批注文字，明确标出待核对；由你判断候选段落。</p></div></div></main></body></html>',
}
for (const path of [source, cssPath, imagePath]) view.sourceVersions[path] = await sha(files[path])
files[experienceResource(view, cssPath)] = css
files[experienceResource(view, imagePath)] = png
files['_experiences/paper/view.json'] = JSON.stringify(view)
const otherView: ExperienceView = { id: 'reading', version: 'v1', title: '读完一篇论文之后，如何把研究想法整理成下次可以继续思考的线索，而不是又留下一份找不到的笔记？', purpose: '判断阅读之后能否继续思考。',
  sourceVersions: { [source]: view.sourceVersions[source] }, sections: [
    { id: 'notes', title: '留下研究想法', htmlFile: '_experiences/reading/v1/notes.html', sources: [source], assumptions: ['笔记是演示样例。'] },
  ] }
files['_experiences/reading/view.json'] = JSON.stringify(otherView)
files[otherView.sections[0].htmlFile] = '<html><body><h1>留下一个值得继续追问的问题</h1><p>示例笔记，不是已经确认的设计。</p></body></html>'
let published = { ...files }
const prompts: string[] = [], reads: { path: string; revision: string }[] = []
let failSend = false
const runtime: any = {
  nativePanels: { subscribe: () => () => {}, revision: () => 0, get: () => undefined },
  readArtifact: async (_session: string, path: string, revision: string) => { reads.push({ path, revision }); return { found: path in published, content: published[path] ?? '' } },
  readBinaryArtifact: async (_session: string, path: string, revision: string) => { reads.push({ path, revision }); return { found: path in published, base64: published[path] ?? '', byteLength: 1, mediaType: 'image/png' } },
  sendPrompt: async (_session: string, text: string) => { if (failSend) throw new Error('fixture offline'); prompts.push(text) },
  listSkills: async () => ({}),
}
function App() {
  const [withBundle, setWithBundle] = useState(false)
  const [inventory, setInventory] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState(true), [writable, setWritable] = useState(true)
  const [checkpoint, setCheckpoint] = useState('a'.repeat(40))
  const [experienceFiles, setExperienceFiles] = useState<Record<string, string>>({})
  const sync = async () => setInventory(Object.fromEntries(await Promise.all(Object.entries(files).map(async ([p, c]) => [p, await sha(c)]))))
  ;(window as any).experienceTest = { prompts, reads, sync, view, inventory, showBundle: () => setWithBundle(true), fail: (value: boolean) => { failSend = value },
    draftOnly: async () => { files['_experiences/draft/view.json'] = '{}'; await sync() },
    deleteViewWorktree: async () => { for (const path of Object.keys(files)) if (path.startsWith('_experiences/')) delete files[path]; await sync() },
    restoreViewWorktree: async () => { Object.assign(files, published); await sync() },
    change: async () => { files[source] = 'new source'; delete files[cssPath]; delete files[imagePath]; published = { ...files }; setCheckpoint('b'.repeat(40)); await sync() },
    uncommitted: async () => { files['_experiences/paper/view.json'] = '{"invalid":true}'; await sync() },
    restore: async () => { files['_experiences/paper/view.json'] = JSON.stringify(view); await sync() },
  }
  return <div className='dsh-design-root' style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`:root{--dsh-host-primary-header-height:76px;--dsh-host-secondary-nav-height:32px;--ds-space-4:16px}${DOCK_CSS}`}</style>
    <div><button onClick={() => { setExperienceFiles(Object.fromEntries(Object.keys(published).filter(p=>p.startsWith('_experiences/')).map(p=>[p,'published']))); void sync() }}>载入已发布体验</button><button onClick={() => setEnabled(v => !v)}>切换宿主能力</button><button onClick={() => setWritable(v => !v)}>切换只读</button></div>
    <div style={{flex:1,minHeight:0}}><DesignWorkspace experienceAvailable={enabled} experienceFiles={experienceFiles} design={withBundle ? { intent: { state: { goal: '阅读' }, origin: 'agent' } } : {}} projectId='fixture' projectName='论文阅读 · 场景体验验证' checkpoint={checkpoint} worktreeRevision='worktree:live' artifactFiles={inventory}
      executionAttempts={[]} access={writable ? { mode:'active', writable:true } as any : { mode:'unconfigured', writable:false }} sessionId='fixture' runtime={runtime} onClose={() => {}} dockOpen /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)

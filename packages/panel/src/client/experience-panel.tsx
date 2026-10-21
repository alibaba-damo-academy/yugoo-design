/** System-level derived views; independent of Bundle catalog, drafts and save actions. */
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { experienceFeedback, experienceFreshness, experienceResource, readExperienceView, type ExperienceView } from 'dsh-design-core/experience-view'
import type { SkillPanelProps } from './panels/shared.ts'
import { useTextArtifactContents } from './panels/artifact-text-hydration.ts'
import { useHtmlImageContents } from './panels/artifact-html-images.ts'
import { secureDesignSrcDoc } from './srcdoc-security.ts'
import { Button } from './ported/ui/button.tsx'
import { Info } from 'lucide-react'
import { EXPERIENCE_CSS } from './experience-styles.ts'
import { DesignPanelSurface } from './design-panel-surface.tsx'

const recommendExperiencePrompt = '请根据目前已经落盘的设计，推荐一两个值得体验的具体情境，说明各自能帮助我判断什么。先讨论，不要直接生成或修改设计。'

let documentGeneration = 0

export interface ExperiencePanelProps {
  artifactFiles?: Readonly<Record<string, string>>
  experienceFiles?: Readonly<Record<string, string>>
  readArtifact: SkillPanelProps['readArtifact']
  readBinaryArtifact: SkillPanelProps['readBinaryArtifact']
  sendPrompt: (text: string) => Promise<void>
  writable: boolean
  footerStart?: ReactNode
}
export function ExperiencePanel(props: ExperiencePanelProps): ReactElement {
  const [selected, setSelected] = useState(''), [sectionId, setSectionId] = useState('')
  const [pending, setPending] = useState(false), [sendError, setSendError] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const paths = Object.keys(props.experienceFiles ?? {}).filter(path => /^_experiences\/[A-Za-z0-9_-]+\/view\.json$/u.test(path)).sort()
  const indexes = useTextArtifactContents(paths.map(path => ({ id: path, path })), props.readArtifact, null, props.experienceFiles)
  const views: ExperienceView[] = [], errors: string[] = []
  for (const path of paths) {
    const content = indexes[path]
    if (typeof content !== 'string') continue
    try {
      const view = readExperienceView(JSON.parse(content))
      if (path !== `_experiences/${view.id}/view.json`) throw new Error('View index identity mismatch')
      views.push(view)
    } catch (error) { errors.push(`${path}: ${String(error)}`) }
  }
  const view = views.find(v => v.id === selected) ?? views[0]
  const section = view?.sections.find(s => s.id === sectionId) ?? view?.sections[0]
  const entries = section ? [{ id: 'html', path: section.htmlFile }] : []
  const contents = useTextArtifactContents(entries, props.readArtifact, view, props.experienceFiles)
  const readFrozenImage = useCallback(async (path: string) => view?.sourceVersions[path]
    ? props.readBinaryArtifact(experienceResource(view, path))
    : { found: false, mediaType: 'image/png' as const, base64: '', byteLength: 0 }, [view?.id, view?.version, props.readBinaryArtifact])
  const frozenImageFiles = props.experienceFiles && view ? { ...props.experienceFiles,
    ...Object.fromEntries(Object.keys(view.sourceVersions).flatMap(path => {
      const key = props.experienceFiles?.[experienceResource(view, path)]
      return key ? [[path, key]] : []
    })) } : props.experienceFiles
  const images = useHtmlImageContents(entries, contents, readFrozenImage, view, frozenImageFiles)
  const styles = useTextArtifactContents(view?.stylesheet ? [{ id: 'css', path: experienceResource(view, view.stylesheet) }] : [], props.readArtifact, view, props.experienceFiles)
  const srcDoc = useMemo(() => typeof images.html === 'string' && (!view?.stylesheet || typeof styles.css === 'string')
    ? secureDesignSrcDoc(images.html, 'interactive-preview', `<style>${(styles.css ?? '').replace(/</g, '\\3c ')}\nhtml,body{margin:0;min-height:100%}</style>`)
    : undefined, [images.html, styles.css, view?.stylesheet])
  // Hydrated resources change the actual document, not its semantic section.
  // Mount that document afresh; unchanged polling must retain the same frame.
  const generation = useMemo(() => ++documentGeneration, [srcDoc])
  const freshness = view ? experienceFreshness(view, props.artifactFiles) : undefined
  const send = async (text: string) => {
    if (pending || !props.writable) return
    setPending(true); setSendError('')
    try { await props.sendPrompt(text) } catch (e) { setSendError(String(e)) }
    finally { setPending(false) }
  }
  return <div className='dsh-experience-workspace'>
    <style>{EXPERIENCE_CSS}</style>
    <div className='dsh-experience-body'><DesignPanelSurface><div className='dsh-experience' data-testid='experience-panel'>
    {errors.map(error => <p key={error} role='alert' className='dsh-experience-error'>{error}</p>)}
    {!view || !section ? <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground'>
      <p>{paths.some(path => indexes[path] === undefined) ? '正在读取场景体验…' : '尚无可读取的已发布体验。从一个具体情境出发，把分散的设计放在一起看。'}</p>
      <Button disabled={!props.writable || pending} onClick={() => void send(recommendExperiencePrompt)}>让 AI 推荐体验情境</Button>
    </div> : <div className='dsh-experience-layout'>
      <button type='button' className='dsh-experience-directory-toggle' aria-expanded={navigationOpen} onClick={() => setNavigationOpen(v => !v)}>场景目录 · {views.length} 个场景 {navigationOpen ? '▴' : '▾'}</button>
      <nav aria-label='场景目录' className={`dsh-experience-directory dsh-panel-workspace-navigation dsh-record-workspace-flat-nav${navigationOpen ? ' is-open' : ''}`}>
        <header className='dsh-experience-directory-heading'><h2><span className='dsh-experience-directory-title'>场景体验<span className='dsh-experience-info' title='已保存的体验可随时回看，不替代设计文件。' aria-label='已保存的体验可随时回看，不替代设计文件。' tabIndex={0}><Info size={14} aria-hidden='true' /></span></span><span className='dsh-experience-count'>{views.length}</span></h2></header>
        <div className='dsh-panel-workspace-nav-items'>
        <button type='button' className='dsh-experience-add dsh-record-workspace-flat-add' aria-label='新增场景' disabled={!props.writable || pending}
          onClick={() => void send(recommendExperiencePrompt)}><span aria-hidden='true'>＋</span>新增场景</button>
        {views.map(v => <div key={v.id} className='dsh-experience-nav-group'>
          <button type='button' className='dsh-experience-scene' aria-current={v.id === view.id ? 'page' : undefined}
            onClick={() => { if (v.id !== view.id) { setSelected(v.id); setSectionId('') }; setNavigationOpen(false) }}>{v.title}</button>
          {v.id === view.id && v.sections.length > 1 && <div className='dsh-experience-sections'>
            {v.sections.map(s => <button type='button' key={s.id} aria-current={s.id === section.id ? 'page' : undefined}
              onClick={() => { setSectionId(s.id); setNavigationOpen(false) }}>{s.title}</button>)}
          </div>}
        </div>)}
        </div>
      </nav>
      <div className='dsh-experience-content'>
        <header className='dsh-experience-heading'>
          <h2>{view.sections.length > 1 ? section.title : view.title}</h2>
          <span className='dsh-experience-disclaimer'>演示 · 非已确认设计{section.assumptions.length > 0 ? ` · ${section.assumptions.length} 项假设` : ''}</span>
        </header>
        {freshness?.status === 'stale' && <div role='alert' className='dsh-experience-warning'>设计依据已变化或缺失，此体验可能过期。可回看原体验，或按最新设计刷新。</div>}
        {freshness?.status === 'unknown' && <p role='status' className='dsh-experience-warning'>暂不能核对来源版本。</p>}
        <details key={`${view.id}:${section.id}`} className='dsh-experience-evidence'>
          <summary>体验说明与设计依据</summary>
          <div className='dsh-experience-evidence-body'>
            <p>{view.purpose}</p>
            <p>画面内操作仅用于演示；切换内容后重置，不会保存到设计文件。</p>
            <p>{view.stylesheet ? '引用已有视觉样式' : '中性示意'}</p>
            {section.assumptions.length > 0 && <><h3>演示假设（未确认）</h3><ul>{section.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            <h3>设计依据</h3>{section.sources.map(path => <div key={path}>{path}</div>)}
            {freshness?.status === 'stale' && <p>已变化或缺失：{freshness.changed.join('、')}</p>}
            <p>资源支持：内联内容、选定 CSS、已引用的 PNG/JPEG/WebP 图片；外部字体、CSS 依赖及其他外链不加载。</p>
          </div>
        </details>
        <div className='dsh-experience-canvas'>
          {srcDoc ? <iframe key={`${view.id}:${view.version}:${section.id}:${generation}`} title={`场景体验：${section.title}`} sandbox='allow-scripts' referrerPolicy='no-referrer' srcDoc={srcDoc} />
            : <p role='status' className='p-6 text-sm text-gray-500'>{contents.html === null || styles.css === null ? '体验文件或样式暂不可用；原引用已保留。' : '正在读取体验画面…'}</p>}
        </div>
        {sendError && <p role='alert' className='dsh-experience-error'>发送失败，当前体验已保留：{sendError}</p>}
      </div>
    </div>}
    {sendError && !view && <p role='alert' className='dsh-experience-error'>发送失败：{sendError}</p>}
    </div></DesignPanelSurface></div>
    <footer className='dsh-design-view-footer dsh-experience-footer' data-testid='experience-footer'>
      {props.footerStart}
      {view && section && <div className='dsh-experience-actions'>
        <Button size='sm' disabled={!props.writable || pending} onClick={() => void send(experienceFeedback(view, section, props.artifactFiles))}>在主对话讨论当前内容</Button>
        <Button size='sm' variant='outline' disabled={!props.writable || pending} onClick={() => void send(experienceFeedback(view, section, props.artifactFiles, true))}>按最新设计刷新</Button>
      </div>}
    </footer>
  </div>
}

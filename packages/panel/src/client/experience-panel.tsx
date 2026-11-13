/** System-level derived views; independent of Bundle catalog, drafts and save actions. */
import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { experienceFeedback, experienceFreshness, experienceResource, readExperienceView, type ExperienceView } from 'dsh-design-core/experience-view'
import type { SkillPanelProps } from './panels/shared.ts'
import { useTextArtifactContents } from './panels/artifact-text-hydration.ts'
import { useHtmlImageContents } from './panels/artifact-html-images.ts'
import { INTERACTIVE_PREVIEW_SANDBOX, secureDesignSrcDoc } from './srcdoc-security.ts'
import { Button } from './ported/ui/button.tsx'
import { Info } from 'lucide-react'
import { EXPERIENCE_CSS } from './experience-styles.ts'
import { DesignPanelSurface } from './design-panel-surface.tsx'
import { usePanelI18n } from '../panel-i18n.tsx'

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
  const { locale, t } = usePanelI18n()
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
      <p>{paths.some(path => indexes[path] === undefined) ? t('experienceLoading') : t('experienceEmpty')}</p>
      <Button disabled={!props.writable || pending} onClick={() => void send(t('experienceRecommendPrompt'))}>{t('experienceRecommend')}</Button>
    </div> : <div className='dsh-experience-layout'>
      <button type='button' className='dsh-experience-directory-toggle' aria-expanded={navigationOpen} onClick={() => setNavigationOpen(v => !v)}>{t('experienceDirectory')} · {views.length} {navigationOpen ? '▴' : '▾'}</button>
      <nav aria-label={t('experienceDirectory')} className={`dsh-experience-directory dsh-panel-workspace-navigation dsh-record-workspace-flat-nav${navigationOpen ? ' is-open' : ''}`}>
        <header className='dsh-experience-directory-heading'><h2><span className='dsh-experience-directory-title'>{t('experienceTitle')}<span className='dsh-experience-info' title={t('experienceHint')} aria-label={t('experienceHint')} tabIndex={0}><Info size={14} aria-hidden='true' /></span></span><span className='dsh-experience-count'>{views.length}</span></h2></header>
        <div className='dsh-panel-workspace-nav-items'>
        <button type='button' className='dsh-experience-add dsh-record-workspace-flat-add' aria-label={t('experienceAdd')} disabled={!props.writable || pending}
          onClick={() => void send(t('experienceRecommendPrompt'))}><span aria-hidden='true'>＋</span>{t('experienceAdd')}</button>
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
          <span className='dsh-experience-disclaimer'>{t('experienceDemo')}{section.assumptions.length > 0 ? ` · ${t('experienceAssumptionCount', { count: section.assumptions.length })}` : ''}</span>
        </header>
        {freshness?.status === 'stale' && <div role='alert' className='dsh-experience-warning'>{t('experienceStale')}</div>}
        {freshness?.status === 'unknown' && <p role='status' className='dsh-experience-warning'>{t('experienceUnknown')}</p>}
        <details key={`${view.id}:${section.id}`} className='dsh-experience-evidence'>
          <summary>{t('experienceEvidence')}</summary>
          <div className='dsh-experience-evidence-body'>
            <p>{view.purpose}</p>
            <p>{t('experienceDemoHint')}</p>
            <p>{t(view.stylesheet ? 'experienceExistingStyle' : 'experienceNeutralStyle')}</p>
            {section.assumptions.length > 0 && <><h3>{t('experienceAssumptions')}</h3><ul>{section.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            <h3>{t('experienceSources')}</h3>{section.sources.map(path => <div key={path}>{path}</div>)}
            {freshness?.status === 'stale' && <p>{t('experienceChanged', { files: freshness.changed.join(t('listSeparator')) })}</p>}
            <p>{t('experienceResources')}</p>
          </div>
        </details>
        <div className='dsh-experience-canvas'>
          {srcDoc ? <iframe key={`${view.id}:${view.version}:${section.id}:${generation}`} title={t('experienceFrameTitle', { title: section.title })} sandbox={INTERACTIVE_PREVIEW_SANDBOX} referrerPolicy='no-referrer' srcDoc={srcDoc} />
            : <p role='status' className='p-6 text-sm text-gray-500'>{t(contents.html === null || styles.css === null ? 'experienceUnavailable' : 'experienceFrameLoading')}</p>}
        </div>
        {sendError && <p role='alert' className='dsh-experience-error'>{t('experienceSendFailedRetained', { error: sendError })}</p>}
      </div>
    </div>}
    {sendError && !view && <p role='alert' className='dsh-experience-error'>{t('experienceSendFailed', { error: sendError })}</p>}
    </div></DesignPanelSurface></div>
    <footer className='dsh-design-view-footer dsh-experience-footer' data-testid='experience-footer'>
      {props.footerStart}
      {view && section && <div className='dsh-experience-actions'>
        <Button size='sm' disabled={!props.writable || pending} onClick={() => void send(experienceFeedback(view, section, props.artifactFiles, false, locale))}>{t('experienceDiscuss')}</Button>
        <Button size='sm' variant='outline' disabled={!props.writable || pending} onClick={() => void send(experienceFeedback(view, section, props.artifactFiles, true, locale))}>{t('experienceRefresh')}</Button>
      </div>}
    </footer>
  </div>
}

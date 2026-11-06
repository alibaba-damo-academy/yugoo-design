import { SlidersHorizontal } from 'lucide-react'
import { usePanelI18n } from '../panel-i18n.js'
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DesignKnowledgeStatusSnapshot } from '../../../core/src/design-knowledge-status.ts'
import { GraphCanvas, graphSourceColors } from './graph-canvas.js'
import { GraphExploration } from './graph-exploration.js'
import { projectExplorationRecords } from './graph-bundle-model.js'
import { projectRecords, recordOwner, recordReach, scopeGraph, edgeReading, filterRelations, graphNodeMatches, relationMeaningLabel, relationOriginLabels, relationOriginLabel, type DesignGraph, type GraphEdge } from './graph-model.js'
import { GraphInspector } from './graph-inspector.js'
import { graphStyles } from './graph-styles.js'
import { Button } from './ported/ui/button.js'
import { subscribeLivePoll } from './live-poll.js'

/** Read-only system exploration. Search, selection and scope are independent. */
export function GraphPanel({ read, readStatus, retry, footer, ownerLabels, exploration = false }: { ownerLabels?: Record<string, string>; exploration?: boolean; read: () => Promise<{ content: string }>; readStatus?: () => Promise<DesignKnowledgeStatusSnapshot | undefined>; retry?: () => Promise<unknown>; footer: ReactNode }) {
  const { locale, t } = usePanelI18n()
  const [relationSelection, setRelationSelection] = useState<GraphEdge>()
  const [retrying, setRetrying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pollFailed, setPollFailed] = useState(false)
  const [graph, setGraph] = useState<DesignGraph>(), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const [liveStatus, setLiveStatus] = useState<DesignKnowledgeStatusSnapshot>(), [updatedAt, setUpdatedAt] = useState(0)
  const [statusDisconnected, setStatusDisconnected] = useState(false)
  const [publicationLoadFailed, setPublicationLoadFailed] = useState(false)
  const graphRef = useRef<DesignGraph>()
  const initialReadPending = useRef(false)
  const [readingGraph, setReadingGraph] = useState(true)
  const [loadSeconds, setLoadSeconds] = useState(0)
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(''), [edgeId, setEdgeId] = useState('')
  const [seed, setSeed] = useState(''), [meaning, setMeaning] = useState('all'), [origin, setOrigin] = useState('all')
  const [limit, setLimit] = useState(exploration ? Number.MAX_SAFE_INTEGER : 160)
  const [layout, setLayout] = useState('stress2')
  const [canvasView, setCanvasView] = useState<'graph' | 'ring'>('graph')
  const [perspective, setPerspective] = useState('original')
  const [sizeMode, setSizeMode] = useState<'uniform' | 'reach'>('uniform')
  const sourceLabels = useMemo(() => Object.fromEntries([...new Set(graph?.nodes.map(n => n.owner) ?? [])].sort().map(owner => [owner, ownerLabels?.[owner] ?? owner])), [graph, ownerLabels])
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const closeViewSettings = () => { setViewSettingsOpen(false); settingsTrigger.current?.focus() }
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const detailsElement = useRef<HTMLElement>(null)
  const unavailablePolls = useRef(0)
  useEffect(() => { if (detailsElement.current) detailsElement.current.scrollTop = 0 }, [selected, edgeId])
  useEffect(() => {
    let alive = true; unavailablePolls.current = 0; graphRef.current = undefined; setError(''); setPollFailed(false); setStatusDisconnected(false); setPublicationLoadFailed(false); setGraph(undefined); setSelected(''); setEdgeId(''); setRelationSelection(undefined); setSeed(''); setExpanded(new Set())
    initialReadPending.current = true
    setReadingGraph(true)
    setLoadSeconds(0)
    void read().then(r => { if (alive && graphRef.current === undefined) { const next = JSON.parse(r.content) as DesignGraph; graphRef.current = next; setGraph(next) } }).catch(e => { if (alive) setError(String(e)) }).finally(() => { if (alive) { initialReadPending.current = false; setReadingGraph(false) } })
    return () => { alive = false }
  }, [read, reload])
  useEffect(() => {
    if (graph) return
    const started = Date.now()
    const timer = setInterval(() => setLoadSeconds(Math.floor((Date.now() - started) / 1000)), 1_000)
    return () => clearInterval(timer)
  }, [graph, reload])
  useEffect(() => {
    if (!readStatus) return
    let alive = true, busy = false, lastSample = 0
    const sample = async (force = false) => {
      if (!alive || busy || (!force && Date.now() - lastSample < 2_500)) return
      busy = true; lastSample = Date.now()
      let statusRead = false
      let graphReadStarted = false
      try {
        const status = await readStatus()
        statusRead = true
        if (!alive) return
        if (status === undefined) {
          setLiveStatus(undefined); setStatusDisconnected(true)
          return
        }
        setStatusDisconnected(false)
        setLiveStatus(status)
        const published = status.latestComplete?.revision
        const previous = graphRef.current
        if (status.state !== 'current' || published === previous?.knowledgeRevision) setPublicationLoadFailed(false)
        if (!initialReadPending.current && ((force && (!previous || !published)) || (status.state === 'current' && published && previous?.knowledgeRevision !== published))) {
          graphReadStarted = true
          setReadingGraph(true)
          const next = JSON.parse((await read()).content) as DesignGraph
          if (!alive) return
          // A read racing publication or a project switch must not replace the
          // last complete graph with an old generation or a fallback preview.
          if (next.projectId && next.projectId !== status.project) return
          if (published && next.knowledgeRevision !== published) return
          // A manual read of the same immutable publication should not reset
          // the graph camera or re-run its layout.
          if (!previous?.knowledgeRevision || next.knowledgeRevision !== previous.knowledgeRevision) {
            graphRef.current = next
            setGraph(next)
          }
          setPublicationLoadFailed(false)
          setError('')
          if (previous?.knowledgeRevision) setUpdatedAt(Date.now())
        }
      } catch {
        if (alive) {
          if (!statusRead) {
            setLiveStatus(undefined); setStatusDisconnected(true)
          } else {
            setPublicationLoadFailed(true)
          }
        }
      } finally { busy = false; if (alive) { if (graphReadStarted) setReadingGraph(false); if (force) setRefreshing(false) } }
    }
    void sample(refreshKey > 0)
    const unsubscribe = subscribeLivePoll(() => { void sample() })
    return () => { alive = false; unsubscribe() }
  }, [read, readStatus, refreshKey])
  useEffect(() => {
    if (updatedAt === 0) return
    const timer = setTimeout(() => setUpdatedAt(0), 3_500)
    return () => clearTimeout(timer)
  }, [updatedAt])
  useEffect(() => {
    if (readStatus) return
    const transientUnavailable = graph?.knowledgeStatus === 'unavailable' && unavailablePolls.current < 6
    if (pollFailed || (!transientUnavailable && graph?.semantic?.state !== 'indexing' && graph?.coverage?.embedding !== 'indexing' && graph?.recovery?.state !== 'rebuilding')) return
    let alive = true
    const timer = setTimeout(() => { void read().then(r => {
      if (!alive) return
      const next = JSON.parse(r.content) as DesignGraph
      if (next.knowledgeStatus === 'unavailable') unavailablePolls.current += 1
      else unavailablePolls.current = 0
      setGraph(old => old && old.checkpoint === next.checkpoint && JSON.stringify(old.nodes) === JSON.stringify(next.nodes) && JSON.stringify(old.edges) === JSON.stringify(next.edges) ? { ...next, nodes: old.nodes, edges: old.edges } : next)
    }).catch(() => { if (alive) { setPollFailed(true) } }) }, 2500)
    return () => { alive = false; clearTimeout(timer) }
  }, [graph, read, readStatus, pollFailed])
  const projected = useMemo(() => graph ? (exploration ? projectExplorationRecords(graph, expanded) : projectRecords(graph, expanded)) : { nodes: [], edges: [], total: 0 }, [graph?.nodes, graph?.edges, expanded, exploration])
  const reach = useMemo(() => graph ? recordReach(graph) : new Map<string, number>(), [graph?.nodes, graph?.edges])
  const filtered = useMemo(() => filterRelations(projected, meaning, origin), [projected, meaning, origin])
  const scope = useMemo(() => scopeGraph(filtered, 'all', seed, 1, limit), [filtered, seed, limit])
  const fullScope = useMemo(() => scopeGraph(filtered, 'all', seed, 1, projected.nodes.length), [filtered, seed, projected.nodes.length])
  const layoutEdges = useMemo(() => {
    const ids = new Set(scope.nodes.map(n => n.id))
    const source = perspective === 'original' ? projected.edges : scope.edges
    return source.filter(e => ids.has(e.from) && ids.has(e.to))
  }, [projected, scope.nodes, scope.edges, perspective])
  const results = useMemo(() => query.trim() ? fullScope.nodes.filter(n => graphNodeMatches(n, query)) : [], [fullScope, query])
  const matches = useMemo(() => query.trim() ? new Set(results.map(n => n.id)) : null, [results, query])
  const chosen = graph?.nodes.find(n => n.id === selected), edge = (exploration ? relationSelection : undefined) ?? scope.edges.find(e => e.id === edgeId)
  const contentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (graph) for (const node of graph.nodes) if (!node.record) {
      const owner = recordOwner(graph, node.id)
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    return counts
  }, [graph?.nodes, graph?.edges])
  const expandable = useMemo(() => graph?.nodes.filter(n => n.record && contentCounts.has(n.id)) ?? [], [graph?.nodes, contentCounts])
  const allExpanded = expandable.length > 0 && expandable.every(n => expanded.has(n.id))
  const chosenOwner = graph && chosen ? recordOwner(graph, chosen.id) : undefined
  const knowledgeState = statusDisconnected ? 'unknown' : liveStatus?.state ?? graph?.knowledgeStatus
  const recovery = statusDisconnected ? undefined : liveStatus?.recovery ?? graph?.recovery
  const knowledgeUnavailable = knowledgeState === 'unavailable' || (!knowledgeState && graph?.warnings.some(w => /Knowledge.*不可用/.test(w)))
  const memoryCache = graph?.semantic?.cache === 'memory'
  const toggleRecord = (id: string) => { setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next }); setSelected(id); setEdgeId(''); setRelationSelection(undefined); setSeed('') }
  const clear = () => { setSelected(''); setEdgeId(''); setRelationSelection(undefined) }
  const spatial = layout === 'stress3'
  const meanings = useMemo(() => [...new Set([...(graph?.edges ?? []).map(e => edgeReading(e).meaning), ...(meaning === 'all' ? [] : [meaning])])].sort(), [graph?.edges, meaning])
  const viewSettingsCount = [!exploration && perspective !== 'original', !exploration && layout !== 'stress2', !exploration && sizeMode !== 'uniform', meaning !== 'all', origin !== 'all', limit !== (exploration ? Number.MAX_SAFE_INTEGER : 160)].filter(Boolean).length
  const stalePublication = statusDisconnected ? false : liveStatus
    ? liveStatus.state === 'running' && liveStatus.freshness === 'different' && !!liveStatus.latestComplete
    : graph?.coverage?.embedding === 'indexing' && graph.freshness?.indexedCheckpoint
      && graph.freshness.indexedCheckpoint !== graph.freshness.sourceCheckpoint
  // `due` is the honest no-job stale state: files moved past the latest
  // complete generation and nothing is running; the last complete graph stays
  // readable and the wording must never claim currency.
  const duePublication = !statusDisconnected && (knowledgeState === 'due' || (!liveStatus && graph?.coverage?.embedding === 'due'))
  const publicationPending = !statusDisconnected && !!(liveStatus?.state === 'current' && liveStatus.latestComplete && graph?.knowledgeRevision !== liveStatus.latestComplete.revision)
  const sourceEquivalent = liveStatus
    ? liveStatus.freshness === 'matching' && !!graph?.freshness?.indexedCheckpoint && graph.freshness.indexedCheckpoint !== liveStatus.head
    : !!graph?.freshness?.sourceEquivalent
  const phase = liveStatus?.phase ?? graph?.coverage?.phase
  const phaseLabel = phase === 'projection' ? t('knowledgeGraphPhaseProjection')
    : phase === 'semantic' ? t('knowledgeGraphPhaseSemantic')
      : phase === 'publication' ? t('knowledgeGraphPhasePublication') : t('knowledgeGraphPhaseUpdating')
  const health = statusDisconnected ? t('knowledgeGraphHealthDisconnected')
    : recovery?.state === 'rebuilding' ? t('knowledgeGraphHealthRecovery')
    : stalePublication ? t('knowledgeGraphHealthPrevious', { phase: phaseLabel.replace(/…$/u, '') })
      : knowledgeState === 'running' || (!liveStatus && graph?.coverage?.embedding === 'indexing') ? phaseLabel
        : knowledgeState === 'queued' || (!liveStatus && graph?.coverage?.embedding === 'queued') ? t('knowledgeGraphHealthQueued')
          : publicationPending ? t(publicationLoadFailed ? 'knowledgeGraphHealthLoadFailed' : 'knowledgeGraphHealthLoading')
          : duePublication
            ? t(liveStatus?.latestComplete || graph?.freshness?.indexedCheckpoint ? 'knowledgeGraphHealthDue' : 'knowledgeGraphHealthNotBuilt')
            : knowledgeState === 'current' ? t(updatedAt ? 'knowledgeGraphHealthUpdated' : 'knowledgeGraphHealthCurrent')
              : knowledgeState === 'unknown' ? t(graph?.coverage?.projection === 'structural-preview' ? 'knowledgeGraphHealthPreview' : 'knowledgeGraphHealthChecking')
              : knowledgeState === 'failed' ? t(graph?.freshness?.indexedCheckpoint ? 'knowledgeGraphHealthFailedPrevious' : 'knowledgeGraphHealthFailedEmpty')
                : knowledgeState === 'disabled' ? t('knowledgeGraphHealthDisabled')
                  : graph?.semantic?.state === 'indexing' ? t('knowledgeGraphHealthComputing', { completed: graph.semantic.completed, total: graph.semantic.total })
                    : graph?.semantic?.state === 'ready' ? t('knowledgeGraphHealthReady') : graph?.semantic?.state === 'error' ? t('knowledgeGraphHealthIndexFailed')
                      : knowledgeUnavailable ? t('knowledgeGraphHealthRestricted') : t('knowledgeGraphHealthStructure')
  // Transport state owns the notice; translated copy never controls recovery.
  // Raw read/retry errors are retained independently of local UI notices.
  const visibleError = statusDisconnected ? t('knowledgeGraphDisconnectedNotice')
    : publicationLoadFailed ? t('knowledgeGraphPublicationNotice')
      : pollFailed ? t('knowledgeGraphPollNotice') : error
  return <section className='design-graph-view' aria-label={t('knowledgeGraphTitle')} onPointerDownCapture={event => {
    for (const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>('.graph-popover[open]')) if (!menu.contains(event.target as Node)) menu.open = false
  }} onKeyDown={event => {
    if (event.key !== 'Escape') return
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.graph-popover[open]')
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); event.stopPropagation() }
  }}>
    <style>{graphStyles}</style>
    <header className='graph-toolbar'>
      <div className='graph-levels' role='group' aria-label={t('knowledgeGraphLevels')}>
        <button aria-pressed={expanded.size === 0} onClick={() => { setExpanded(new Set()); clear(); setSeed('') }}>{t('knowledgeGraphOverview')}</button>
        <button aria-pressed={allExpanded} disabled={!expandable.length} onClick={() => { setExpanded(new Set(expandable.map(n => n.id))); clear(); setSeed('') }}>{t('knowledgeGraphExpand')}</button>
      </div>
      {!exploration && <div className='graph-levels' aria-label={t('knowledgeGraphViews')}><button aria-pressed={canvasView === 'graph'} onClick={() => setCanvasView('graph')}>{t('knowledgeGraphView')}</button><button aria-pressed={canvasView === 'ring'} onClick={() => setCanvasView('ring')}>{t('knowledgeGraphRing')}</button></div>}
      <div className='graph-search'><input aria-label={t('knowledgeGraphSearchLabel')} placeholder={t('knowledgeGraphSearchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} /></div>
      <button className='graph-refresh' disabled={refreshing} title={t('knowledgeGraphRefreshHint')} onClick={() => {
        setRefreshing(true)
        if (readStatus) setRefreshKey(n => n + 1)
        else { setReload(n => n + 1); setRefreshing(false) }
      }}>{refreshing ? t('knowledgeGraphReading') : t('knowledgeGraphRefresh')}</button>
      <Button ref={settingsTrigger} variant='ghostIcon' size='icon' className='graph-settings-trigger'
        title={t('knowledgeGraphSettings')} aria-label={`${t('knowledgeGraphSettings')}${viewSettingsCount ? ` (${viewSettingsCount})` : ''}`}
        aria-expanded={viewSettingsOpen} aria-controls='graph-view-settings'
        onKeyDown={event => { if (event.key === 'Escape' && viewSettingsOpen) { event.stopPropagation(); closeViewSettings() } }}
        onClick={() => setViewSettingsOpen(value => !value)}>
        <SlidersHorizontal strokeWidth={1.5} aria-hidden='true' />
        {viewSettingsCount > 0 && <span className='graph-settings-count' aria-hidden='true'>{viewSettingsCount}</span>}
      </Button>
      {matches && <details open className='graph-search-results'><summary>{t('knowledgeGraphSearchResults', { count: matches.size })}</summary><div>
        {results.map(n => <button key={n.id} onClick={() => { setSeed(n.id); setSelected(n.id); setEdgeId(''); setRelationSelection(undefined); setQuery('') }}>{n.label}</button>)}
        {!results.length && <span>{t('knowledgeGraphNoMatches')}</span>}
      </div></details>}
    </header>
    {viewSettingsOpen && <aside id='graph-view-settings' className='graph-settings-drawer' aria-label={t('knowledgeGraphSettingsLabel')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeViewSettings() } }}>
      <div className='graph-settings-head'><div><strong>{t('knowledgeGraphSettings')}</strong><p>{t('knowledgeGraphSettingsHint')}</p></div><button aria-label={t('knowledgeGraphCloseSettings')} onClick={closeViewSettings}>×</button></div>
      <div className='graph-settings-scroll'>
        {!exploration && <fieldset className='graph-settings-section'><legend>{t('knowledgeGraphLayoutSection')}</legend>
          <label><span>{t('knowledgeGraphPerspective')}</span><select aria-label={t('knowledgeGraphPerspective')} value={perspective} onChange={e => setPerspective(e.target.value)}><option value='original'>{t('knowledgeGraphFullLayout')}</option><option value='natural'>{t('knowledgeGraphNaturalLayout')}</option><option value='source'>{t('knowledgeGraphSourceLayout')}</option><option value='focus'>{t('knowledgeGraphFocusLayout')}</option></select></label>
          <label><span>{t('knowledgeGraphDimension')}</span><select aria-label={t('knowledgeGraphLayoutLabel')} value={layout} onChange={e => setLayout(e.target.value)}><option value='stress2'>2D · Stress</option><option value='stress3'>3D · Stress</option></select></label>
          <label><span>{t('knowledgeGraphNodeSize')}</span><select aria-label={t('knowledgeGraphNodeSize')} value={sizeMode} onChange={e => setSizeMode(e.target.value as 'uniform' | 'reach')}><option value='uniform'>{t('knowledgeGraphUniformSize')}</option><option value='reach'>{t('knowledgeGraphReachSize')}</option></select></label>
        </fieldset>}
        <fieldset className='graph-settings-section'><legend>{t('knowledgeGraphFilters')}</legend>
          <label><span>{t('knowledgeGraphMeaning')}</span><select aria-label={t('knowledgeGraphMeaning')} value={meaning} onChange={e => { setMeaning(e.target.value); clear() }}><option value='all'>{t('knowledgeGraphAllMeanings')}</option>{meanings.map(value => <option key={value} value={value}>{relationMeaningLabel(value, locale)}</option>)}</select></label>
          <label><span>{t('knowledgeGraphOrigin')}</span><select aria-label={t('knowledgeGraphOrigin')} value={origin} onChange={e => { setOrigin(e.target.value); clear() }}><option value='all'>{t('knowledgeGraphAllOrigins')}</option>{Object.keys(relationOriginLabels).map(value => <option key={value} value={value}>{relationOriginLabel(value, locale)}</option>)}</select></label>
          <p className='graph-settings-note'>{t('knowledgeGraphFilterHint')}</p>
        </fieldset>
        <fieldset className='graph-settings-section'><legend>{t('knowledgeGraphContentSection')}</legend>
          <label><span>{t('knowledgeGraphLimit')}</span><select aria-label={t('knowledgeGraphLimitLabel')} value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={160}>{t('knowledgeGraphLimit160')}</option><option value={500}>{t('knowledgeGraphLimit500')}</option><option value={Number.MAX_SAFE_INTEGER}>{t('knowledgeGraphAllNodes')}</option></select></label>
        </fieldset>
        <div className='graph-settings-actions'><button onClick={() => { setPerspective('original'); setLayout('stress2'); setCanvasView('graph'); setSizeMode('uniform'); setMeaning('all'); setOrigin('all'); setLimit(exploration ? Number.MAX_SAFE_INTEGER : 160); clear() }}>{t('knowledgeGraphReset')}</button></div>
      </div>
    </aside>}
    {!graph ? <div className='graph-initial-stage'><div className='graph-initial-status' role='status'>
      {readingGraph && <div className='graph-progress' role='progressbar' aria-label={t('knowledgeGraphLoading')} aria-valuetext={t('knowledgeGraphLoadingProgress')} />}
      <strong>{readingGraph ? t('knowledgeGraphLoading') : t('knowledgeGraphNotLoaded')}</strong>
      <p>{visibleError || (readingGraph ? (liveStatus?.latestComplete ? t('knowledgeGraphFoundVersion', { revision: liveStatus.latestComplete.revision }) : t('knowledgeGraphLoadingRecords')) : t('knowledgeGraphRetryLoad'))}</p>
      {readingGraph && loadSeconds >= 5 && <small>{t('knowledgeGraphLoadWait', { seconds: loadSeconds })}</small>}
      {liveStatus && <small>{health}</small>}
    </div></div> : <>
      {visibleError && <p role='alert' className='graph-notice'>{visibleError}</p>}
      {(seed || meaning !== 'all' || origin !== 'all') && <div className='graph-scopebar'>
        {seed && <><span>{t('knowledgeGraphNeighborhoodTitle', { label: graph.nodes.find(n => n.id === seed)?.label ?? seed })}</span><button onClick={() => setSeed('')}>{t('knowledgeGraphBack')}</button></>}
        {(meaning !== 'all' || origin !== 'all') && <><span>{t('knowledgeGraphScope', { meaning: meaning === 'all' ? t('allRecords') : relationMeaningLabel(meaning, locale), origin: origin === 'all' ? t('allRecords') : relationOriginLabel(origin, locale) })}</span><button onClick={() => { setMeaning('all'); setOrigin('all'); clear() }}>{t('knowledgeGraphShowAllRelations')}</button></>}
      </div>}
      {scope.edges.length === 0 && <p className='graph-notice'>{t(graph.semantic?.state === 'indexing' ? 'knowledgeGraphNoEdgesIndexing' : 'knowledgeGraphNoEdges')}</p>}
      {exploration && <div className='graph-view-note' role='note'>{t('knowledgeGraphExplorationHint')}</div>}
      <div className='graph-view-body' data-exploring={exploration} data-inspecting={Boolean(chosen || edge)}>
        {exploration ? <GraphExploration graph={scope} selected={selected} relation={edge} onNode={id => { setSelected(id); setEdgeId(''); setRelationSelection(undefined) }} onEdge={relation => { setRelationSelection(relation); setEdgeId(relation.id); setSelected('') }} onClear={clear} /> : (
        <GraphCanvas sourceLabels={sourceLabels} contentCounts={contentCounts} viewMode={canvasView} sizeMode={sizeMode} graph={scope} layoutEdges={layoutEdges} layout={`${layout}-${perspective}`} reach={reach} selected={selected} selectedEdge={edgeId} matches={matches} onNode={id => { setSelected(id); setEdgeId(''); setRelationSelection(undefined) }} onEdge={id => { setEdgeId(id); setSelected('') }} onClear={clear} />
        )}
        {(chosen || edge) && <aside className='graph-inspector dsh-design-panel' aria-label={t('knowledgeGraphDetails')} ref={detailsElement} onKeyDown={event => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.dsh-panel-help')?.querySelector('[aria-expanded=true]')) { event.stopPropagation(); clear() } }}>
          <GraphInspector key={chosen?.id ?? edge?.id} graph={graph} node={chosen} edge={edge} relations={scope.edges} sourceLabels={sourceLabels}
            recordAction={chosenOwner && expandable.some(n => n.id === chosenOwner) ? { expanded: expanded.has(chosenOwner), count: contentCounts.get(chosenOwner) ?? 0, toggle: () => toggleRecord(chosenOwner) } : undefined}
            onClose={clear} onNeighborhood={() => { if (chosen) { setSeed(chosen.id); setQuery('') } }}
            onNode={id => { if (chosenOwner) setExpanded(old => new Set([...old, chosenOwner])); setSelected(id); setEdgeId(''); setRelationSelection(undefined); setSeed('') }}
            onEdge={relation => { setEdgeId(relation.id); setRelationSelection(relation); setSelected('') }}
            onExpandEndpoints={() => { const ids = (edge?.members ?? (edge ? [edge] : [])).flatMap(e => [recordOwner(graph, e.from), recordOwner(graph, e.to)]).filter((id): id is string => Boolean(id)); setExpanded(old => new Set([...old, ...ids])); clear(); setSeed('') }} />
        </aside>}
      </div>
      <div className='graph-statusbar'>
        {!statusDisconnected && (knowledgeState === 'running' || recovery?.state === 'rebuilding' || (publicationPending && !publicationLoadFailed)) && <div className='graph-progress' role='progressbar' aria-label={t('knowledgeGraphUpdating')} aria-valuetext={health} />}
        <span className='graph-health' role='status' data-warning={knowledgeUnavailable || graph.coverage?.embedding === 'error'}><i className='graph-health-dot'/>{health}</span>
        <span>{t('knowledgeGraphScopeCounts', { mode: t(expanded.size ? allExpanded ? 'knowledgeGraphAllExpanded' : 'knowledgeGraphSomeExpanded' : 'knowledgeGraphRecordOverview'), shown: scope.nodes.length, total: scope.total, relationships: scope.edges.filter(e => e.kind !== 'contains').length })}{expanded.size ? t('knowledgeGraphContainmentCount', { count: scope.edges.filter(e => e.kind === 'contains').length }) : ''}</span>
        {knowledgeUnavailable && graph.recovery?.state !== 'rebuilding' && <span>{t('knowledgeGraphUnavailable')}</span>}
        {graph.coverage?.embedding === 'indexing' && <span>{phaseLabel}</span>}
        {graph.coverage?.embedding === 'error' && <span>{t('knowledgeGraphSemanticIncomplete')}</span>}
        {memoryCache && <span>{t('knowledgeGraphMemoryCache')}</span>}
        <details className='graph-popover'><summary>{t('knowledgeGraphStatusDetails')}{graph.warnings.length ? t('knowledgeGraphWarnings', { count: graph.warnings.length }) : ''}</summary><div className='graph-popover-body'>
          {graph.recovery && <p>{graph.recovery.message}</p>}
          {graph.coverage && <p>{t('knowledgeGraphCoverage', { projection: graph.coverage.projection, embedding: graph.coverage.embedding, review: graph.coverage.review })}</p>}
          {graph.freshness && <p>{t('knowledgeGraphVersions', { target: (liveStatus?.head ?? graph.freshness.sourceCheckpoint).slice(0, 12), indexed: graph.freshness.indexedCheckpoint ? graph.freshness.indexedCheckpoint.slice(0, 12) : t('knowledgeGraphNoVersion') })}{sourceEquivalent ? t('knowledgeGraphSameEvidence') : ''}</p>}
          {graph.coverage?.ontology && <p>{t('knowledgeGraphOntology', { revision: graph.coverage.ontology.contractRevision?.slice(0, 20) ?? 'legacy', instantiated: graph.coverage.ontology.instantiatedTypes, declared: graph.coverage.ontology.declaredTypes, stable: graph.coverage.ontology.stable, structural: graph.coverage.ontology.structural, anonymous: graph.coverage.ontology.anonymous, untyped: graph.coverage.ontology.untyped })}</p>}
          {graph.knowledgeRevision && <p>{t('knowledgeGraphRevision', { revision: graph.knowledgeRevision })}</p>}
          {graph.semantic && <p>{graph.semantic.model} · {graph.semantic.message}</p>}
          {memoryCache && <p>{t('knowledgeGraphMemoryHint')}</p>}
          {graph.warnings.map((w, i) => <p key={i}>{w}</p>)}
          {graph.recovery?.state === 'error' && retry && <button disabled={retrying} onClick={() => { setRetrying(true); void retry().then(() => setReload(n => n + 1)).catch(e => setError(String(e))).finally(() => setRetrying(false)) }}>{retrying ? t('knowledgeGraphRetrying') : t('knowledgeGraphRetryRecovery')}</button>}
        </div></details>
        <details className='graph-popover'><summary>{t('knowledgeGraphLegend')}</summary><div className='graph-popover-body'>
          <div className='graph-legend'><span><i/>{t('knowledgeGraphRelationship')}</span><span><i data-kind='contains'/>{t('knowledgeGraphContains')}</span><span><i data-kind='candidate'/>{t('knowledgeGraphCandidate')}</span></div>
          <div className='graph-legend'>{Object.entries(sourceLabels).map(([owner, label], index) => <span key={owner}><i style={{ border: 0, width: 7, height: 7, borderRadius: '50%', background: graphSourceColors[index % graphSourceColors.length] }} />{label}</span>)}</div>
          <p>{exploration ? t('knowledgeGraphExplorationLegend') : t('knowledgeGraphGraphLegend')}</p>
          <p>{t('knowledgeGraphEvidenceLegend')}</p>
          <p>{t('knowledgeGraphDirectionLegend')}</p>
          <p>{exploration ? t('knowledgeGraphExploreControls') : spatial ? t('knowledgeGraphSpatialControls') : t('knowledgeGraphFlatControls')}</p><p>{t('knowledgeGraphKeyboard', { revision: graph.checkpoint.slice(0, 8) })}</p>
        </div></details>
      </div>
    </>}
    <footer className='graph-footer dsh-design-view-footer'>{footer}</footer>
  </section>
}

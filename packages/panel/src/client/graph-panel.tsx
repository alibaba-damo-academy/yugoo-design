import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DesignKnowledgeStatusSnapshot } from '../../../core/src/design-knowledge-status.ts'
import { GraphCanvas, graphSourceColors } from './graph-canvas.js'
import { GraphExploration } from './graph-exploration.js'
import { projectExplorationRecords } from './graph-bundle-model.js'
import { projectRecords, recordOwner, recordReach, scopeGraph, contentDetail, edgeReading, filterRelations, graphNodeMatches, relationMeaningLabel, relationOriginLabels, relationDirectionLabel, relationLifecycleLabel, type DesignGraph, type GraphEdge } from './graph-model.js'
import { graphStyles } from './graph-styles.js'
import { subscribeLivePoll } from './live-poll.js'

/** Read-only system exploration. Search, selection and scope are independent. */
export function GraphPanel({ read, readStatus, retry, footer, ownerLabels, exploration = false }: { ownerLabels?: Record<string, string>; exploration?: boolean; read: () => Promise<{ content: string }>; readStatus?: () => Promise<DesignKnowledgeStatusSnapshot | undefined>; retry?: () => Promise<unknown>; footer: ReactNode }) {
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const detailsElement = useRef<HTMLElement>(null)
  const unavailablePolls = useRef(0)
  useEffect(() => { if (detailsElement.current) detailsElement.current.scrollTop = 0 }, [selected, edgeId])
  useEffect(() => {
    let alive = true; unavailablePolls.current = 0; graphRef.current = undefined; setError(''); setPollFailed(false); setGraph(undefined); setSelected(''); setEdgeId(''); setRelationSelection(undefined); setSeed(''); setExpanded(new Set())
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
          setError('图谱状态暂不可确认；当前仍显示上一完整版本，恢复连接后会自动重试。')
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
        setError(old => old.startsWith('新图谱已发布，但载入暂不可用') || old.startsWith('图谱状态暂不可确认') ? '' : old)
      } catch {
        if (alive) {
          if (!statusRead) {
            setLiveStatus(undefined); setStatusDisconnected(true)
            setError('图谱状态暂不可确认；当前仍显示上一完整版本，恢复连接后会自动重试。')
          } else {
            setPublicationLoadFailed(true)
            setError('新图谱已发布，但载入暂不可用；当前仍显示上一完整版本，恢复后会自动重试。')
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
    }).catch(() => { if (alive) { setPollFailed(true); setError('图谱状态读取失败，请点击刷新；这不代表后台恢复或索引已经失败。') } }) }, 2500)
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
  const detail = graph && chosen ? contentDetail(graph, chosen) : undefined
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
  const phaseLabel = phase === 'projection' ? '正在读取设计文件并校验关系证据…'
    : phase === 'semantic' ? '正在计算语义候选…'
      : phase === 'publication' ? '正在发布新图谱…' : '正在更新 KAG…'
  const health = statusDisconnected ? '图谱状态暂不可确认 · 当前显示上一完整版本'
    : recovery?.state === 'rebuilding' ? '正在自动恢复图谱…'
    : stalePublication ? `${phaseLabel.replace(/…$/u, '')} · 当前显示上一完整版本`
      : knowledgeState === 'running' || (!liveStatus && graph?.coverage?.embedding === 'indexing') ? phaseLabel
        : knowledgeState === 'queued' || (!liveStatus && graph?.coverage?.embedding === 'queued') ? '更新已排队，等待后台执行…'
          : publicationPending ? (publicationLoadFailed ? '新图谱已发布，载入暂不可用 · 当前显示上一完整版本' : '新图谱已发布，正在载入…')
          : duePublication
            ? (liveStatus?.latestComplete || graph?.freshness?.indexedCheckpoint ? '设计文件已更新，图谱待刷新 · 当前显示上一完整版本' : '图谱待建立（尚无完整版本）')
            : knowledgeState === 'current' ? (updatedAt ? '图谱已更新' : '统一 KAG 可用')
              : knowledgeState === 'unknown' ? (graph?.coverage?.projection === 'structural-preview'
                ? '正在确认图谱版本 · 暂显示文件结构预览'
                : '已保存图谱可查看 · 正在确认最新版本')
              : knowledgeState === 'failed' ? (graph?.freshness?.indexedCheckpoint ? '图谱更新失败 · 可查看上一完整版本' : '图谱更新失败 · 尚无完整版本')
                : knowledgeState === 'disabled' ? '结构图可用 · 语义关联未启用'
                  : graph?.semantic?.state === 'indexing' ? `正在计算关联 ${graph.semantic.completed}/${graph.semantic.total}`
                    : graph?.semantic?.state === 'ready' ? '关联图可用' : graph?.semantic?.state === 'error' ? '语义索引失败'
                      : knowledgeUnavailable ? '图谱读取受限' : '结构图可用'
  return <section className='design-graph-view' onPointerDownCapture={event => {
    for (const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>('.graph-popover[open]')) if (!menu.contains(event.target as Node)) menu.open = false
  }} onKeyDown={event => {
    if (event.key !== 'Escape') return
    const menu = (event.target as Element).closest<HTMLDetailsElement>('.graph-popover[open]')
    if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); event.stopPropagation() }
  }}>
    <style>{graphStyles}</style>
    <header className='graph-toolbar'>
      <strong className='graph-title'>设计关联图</strong>
      <div className='graph-levels' role='group' aria-label='内容层级'>
        <button aria-pressed={expanded.size === 0} onClick={() => { setExpanded(new Set()); clear(); setSeed('') }}>概览</button>
        <button aria-pressed={allExpanded} disabled={!expandable.length} onClick={() => { setExpanded(new Set(expandable.map(n => n.id))); clear(); setSeed('') }}>展开</button>
      </div>
      {!exploration && <div className='graph-levels' aria-label='关联视图'><button aria-pressed={canvasView === 'graph'} onClick={() => setCanvasView('graph')}>Graph</button><button aria-pressed={canvasView === 'ring'} onClick={() => setCanvasView('ring')}>圆形关联</button></div>}
      <div className='graph-search'><input aria-label='搜索设计字段' placeholder='搜索设计内容…' value={query} onChange={e => setQuery(e.target.value)} /></div>
      <button className='graph-refresh' disabled={refreshing} title='核对图谱状态；仅在版本变化时读取新图，不触发 KAG 更新' onClick={() => {
        setRefreshing(true)
        if (readStatus) setRefreshKey(n => n + 1)
        else { setReload(n => n + 1); setRefreshing(false) }
      }}>{refreshing ? '读取中…' : '刷新显示'}</button>
      <button className='graph-settings-trigger' aria-expanded={viewSettingsOpen} aria-controls='graph-view-settings' onClick={() => setViewSettingsOpen(value => !value)}>视图与筛选{viewSettingsCount > 0 && <span className='graph-settings-count'>{viewSettingsCount}</span>}</button>
      {matches && <details open className='graph-search-results'><summary>搜索结果 · {matches.size} 项 · 点击进入关联邻域</summary><div>
        {results.map(n => <button key={n.id} onClick={() => { setSeed(n.id); setSelected(n.id); setEdgeId(''); setRelationSelection(undefined); setQuery('') }}>{n.label}</button>)}
        {!results.length && <span>当前范围没有匹配内容；可清空搜索或返回全图。</span>}
      </div></details>}
    </header>
    {viewSettingsOpen && <aside id='graph-view-settings' className='graph-settings-drawer' aria-label='视图与筛选设置' onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setViewSettingsOpen(false) } }}>
      <div className='graph-settings-head'><div><strong>视图与筛选</strong><p>只改变当前阅读方式，不写回 KAG</p></div><button aria-label='关闭视图设置' onClick={() => setViewSettingsOpen(false)}>×</button></div>
      <div className='graph-settings-scroll'>
        {!exploration && <fieldset className='graph-settings-section'><legend>布局与空间</legend>
          <label><span>布局视角</span><select aria-label='布局视角' value={perspective} onChange={e => setPerspective(e.target.value)}><option value='original'>完整关联布局</option><option value='natural'>自然聚集 · 弱化枢纽权重</option><option value='source'>来源分区 · 按设计文件</option><option value='focus'>关系聚焦 · 跟随筛选</option></select></label>
          <label><span>空间维度</span><select aria-label='图谱布局' value={layout} onChange={e => setLayout(e.target.value)}><option value='stress2'>2D · Stress</option><option value='stress3'>3D · Stress</option></select></label>
          <label><span>节点大小</span><select aria-label='节点大小' value={sizeMode} onChange={e => setSizeMode(e.target.value as 'uniform' | 'reach')}><option value='uniform'>统一大小</option><option value='reach'>按关联范围</option></select></label>
        </fieldset>}
        <fieldset className='graph-settings-section'><legend>关系筛选</legend>
          <label><span>关系含义</span><select aria-label='关系含义' value={meaning} onChange={e => { setMeaning(e.target.value); clear() }}><option value='all'>全部含义</option>{meanings.map(value => <option key={value} value={value}>{relationMeaningLabel(value)}</option>)}</select></label>
          <label><span>关系来源</span><select aria-label='关系来源' value={origin} onChange={e => { setOrigin(e.target.value); clear() }}><option value='all'>全部来源</option>{Object.entries(relationOriginLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className='graph-settings-note'>关系含义与生成来源分别筛选；候选关系不等于已确认设计事实。</p>
        </fieldset>
        <fieldset className='graph-settings-section'><legend>内容与更新</legend>
          <label><span>显示数量</span><select aria-label='显示节点上限' value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={160}>最多 160 节点</option><option value={500}>最多 500 节点</option><option value={Number.MAX_SAFE_INTEGER}>全部节点（较耗资源）</option></select></label>
        </fieldset>
        <div className='graph-settings-actions'><button onClick={() => { setPerspective('original'); setLayout('stress2'); setCanvasView('graph'); setSizeMode('uniform'); setMeaning('all'); setOrigin('all'); setLimit(exploration ? Number.MAX_SAFE_INTEGER : 160); clear() }}>恢复默认</button></div>
      </div>
    </aside>}
    {!graph ? <div className='graph-initial-stage'><div className='graph-initial-status' role='status'>
      {readingGraph && <div className='graph-progress' role='progressbar' aria-label='正在载入已发布图谱' aria-valuetext='正在读取节点和关系，尚无可计算的完成百分比' />}
      <strong>{readingGraph ? '正在载入已发布图谱' : '图谱暂未载入'}</strong>
      <p>{error || (readingGraph ? (liveStatus?.latestComplete ? `已找到版本 ${liveStatus.latestComplete.revision}，正在读取节点和关系。` : '正在读取设计记录和关系。') : '请点击“刷新显示”重试。')}</p>
      {readingGraph && loadSeconds >= 5 && <small>已等待 {loadSeconds} 秒 · 这一步是读取图谱，不会重新计算 KAG；完成后会自动显示。</small>}
      {liveStatus && <small>{health}</small>}
    </div></div> : <>
      {error && <p role='alert' className='graph-notice'>{error}</p>}
      {(seed || meaning !== 'all' || origin !== 'all') && <div className='graph-scopebar'>
        {seed && <><span>关联邻域 · {graph.nodes.find(n => n.id === seed)?.label}</span><button onClick={() => setSeed('')}>返回全图</button></>}
        {(meaning !== 'all' || origin !== 'all') && <><span>含义：{meaning === 'all' ? '全部' : relationMeaningLabel(meaning)} · 来源：{origin === 'all' ? '全部' : relationOriginLabels[origin as keyof typeof relationOriginLabels]}</span><button onClick={() => { setMeaning('all'); setOrigin('all'); clear() }}>显示全部关系</button></>}
      </div>}
      {scope.edges.length === 0 && <p className='graph-notice'>当前没有可显示的关联线{graph.semantic?.state === 'indexing' ? '，正在计算语义候选。' : '；这不表示设计内容之间不存在关联。'}</p>}
      {exploration && <div className='graph-view-note' role='note'>同一份设计知识 · Bundle → 记录 / 产物 → 内容 · 选择对象或连线查看原始依据</div>}
      <div className='graph-view-body' data-exploring={exploration} data-inspecting={Boolean(chosen || edge)}>
        {exploration ? <GraphExploration graph={scope} selected={selected} relation={edge} onNode={id => { setSelected(id); setEdgeId(''); setRelationSelection(undefined) }} onEdge={relation => { setRelationSelection(relation); setEdgeId(relation.id); setSelected('') }} onClear={clear} /> : (
        <GraphCanvas sourceLabels={sourceLabels} contentCounts={contentCounts} viewMode={canvasView} sizeMode={sizeMode} graph={scope} layoutEdges={layoutEdges} layout={`${layout}-${perspective}`} reach={reach} selected={selected} selectedEdge={edgeId} matches={matches} onNode={id => { setSelected(id); setEdgeId(''); setRelationSelection(undefined) }} onEdge={id => { setEdgeId(id); setSelected('') }} onClear={clear} />
        )}
        {(chosen || edge) && <aside className='graph-inspector' aria-label='图谱详情' ref={detailsElement} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); clear() } }}>
          <div className='graph-inspector-head'><span>{chosen ? detail?.kind : '关系证据'}</span><button aria-label='关闭节点详情' onClick={clear}>×</button></div>
          {chosen ? <><h4>{chosen.label}</h4>
            {chosen.sourceLabel && chosen.sourceLabel !== chosen.label && <p className='graph-source-caption'>原文摘要：{chosen.sourceLabel}</p>}
            {detail?.source && detail.source.id !== chosen.id && <p className='graph-source-caption'>来源：{detail.source.label}</p>}
            <div className='graph-inspector-actions'>
            {chosenOwner && expandable.some(n => n.id === chosenOwner) && <button aria-label={expanded.has(chosenOwner) ? '收起此记录' : '展开此记录'} onClick={() => toggleRecord(chosenOwner)}>{expanded.has(chosenOwner) ? '收起此记录' : '展开此记录'} · {contentCounts.get(chosenOwner)}项</button>}
            <button onClick={() => { setSeed(chosen.id); setQuery('') }}>查看关联邻域</button></div>
            <section className='graph-node-source' aria-label='节点来源'><div className='graph-source-heading'>来源</div><div className='graph-source-panel'><small>面板</small><strong>{chosen.sourcePanel ?? chosen.previewSourcePanel ?? chosen.owner}</strong></div><dl><dt>设计文件</dt><dd>{chosen.file}</dd><dt>文件内位置</dt><dd>{chosen.pointer || '/'}</dd>{chosen.ontologyType && <><dt>结构类型</dt><dd>{chosen.ontologyType}</dd></>}{chosen.identityQuality && <><dt>身份质量</dt><dd>{chosen.identityQuality === 'stable' ? '稳定身份' : chosen.identityQuality === 'structural' ? '结构身份' : '匿名内容身份'}</dd></>}</dl><small>结构类型由 Kit schema 自动编译；用于检索与约束，不是人为职责分类</small></section>
            <section aria-label='当前可见关联'>
              <h5>当前可见关联 · {scope.edges.filter(e => e.from === chosen.id || e.to === chosen.id).length}</h5>
              <small>遵循当前范围与筛选；未显示的关系可通过搜索、关联邻域或显示设置查找。</small>
              <div className='graph-unit-list'>{scope.edges.filter(e => e.from === chosen.id || e.to === chosen.id).map(relation => {
                const other = graph.nodes.find(n => n.id === (relation.from === chosen.id ? relation.to : relation.from))
                return <button key={relation.id} onClick={() => { setEdgeId(relation.id); setRelationSelection(relation); setSelected('') }}>
                  {relation.label} · {other?.label ?? (relation.from === chosen.id ? relation.to : relation.from)} · {relationOriginLabels[edgeReading(relation).origin]}
                </button>
              })}</div>
            </section>
            {!!detail?.children.length && <section aria-label='内容单元'><h5>包含的内容单元 · {detail.children.length}</h5><div className='graph-unit-list'>{detail.children.map(child => <button key={child.id} onClick={() => {
              if (chosenOwner) setExpanded(old => new Set([...old, chosenOwner]))
              setSelected(child.id); setEdgeId(''); setRelationSelection(undefined); setSeed('')
            }}>{child.label}</button>)}</div></section>}
            <details className='graph-evidence' open={chosen.contentKind !== 'container'} key={chosen.id}><summary>来源字段摘录</summary><small>来源内容可能截断；选择题仅包含已保存回答及补充。属性保留在所属单元中。</small><pre>{chosen.context}</pre></details></> : edge ? <><h4>{edge.label}</h4>
            {(edge.members ?? [edge]).map(member => {
              const reading = edgeReading(member)
              return <section key={member.id} className='graph-relation-detail' aria-label='关系依据'>
                <p className='graph-relation-statement'>{graph.nodes.find(n => n.id === member.from)?.label ?? member.from}<span>{reading.direction === 'forward' ? ' → ' : reading.direction === 'symmetric' ? ' ↔ ' : ' — '}{relationMeaningLabel(reading.meaning)}{reading.direction === 'forward' ? ' → ' : reading.direction === 'symmetric' ? ' ↔ ' : ' — '}</span>{graph.nodes.find(n => n.id === member.to)?.label ?? member.to}</p>
                <dl className='graph-relation-meta'><dt>类型</dt><dd>{reading.relationType}</dd><dt>来源</dt><dd>{relationOriginLabels[reading.origin]}</dd><dt>方向</dt><dd>{relationDirectionLabel(reading.direction)}</dd><dt>状态</dt><dd>{relationLifecycleLabel(reading.lifecycle)}</dd></dl>
                {(reading.origin === 'unknown' || reading.lifecycle === 'unknown') && <p className='graph-source-caption'>此关系未声明完整的结构化来源或状态；原始证据仍保留在下方。未知不代表无证据，也不代表已确认。</p>}
                {reading.meaning === 'similar' && <p className='graph-source-caption'>相似仅用于发现候选，不证明依赖或因果关系。</p>}
                {reading.origin === 'agent' && <p className='graph-source-caption'>来源于 Agent 分析；是否已采纳以状态为准，来源本身不代表确认。</p>}
                <p>{member.label}</p><details className='graph-evidence'><summary>原始证据</summary><pre>{member.evidence}</pre></details>
              </section>
            })}
            <button onClick={() => { const ids = (edge.members ?? [edge]).flatMap(e => [recordOwner(graph, e.from), recordOwner(graph, e.to)]).filter((id): id is string => Boolean(id)); setExpanded(old => new Set([...old, ...ids])); clear(); setSeed('') }}>展开关联两端</button>
          </> : null}
        </aside>}
      </div>
      <div className='graph-statusbar'>
        {!statusDisconnected && (knowledgeState === 'running' || recovery?.state === 'rebuilding' || (publicationPending && !publicationLoadFailed)) && <div className='graph-progress' role='progressbar' aria-label='图谱正在更新' aria-valuetext={health} />}
        <span className='graph-health' role='status' data-warning={knowledgeUnavailable || graph.coverage?.embedding === 'error'}><i className='graph-health-dot'/>{health}</span>
        <span>{expanded.size ? allExpanded ? '全部展开' : '局部展开' : '记录概览'} · {scope.nodes.length}/{scope.total} 节点 · {scope.edges.filter(e => e.kind !== 'contains').length} 关联{expanded.size ? ` · ${scope.edges.filter(e => e.kind === 'contains').length} 包含` : ''}</span>
        {knowledgeUnavailable && graph.recovery?.state !== 'rebuilding' && <span>知识库暂不可用</span>}
        {graph.coverage?.embedding === 'indexing' && <span>{phaseLabel}</span>}
        {graph.coverage?.embedding === 'error' && <span>语义关联暂未补齐</span>}
        {memoryCache && <span>语义缓存：内存</span>}
        <details className='graph-popover'><summary>状态详情{graph.warnings.length ? ` · ${graph.warnings.length} 项提示` : ''}</summary><div className='graph-popover-body'>
          {graph.recovery && <p>{graph.recovery.message}</p>}
          {graph.coverage && <p>文件投影：{graph.coverage.projection} · 语义索引：{graph.coverage.embedding} · 评审覆盖：{graph.coverage.review}（unknown 不表示已经评审）</p>}
          {graph.freshness && <p>目标 head：{(liveStatus?.head ?? graph.freshness.sourceCheckpoint).slice(0, 12)} · 最新完整版本 head：{graph.freshness.indexedCheckpoint ? graph.freshness.indexedCheckpoint.slice(0, 12) : '无'}{sourceEquivalent ? ' · 设计证据相同，沿用已发布图谱' : ''}</p>}
          {graph.coverage?.ontology && <p>本体契约：{graph.coverage.ontology.contractRevision?.slice(0, 20) ?? 'legacy'} · 已实例化 {graph.coverage.ontology.instantiatedTypes}/{graph.coverage.ontology.declaredTypes} 类 · 稳定/结构/匿名身份 {graph.coverage.ontology.stable}/{graph.coverage.ontology.structural}/{graph.coverage.ontology.anonymous} · 未定型 {graph.coverage.ontology.untyped}</p>}
          {graph.knowledgeRevision && <p>图谱版本：{graph.knowledgeRevision}</p>}
          {graph.semantic && <p>{graph.semantic.model} · {graph.semantic.message}</p>}
          {memoryCache && <p>持久语义缓存不可用，暂用内存计算关联，缓存释放或重启后需重新计算。这不会替换既有 Knowledge / GRA 数据，也不代表知识库已恢复。</p>}
          {graph.warnings.map((w, i) => <p key={i}>{w}</p>)}
          {graph.recovery?.state === 'error' && retry && <button disabled={retrying} onClick={() => { setRetrying(true); void retry().then(() => setReload(n => n + 1)).catch(e => setError(String(e))).finally(() => setRetrying(false)) }}>{retrying ? '正在重试…' : '重试恢复图谱'}</button>}
        </div></details>
        <details className='graph-popover'><summary>来源与图例</summary><div className='graph-popover-body'>
          <div className='graph-legend'><span><i/>关联</span><span><i data-kind='contains'/>包含</span><span><i data-kind='candidate'/>候选关系</span></div>
          <div className='graph-legend'>{Object.entries(sourceLabels).map(([owner, label], index) => <span key={owner}><i style={{ border: 0, width: 7, height: 7, borderRadius: '50%', background: graphSourceColors[index % graphSourceColors.length] }} />{label}</span>)}</div>
          <p>{exploration ? '颜色区分 Bundle 来源；外圈可聚合或展开，点的层次区分 Bundle、记录和内容，不代表可信度或重要程度。' : '颜色区分 Bundle 来源；底色显示附近节点的来源分布。默认使用细小节点，选择“按关联范围”后，点大小表示关联的不同记录数（含候选，排除包含和重复证据），不代表可信度或重要程度。'}</p>
          <p>语义候选、标识符匹配不是已确认业务关系。点击连线查看原始依据。布局与筛选不会修改 KAG。</p>
          <p>关系含义与生成来源分别筛选；未知含义不作推断。详情中的方向表示关系含义，不是布局位置。</p>
          <p>{exploration ? '拖空白平移 · 滚轮缩放 · 两种视觉方向均为二维呈现，切换保留当前选择。' : spatial ? '拖空白旋转 · 右键平移 · 滚轮缩放 · 拖动节点后固定。' : '拖空白平移 · 滚轮缩放 · 重新整理恢复 Stress 排布。空间邻近不代表业务确认。'}</p><p>支持键盘选点，Escape 关闭详情。已发布版本 {graph.checkpoint.slice(0, 8)}。</p>
        </div></details>
      </div>
    </>}
    <footer className='graph-footer'>{footer}</footer>
  </section>
}

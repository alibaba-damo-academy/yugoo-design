import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePanelI18n } from '../panel-i18n.js'
import { PanelContentGroup, PanelHelp, PanelRecordHeader } from '../panel-workspace.js'
import { RecordFacts } from '../record-facts.js'
import { Button } from './ported/ui/button.js'
import { contentDetail, edgeReading, relationDirectionLabel, relationDisplayLabel, relationLifecycleLabel, relationMeaningLabel, relationOriginLabel, type DesignGraph, type GraphEdge, type GraphNode, type RelationReading } from './graph-model.js'

/** Read-only graph details compose the ordinary Panel reading foundation.
 * Canvas selection, expansion and navigation remain owned by GraphPanel. */
function Facts({ values }: { values: readonly (readonly [string, string | undefined])[] }) {
  return <RecordFacts inline fields={values.map(([label], index) => ({ key: String(index), label, control: 'text' as const }))}
    value={Object.fromEntries(values.map(([, value], index) => [String(index), value]))}
    rows={values.map((_, index) => [String(index)])} />
}
function Group({ title, defaultOpen = true, className = '', children }: { title: ReactNode; defaultOpen?: boolean; className?: string; children: ReactNode }) {
  return <PanelContentGroup title={title} defaultOpen={defaultOpen} className={className}>
    <div className='dsh-design-form-group-content dsh-design-structured-list'>{children}</div>
  </PanelContentGroup>
}
function Reading({ reading, showMeaning = false }: { reading: RelationReading; showMeaning?: boolean }) {
  const { locale, t } = usePanelI18n()
  const hints = [
    (reading.origin === 'unknown' || reading.lifecycle === 'unknown') ? t('knowledgeGraphUnknownEvidenceHint') : '',
    reading.meaning === 'similar' ? t('knowledgeGraphSimilarityHint') : '',
    reading.origin === 'agent' ? t('knowledgeGraphAgentHint') : '',
  ].filter(Boolean)
  return <div className='dsh-design-record-header-label'>
    <span className='dsh-panel-header-meta'>{showMeaning ? `${relationMeaningLabel(reading.meaning, locale)} · ` : ''}{relationLifecycleLabel(reading.lifecycle, locale)}{reading.origin === 'unknown' ? ` · ${relationOriginLabel(reading.origin, locale)}` : ''}</span>
    {!!hints.length && <PanelHelp label={t('knowledgeGraphInterpretationHelp')}>{hints.join('\n\n')}</PanelHelp>}
  </div>
}
/** Human explanations can be read as prose. Structured provenance remains a
 * diagnostic, not a paragraph of JSON masquerading as a business explanation. */
function Evidence({ raw, label }: { raw: string; label: string }) {
  let prose: string | undefined, quotes: string[] = []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      // review-v1 owns actual written reasoning and exact saved field quotes.
      // Technical provenance and embedding scores do not become explanations.
      if ('projection' in parsed && parsed.projection === 'review-v1') {
        if ('summary' in parsed && typeof parsed.summary === 'string') prose = parsed.summary
        if ('quotes' in parsed && Array.isArray(parsed.quotes)) quotes = parsed.quotes.flatMap(quote =>
          quote && typeof quote === 'object' && typeof quote.quote === 'string' ? [quote.quote] : [])
      } else if ('evidence' in parsed && typeof parsed.evidence === 'string') {
        try { JSON.parse(parsed.evidence) } catch { if (!/^\s*[\[{]/u.test(parsed.evidence)) prose = parsed.evidence }
      }
    }
  } catch { if (!/^\s*[\[{]/u.test(raw)) prose = raw }
  return <>{prose && prose !== label && <div className='dsh-panel-reading-item'>{prose}</div>}
    {!!quotes.length && <div className='dsh-panel-reading-list'>{quotes.map((quote, index) => <blockquote className='dsh-panel-reading-item' key={index}>{quote}</blockquote>)}</div>}</>
}
function Endpoints({ graph, from, to, direction, nodeLabel }: { nodeLabel?: (node: GraphNode) => string; graph: DesignGraph; from: string; to: string; direction: string }) {
  const { t } = usePanelI18n()
  const text = (id: string) => {
    const node = graph.nodes.find(candidate => candidate.id === id)
    if (!node) return id
    // A scalar's published excerpt has its exact pointer followed by its value.
    // Read that value instead of the shortened canvas label. Object excerpts
    // start with descendant pointers and keep their existing record label.
    const prefix = `${node.pointer}: `
    const label = nodeLabel?.(node) ?? node.label
    return node.context.startsWith(prefix) ? node.context.slice(prefix.length) || label : label
  }
  return <div className='dsh-panel-reading-item'><Facts values={[
    [t(direction === 'forward' ? 'knowledgeGraphFrom' : 'knowledgeGraphEndpointOne'), text(from)],
    [t(direction === 'forward' ? 'knowledgeGraphTo' : 'knowledgeGraphEndpointTwo'), text(to)],
  ]} /></div>
}

export function GraphInspector(props: {
  nodeLabel?: (node: GraphNode) => string; graph: DesignGraph; node?: GraphNode; edge?: GraphEdge; relations: GraphEdge[]; sourceLabels: Record<string, string>
  recordAction?: { expanded: boolean; count: number; toggle: () => void }
  onClose: () => void; onNode: (id: string) => void; onEdge: (edge: GraphEdge) => void
  onNeighborhood: () => void; onExpandEndpoints: () => void
}) {
  const { locale, t } = usePanelI18n()
  const { graph, node, edge, recordAction } = props
  const label = props.nodeLabel ?? ((node: GraphNode) => node.label)
  const detail = node ? contentDetail(graph, node, locale) : undefined
  const members = edge ? edge.members?.length ? edge.members : [edge] : []
  const readings = members.map(edgeReading)
  // Only shared facts are lifted out of the original relationships. A mixed
  // aggregate must retain each member's own meaning, origin and lifecycle.
  const common = readings[0] && readings.every(reading =>
    (['relationType', 'meaning', 'origin', 'direction', 'lifecycle'] as const).every(key => reading[key] === readings[0][key])) ? readings[0] : undefined
  const related = node ? props.relations.filter(relation => relation.from === node.id || relation.to === node.id) : []
  return <>
    <PanelRecordHeader variant='detail' titleRole='record' context={node ? `${detail?.kind} · ${props.sourceLabels[node.owner] ?? node.owner}` : t('knowledgeGraphRelationEvidence')}>
      <h4 className='dsh-panel-header-heading'>{(node ? label(node) : undefined) ?? (edge ? common?.origin === 'embedding' ? members.length > 1 ? t('knowledgeGraphOriginalRelations', { meaning: relationMeaningLabel(common.meaning, locale), count: members.length }) : relationMeaningLabel(common.meaning, locale) : relationDisplayLabel(edge, locale) : '')}</h4>
      <Button variant='ghostIcon' size='icon' aria-label={t('knowledgeGraphCloseDetails')} onClick={props.onClose}><X size={16} aria-hidden='true' /></Button>
    </PanelRecordHeader>
    <div className='graph-inspector-body dsh-design-structured-list'>
      {node ? <>
        {node.sourceLabel && node.sourceLabel !== node.label && <p className='dsh-design-form-group-description'>{t('knowledgeGraphSourceSummary', { label: node.sourceLabel })}</p>}
        {detail?.source && detail.source.id !== node.id && <p className='dsh-design-form-group-description'>{t('knowledgeGraphSourceLabel', { label: label(detail.source) })}</p>}
        <div className='graph-inspector-actions'>
          {recordAction && <Button variant='outline' size='sm' aria-label={t(recordAction.expanded ? 'knowledgeGraphCollapseRecord' : 'knowledgeGraphExpandRecord')} onClick={recordAction.toggle}>{t('knowledgeGraphRecordUnits', { action: t(recordAction.expanded ? 'knowledgeGraphCollapseRecord' : 'knowledgeGraphExpandRecord'), count: recordAction.count })}</Button>}
          <Button variant='outline' size='sm' onClick={props.onNeighborhood}>{t('knowledgeGraphNeighborhood')}</Button>
        </div>
        <Group title={<>{t('knowledgeGraphVisibleCount', { count: related.length })}<PanelHelp label={t('knowledgeGraphVisibleRelations')}>{t('knowledgeGraphVisibleHint')}</PanelHelp></>}>
          <div className='dsh-panel-reading-list'>{related.map(relation => {
            const other = relation.from === node.id ? relation.to : relation.from
            const otherNode = graph.nodes.find(candidate => candidate.id === other)
            return <button className='dsh-panel-reading-item' key={relation.id} onClick={() => props.onEdge(relation)}>
              <span className='dsh-design-field-value'>{otherNode ? label(otherNode) : other}</span>
              <span className='dsh-panel-header-context'>{relationDisplayLabel(relation, locale)} · {relationOriginLabel(edgeReading(relation).origin, locale)}</span>
            </button>
          })}</div>
        </Group>
        {!!detail?.children.length && <Group title={t('knowledgeGraphUnitCount', { count: detail.children.length })}>
          <div className='dsh-panel-reading-list'>{detail.children.map(child => <button className='dsh-panel-reading-item' key={child.id} onClick={() => props.onNode(child.id)}>{label(child)}</button>)}</div>
        </Group>}
        <Group title={<>{t('knowledgeGraphExcerpt')}<PanelHelp label={t('knowledgeGraphExcerpt')}>{t('knowledgeGraphExcerptHint')}</PanelHelp></>} defaultOpen={node.contentKind !== 'container'} className='graph-evidence'>
          <div className='dsh-source-reference'><pre className='dsh-panel-reading-item'>{node.context}</pre></div>
        </Group>
        <Group title={t('knowledgeGraphNodeSource')} defaultOpen={false} className='graph-node-source'>
          <Facts values={[
            [t('knowledgeGraphPanel'), node.sourcePanel ?? node.previewSourcePanel ?? node.owner],
            [t('knowledgeGraphDesignFile'), node.file], [t('knowledgeGraphFilePosition'), node.pointer || '/'],
            [t('knowledgeGraphStructuralType'), node.ontologyType],
            [t('knowledgeGraphIdentity'), node.identityQuality ? t(node.identityQuality === 'stable' ? 'knowledgeGraphStableIdentity' : node.identityQuality === 'structural' ? 'knowledgeGraphStructuralIdentity' : 'knowledgeGraphAnonymousIdentity') : undefined],
          ]} />
          <p className='dsh-design-form-group-description'>{t('knowledgeGraphTypeHint')}</p>
        </Group>
      </> : edge ? <>
        <div className='graph-inspector-actions'><Button variant='outline' size='sm' onClick={props.onExpandEndpoints}>{t('knowledgeGraphExpandEndpoints')}</Button></div>
        {common && <Reading reading={common} showMeaning={common.origin !== 'embedding'} />}
        {members.map((member, index) => <Group key={member.id} title={members.length > 1 ? t('knowledgeGraphMember', { count: index + 1 }) : t('knowledgeGraphEndpoints')}
          defaultOpen={!common || index === 0} className='graph-relation-detail'>
          {!common && <><p className='dsh-design-field-value'>{relationMeaningLabel(readings[index].meaning, locale)}</p><Reading reading={readings[index]} /></>}
          <Endpoints nodeLabel={props.nodeLabel} graph={graph} from={member.from} to={member.to} direction={readings[index].direction} />
          {members.length > 1 && readings[index].origin !== 'embedding' && <p className='dsh-design-form-group-description'>{member.label}</p>}
          <Evidence raw={member.evidence} label={member.label} />
        </Group>)}
        <Group title={t('knowledgeGraphTechnicalDetails')} defaultOpen={false}>
          {members.map((member, index) => <Group key={member.id} title={t('knowledgeGraphMember', { count: index + 1 })} defaultOpen={false} className='graph-evidence'>
            <Facts values={[
              [t('knowledgeGraphOriginalLabel'), member.label],
              [t('knowledgeGraphType'), readings[index].relationType],
              [t('knowledgeGraphSource'), relationOriginLabel(readings[index].origin, locale)],
              [t('knowledgeGraphState'), relationLifecycleLabel(readings[index].lifecycle, locale)],
              [t('knowledgeGraphDirection'), relationDirectionLabel(readings[index].direction, locale)],
            ]} />
            <div className='dsh-source-reference'><pre className='dsh-panel-reading-item'>{member.evidence}</pre></div>
          </Group>)}
        </Group>
      </> : null}
    </div>
  </>
}

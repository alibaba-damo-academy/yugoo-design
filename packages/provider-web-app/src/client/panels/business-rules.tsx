import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Scale } from 'lucide-react'
import { Input } from '../ported/ui/input.tsx'
import { Textarea } from '../ported/ui/textarea.tsx'
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx'
import {
  createId,
  DeleteButton,
  DesignPanelAddButton,
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSidebar,
  EditablePanelTitle,
  EmptyPanel,
  ordered,
  Section,
  text,
} from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { isRecord } from '../types.ts'

interface BusinessRule {
  id: string
  title: string
  condition: string
  outcome: string
  notes: string
}

export interface BusinessRulesState {
  skill_name?: string
  schema_version?: 4
  rules?: Record<string, BusinessRule>
  rule_order?: string[]
}

interface BusinessRulesPanelProps {
  draft: unknown
  onChange: (next: BusinessRulesState) => void
  disabled?: boolean
}

function normalizeRule(id: string, value: unknown): BusinessRule | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : id,
    title: text(value.title),
    condition: text(value.condition),
    outcome: text(value.outcome),
    notes: text(value.notes),
  }
}

function normalizeState(draft: unknown): BusinessRulesState {
  if (!isRecord(draft)) return { schema_version: 4, rules: {}, rule_order: [] }
  const rules = isRecord(draft.rules)
    ? Object.fromEntries(Object.entries(draft.rules).flatMap(([id, value]) => {
      const rule = normalizeRule(id, value)
      return rule === null ? [] : [[id, rule]]
    }))
    : {}
  return {
    ...(draft as BusinessRulesState),
    schema_version: 4,
    rules,
    rule_order: Array.isArray(draft.rule_order)
      ? draft.rule_order.filter((id): id is string => typeof id === 'string')
      : Object.keys(rules),
  }
}

/** Native business-rules editor preserving the original ordered catalog semantics. */
export function BusinessRulesPanel({ draft, onChange, disabled = false }: BusinessRulesPanelProps): ReactElement {
  const state = normalizeState(draft)
  const rules = useMemo(() => ordered(state.rules, state.rule_order), [state.rules, state.rule_order])
  const [selectedId, setSelectedId] = useState<string | null>(rules[0]?.id ?? null)
  const pendingRuleId = useRef<string | null>(null)
  const selected = rules.find((item) => item.id === selectedId) ?? rules[0] ?? null

  useEffect(() => {
    if (!selectedId || !rules.some((item) => item.id === selectedId)) setSelectedId(rules[0]?.id ?? null)
  }, [rules, selectedId])

  const emit = (updates: Partial<BusinessRulesState>) => { onChange({ ...state, ...updates, schema_version: 4 }) }
  const update = (updates: Partial<BusinessRule>) => {
    if (!selected) return
    emit({ rules: { ...state.rules, [selected.id]: { ...selected, ...updates } } })
  }
  const add = () => {
    const id = createId('rule')
    emit({
      rules: {
        ...state.rules,
        [id]: { id, title: `新规则 ${rules.length + 1}`, condition: '', outcome: '', notes: '' },
      },
      rule_order: [...rules.map((item) => item.id), id],
    })
    pendingRuleId.current = id
    setSelectedId(id)
  }
  const remove = () => {
    if (!selected) return
    const next = { ...state.rules }
    delete next[selected.id]
    const order = rules.map((item) => item.id).filter((id) => id !== selected.id)
    emit({ rules: next, rule_order: order })
    setSelectedId(order[0] ?? null)
  }

  return (
    <NativeDesignPanelFrame autoSaveId='business-rules-panel-sidebar'>
      <DesignPanelSidebar icon={<Scale className='size-4 text-[var(--ds-text-7)]' />} title='规则' ariaLabel='业务规则'>
        {rules.map((rule) => (
          <DesignPanelNavItem
            key={rule.id}
            aria-label={`切换到业务规则${rule.title}`}
            selected={selected?.id === rule.id}
            onClick={() => { setSelectedId(rule.id) }}
          >
            <strong className='block truncate'>{rule.title}</strong>
          </DesignPanelNavItem>
        ))}
        <DesignPanelAddButton disabled={disabled} onClick={add}>添加规则</DesignPanelAddButton>
      </DesignPanelSidebar>

      <NativeDesignPanelContent mode='scroll'>
        {!selected ? (
          <EmptyPanel message='还没有业务规则。先添加一条，说明在什么情况下产品应该怎样处理。' />
        ) : (
          <>
            <DesignPanelHeader>
              <EditablePanelTitle
                autoFocus={pendingRuleId.current === selected.id}
                aria-label='当前规则名称'
                className='max-w-xl'
                value={selected.title}
                disabled={disabled}
                onFocus={() => { if (pendingRuleId.current === selected.id) pendingRuleId.current = null }}
                onChange={(event) => { update({ title: event.target.value }) }}
              />
              <DeleteButton label={`删除规则${selected.title}`} disabled={disabled} onClick={remove} />
            </DesignPanelHeader>

            <Section title='规则内容' description='先写触发条件或计算依据，再写产品应当如何判断、计算或处理。没有前提时，第一项可以留空。'>
              <div className='max-w-3xl space-y-4'>
                <label className='block text-sm'>
                  <span className='font-medium text-[var(--ds-text-primary)]'>在什么情况下，或根据什么信息？（可选）</span>
                  <Textarea
                    aria-label='规则条件或依据'
                    className='mt-1.5 min-h-24 resize-y'
                    value={selected.condition}
                    disabled={disabled}
                    placeholder='例如：订单含税总额超过 100,000 元；或：根据商品单价、数量和折扣'
                    onChange={(event) => { update({ condition: event.target.value }) }}
                  />
                </label>
                <label className='block text-sm'>
                  <span className='font-medium text-[var(--ds-text-primary)]'>产品应该怎样判断、计算或处理？</span>
                  <Textarea
                    aria-label='规则处理结果'
                    className='mt-1.5 min-h-24 resize-y'
                    value={selected.outcome}
                    disabled={disabled}
                    placeholder='例如：进入经理审批；或：订单金额等于各商品金额之和减去折扣'
                    onChange={(event) => { update({ outcome: event.target.value }) }}
                  />
                </label>
              </div>
            </Section>
            <Section title='备注（可选）' description='补充临界值、特殊情况或一个帮助理解的例子；没有补充内容时可以留空。'>
              <Textarea
                aria-label='规则备注'
                className='min-h-28 max-w-3xl resize-y'
                value={selected.notes}
                disabled={disabled}
                placeholder='例如：金额等于 100,000 元时不进入经理审批。'
                onChange={(event) => { update({ notes: event.target.value }) }}
              />
            </Section>
          </>
        )}
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  )
}

export default BusinessRulesPanel

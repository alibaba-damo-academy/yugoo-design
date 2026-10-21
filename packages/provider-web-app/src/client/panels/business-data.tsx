import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, Database, Plus, X } from 'lucide-react'
import { IconButton } from '../ported/ui/icon-button.tsx'
import { Button } from '../ported/ui/button.tsx'
import { Input } from '../ported/ui/input.tsx'
import { Textarea } from '../ported/ui/textarea.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ported/ui/tabs.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ported/ui/dialog.tsx'
import { cn } from '../ported/ui/cn.ts'
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx'
import {
  createId,
  DeleteButton,
  DesignPanelAddButton,
  DesignPanelField,
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSelect,
  DesignPanelSidebar,
  EditablePanelTitle,
  EmptyPanel,
  Section,
  ordered,
} from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { isRecord } from '../types.ts'
import { BusinessObjectCanvas } from './business-object-canvas.tsx'
import { BusinessRelationEditor } from './business-relation-editor.tsx'
import { businessRelationIssue, businessTreeRoots, type BusinessRelation } from './business-relations.ts'

type ValueType = 'text' | 'long_text' | 'number' | 'amount' | 'date' | 'date_time' | 'single_choice' | 'multiple_choice' | 'yes_no' | 'file' | 'other'
type Requirement = 'optional' | 'always' | 'conditional'

interface BusinessField {
  id: string
  name: string
  meaning: string
  value_type: ValueType
  requirement: Requirement
  required_when: string
  example: string
  options: string[]
}

interface BusinessState {
  id: string
  name: string
  meaning: string
}

interface BusinessObject {
  id: string
  name: string
  description: string
  fields: Record<string, BusinessField>
  field_order: string[]
  states: Record<string, BusinessState>
  state_order: string[]
}

export interface BusinessDataState {
  skill_name?: string
  schema_version?: 3
  objects?: Record<string, BusinessObject>
  object_order?: string[]
  relations?: Record<string, BusinessRelation>
}

interface BusinessDataPanelProps {
  draft: unknown
  onChange: (next: BusinessDataState) => void
  disabled?: boolean
}

const VALUE_TYPES = [
  ['text', '简短文字'], ['long_text', '较长内容'], ['number', '数字'], ['amount', '金额'],
  ['date', '日期'], ['date_time', '日期和时间'], ['single_choice', '单选'], ['multiple_choice', '多选'],
  ['yes_no', '是或否'], ['file', '文件'], ['other', '其他'],
] as const

const REQUIREMENTS = [
  ['optional', '可以不填'], ['always', '始终必填'], ['conditional', '满足条件时必填'],
] as const

const choiceTypes = new Set<ValueType>(['single_choice', 'multiple_choice'])

/** Stable empties so a draft without objects or relations does not re-create memo inputs. */
const EMPTY_OBJECTS: Record<string, BusinessObject> = {}
const EMPTY_RELATIONS: Record<string, BusinessRelation> = {}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function valueType(value: unknown): ValueType {
  return VALUE_TYPES.some(([candidate]) => candidate === value) ? value as ValueType : 'text'
}

function requirement(value: unknown): Requirement {
  return REQUIREMENTS.some(([candidate]) => candidate === value) ? value as Requirement : 'optional'
}

function normalizeField(id: string, value: unknown): BusinessField | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : id,
    name: typeof value.name === 'string' ? value.name : '',
    meaning: typeof value.meaning === 'string' ? value.meaning : '',
    value_type: valueType(value.value_type),
    requirement: requirement(value.requirement),
    required_when: typeof value.required_when === 'string' ? value.required_when : '',
    example: typeof value.example === 'string' ? value.example : '',
    options: strings(value.options),
  }
}

function normalizeBusinessState(id: string, value: unknown): BusinessState | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : id,
    name: typeof value.name === 'string' ? value.name : '',
    meaning: typeof value.meaning === 'string' ? value.meaning : '',
  }
}

function normalizeObject(id: string, value: unknown): BusinessObject | null {
  if (!isRecord(value)) return null
  const fields = isRecord(value.fields)
    ? Object.fromEntries(Object.entries(value.fields).flatMap(([key, entry]) => {
      const field = normalizeField(key, entry)
      return field === null ? [] : [[key, field]]
    }))
    : {}
  const states = isRecord(value.states)
    ? Object.fromEntries(Object.entries(value.states).flatMap(([key, entry]) => {
      const state = normalizeBusinessState(key, entry)
      return state === null ? [] : [[key, state]]
    }))
    : {}
  return {
    id: typeof value.id === 'string' ? value.id : id,
    name: typeof value.name === 'string' ? value.name : '',
    description: typeof value.description === 'string' ? value.description : '',
    fields,
    field_order: Array.isArray(value.field_order) ? strings(value.field_order) : Object.keys(fields),
    states,
    state_order: Array.isArray(value.state_order) ? strings(value.state_order) : Object.keys(states),
  }
}

function normalizeState(draft: unknown): BusinessDataState {
  if (!isRecord(draft)) return { schema_version: 3, objects: {}, object_order: [] }
  const objects = isRecord(draft.objects)
    ? Object.fromEntries(Object.entries(draft.objects).flatMap(([id, value]) => {
      const object = normalizeObject(id, value)
      return object === null ? [] : [[id, object]]
    }))
    : {}
  return {
    ...(draft as BusinessDataState),
    schema_version: 3,
    objects,
    object_order: Array.isArray(draft.object_order) ? strings(draft.object_order) : Object.keys(objects),
  }
}

function move(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target] as string, next[index] as string]
  return next
}

function ChoiceEditor({ values, disabled, onChange }: { values: string[]; disabled: boolean; onChange: (values: string[]) => void }): ReactElement {
  const [draft, setDraft] = useState('')
  const addChoice = () => {
    const value = draft.trim()
    if (!value || values.includes(value)) return
    onChange([...values, value])
    setDraft('')
  }
  return (
    <div className='space-y-2'>
      {values.length ? (
        <div className='flex flex-wrap gap-2'>
          {values.map((value) => (
            <span key={value} className='inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-sm'>
              {value}
              <button type='button' aria-label={`删除选项${value}`} className='focus-brand-ring rounded-full p-0.5 hover:bg-[hsl(var(--hover))]' disabled={disabled} onClick={() => { onChange(values.filter((item) => item !== value)) }}>
                <X className='size-3.5' />
              </button>
            </span>
          ))}
        </div>
      ) : <p className='text-sm text-[var(--ds-text-secondary)]'>还没有选项。添加用户实际会看到的选择。</p>}
      <div className='flex max-w-md gap-2'>
        <Input value={draft} disabled={disabled} aria-label='新选项' placeholder='例如：高' onChange={(event) => { setDraft(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addChoice() } }} />
        <Button type='button' variant='outline' disabled={disabled || !draft.trim()} onClick={addChoice}>添加</Button>
      </div>
    </div>
  )
}

/** Native business-data editor preserving ordered object, field, and state identities. */
export function BusinessDataPanel({ draft, onChange, disabled = false }: BusinessDataPanelProps): ReactElement {
  const state = useMemo(() => normalizeState(draft), [draft])
  const objectRecords = state.objects ?? EMPTY_OBJECTS
  const objects = useMemo(() => ordered(objectRecords, state.object_order), [objectRecords, state.object_order])
  const [selectedId, setSelectedId] = useState<string | null>(objects[0]?.id ?? null)
  const pendingObjectId = useRef<string | null>(null)
  const [activeArea, setActiveArea] = useState('fields')
  const selected = objects.find((item) => item.id === selectedId) ?? objects[0] ?? null
  const fields = useMemo(() => selected ? ordered(selected.fields, selected.field_order) : [], [selected])
  const states = useMemo(() => selected ? ordered(selected.states, selected.state_order) : [], [selected])
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(fields[0]?.id ?? null)
  const selectedField = fields.find((item) => item.id === selectedFieldId) ?? null
  const relations = useMemo(
    () => Object.entries(state.relations ?? EMPTY_RELATIONS).sort(([a],[b]) => a.localeCompare(b)).map(([,relation]) => relation),
    [state.relations],
  )
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [relationDraft, setRelationDraft] = useState<BusinessRelation | null>(null)
  const [relationError, setRelationError] = useState<string>()
  const [activeRelationId, setActiveRelationId] = useState<string | null>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const detailTitle = useRef<HTMLInputElement>(null)
  const detailFocus = useRef(false)
  useEffect(() => {
    if (canvasOpen || !detailFocus.current) return
    detailFocus.current = false
    const timer = setTimeout(() => detailTitle.current?.focus(), 300)
    return () => clearTimeout(timer)
  }, [canvasOpen, selectedId])
  const selectObject = (id: string) => {
    setSelectedId(id)
    setSelectedFieldId(objectRecords[id]?.field_order[0] ?? null)
  }
  const revealObject = (id: string) => {
    selectObject(id)
    setCollapsed(previous => {
      const next = new Set(previous), seen = new Set<string>(), pending = [id]
      while (pending.length) {
        const child = pending.pop()!
        if (seen.has(child)) continue
        seen.add(child)
        for (const r of relations) if (r.kind === 'generalization' && r.source === child) {next.delete(r.target);pending.push(r.target)}
      }
      return next
    })
    detailFocus.current = true
    setCanvasOpen(false)
  }

  useEffect(() => {
    if (!selectedId || !objects.some((item) => item.id === selectedId)) setSelectedId(objects[0]?.id ?? null)
  }, [objects, selectedId])
  useEffect(() => {
    if (selectedFieldId !== null && !fields.some((item) => item.id === selectedFieldId)) setSelectedFieldId(fields[0]?.id ?? null)
  }, [fields, selectedFieldId, selected?.id])

  const emit = (updates: Partial<BusinessDataState>) => { onChange({ ...state, ...updates, schema_version: 3 }) }
  const updateRelation = (relation: BusinessRelation) => {
    const issue = businessRelationIssue(relation, relations, objects.map(o => o.id), false)
    setRelationError(issue)
    if (!issue && !disabled) emit({relations:{...state.relations, [relation.id]:relation}})
  }
  const removeRelation = (id: string) => {
    if (disabled) return
    const next = {...state.relations};delete next[id]
    emit({relations:next});setRelationError(undefined)
  }
  const addRelation = (source?: string, target?: string) => {
    if (disabled) return
    setRelationError(undefined)
    setRelationDraft({id:createId('relation'),kind:'association',name:'关联',source:source ?? selected?.id ?? objects[0]?.id ?? '',target:target ?? ''})
  }
  const saveRelation = () => {
    if (!relationDraft || disabled) return
    const issue = businessRelationIssue(relationDraft, relations, objects.map(o => o.id))
    setRelationError(issue)
    if (issue) return
    emit({relations:{...state.relations, [relationDraft.id]:relationDraft}})
    setActiveRelationId(relationDraft.id);setRelationDraft(null)
  }
  const cancelRelationDraft = () => {setRelationDraft(null); setRelationError(undefined)}
  const updateObject = (updates: Partial<BusinessObject>) => {
    if (!selected) return
    emit({ objects: { ...objectRecords, [selected.id]: { ...selected, ...updates } } })
  }
  const addObject = () => {
    const id = createId('business')
    const fieldId = createId('field')
    emit({
      objects: {
        ...objectRecords,
        [id]: {
          id, name: `新业务对象 ${objects.length + 1}`, description: '',
          fields: { [fieldId]: { id: fieldId, name: '名称', meaning: '帮助用户识别这条记录。', value_type: 'text', requirement: 'always', required_when: '', example: '', options: [] } },
          field_order: [fieldId], states: {}, state_order: [],
        },
      },
      object_order: [...objects.map((item) => item.id), id],
    })
    pendingObjectId.current = id
    setSelectedId(id)
    setSelectedFieldId(fieldId)
    setActiveArea('fields')
  }
  const removeObject = () => {
    if (!selected) return
    const next = { ...objectRecords }
    delete next[selected.id]
    const order = objects.map((item) => item.id).filter((id) => id !== selected.id)
    emit({ objects: next, object_order: order, ...(state.relations === undefined ? {} : {relations:Object.fromEntries(relations.filter(r => r.source !== selected.id && r.target !== selected.id).map(r => [r.id,r]))}) })
    setSelectedId(order[0] ?? null)
  }
  const updateField = (field: BusinessField, updates: Partial<BusinessField>) => {
    if (!selected) return
    updateObject({ fields: { ...selected.fields, [field.id]: { ...field, ...updates } } })
  }
  const addField = () => {
    if (!selected) return
    const id = createId('field')
    updateObject({
      fields: { ...selected.fields, [id]: { id, name: `新信息 ${fields.length + 1}`, meaning: '', value_type: 'text', requirement: 'optional', required_when: '', example: '', options: [] } },
      field_order: [...fields.map((item) => item.id), id],
    })
    setSelectedFieldId(id)
  }
  const removeField = (id: string) => {
    if (!selected) return
    const next = { ...selected.fields }
    delete next[id]
    const order = fields.map((item) => item.id).filter((fieldId) => fieldId !== id)
    updateObject({ fields: next, field_order: order })
    setSelectedFieldId(order[0] ?? null)
  }
  const addState = () => {
    if (!selected) return
    const id = createId('state')
    updateObject({ states: { ...selected.states, [id]: { id, name: states.length ? `新状态 ${states.length + 1}` : '新建', meaning: '' } }, state_order: [...states.map((item) => item.id), id] })
  }
  const updateState = (item: BusinessState, updates: Partial<BusinessState>) => {
    if (!selected) return
    updateObject({ states: { ...selected.states, [item.id]: { ...item, ...updates } } })
  }
  const removeState = (id: string) => {
    if (!selected) return
    const next = { ...selected.states }
    delete next[id]
    updateObject({ states: next, state_order: states.map((item) => item.id).filter((stateId) => stateId !== id) })
  }

  const renderBranch = (id: string, ancestors: readonly string[] = []): ReactElement | null => {
    if (ancestors.includes(id) || !objectRecords[id]) return null
    const item = objectRecords[id]!
    const children = objects.filter(o => !ancestors.includes(o.id) && relations.some(r => r.kind === 'generalization' && r.source === o.id && r.target === id))
    const open = !collapsed.has(id)
    return <div key={id}>
      <div className='flex items-center gap-0.5'>
        {children.length ? <IconButton type='button' size='sm' variant='transparent' shape='square' aria-label={`${open ? '折叠' : '展开'}${item.name}的子类型`} aria-expanded={open} className='h-8 w-5 shrink-0 text-[var(--ds-text-tertiary)]'
          onClick={() => setCollapsed(previous => {const next = new Set(previous);next.has(id) ? next.delete(id) : next.add(id);return next})}>{open ? <ChevronDown className='size-4'/> : <ChevronRight className='size-4'/>}</IconButton> : <span className='w-5 shrink-0'/>}
        <DesignPanelNavItem aria-label={`切换到业务对象${item.name}`} selected={id === selected?.id} onClick={() => selectObject(id)}><span className='block truncate font-medium text-[var(--ds-text-primary)]'>{item.name || '未命名对象'}</span></DesignPanelNavItem>
      </div>
      {open && children.length > 0 && <div className='ml-2.5 pl-3'>{children.map(child => renderBranch(child.id,[...ancestors,id]))}</div>}
    </div>
  }

  return (
    <NativeDesignPanelFrame autoSaveId='business-data-panel-sidebar' overlay={<BusinessObjectCanvas open={canvasOpen} objects={objects} relations={relations} selectedId={selectedId} disabled={disabled} error={relationError}
      draft={relationDraft} onClose={() => {setCanvasOpen(false);setTimeout(() => expandButton.current?.focus(),300)}} onDetail={revealObject} onAdd={addRelation} onChange={updateRelation} onRemove={removeRelation}
      onDraftChange={setRelationDraft} onDraftSave={saveRelation} onDraftCancel={cancelRelationDraft}/> }>
      <div className='relative h-full min-h-0' style={{visibility:canvasOpen?'hidden':undefined}} {...(canvasOpen ? {inert:''} : {})}>
      <DesignPanelSidebar icon={<Database className='size-4 text-[var(--ds-text-7)]' />} title='业务对象'>
        {businessTreeRoots(objects.map(o => o.id),relations).map(id => renderBranch(id))}
        <DesignPanelAddButton disabled={disabled} onClick={addObject}>添加业务对象</DesignPanelAddButton>
      </DesignPanelSidebar>
      <IconButton ref={expandButton} type='button' size='lg' variant='transparent' shape='square' aria-label='展开业务对象关系画布' className='absolute right-0 top-[36vh] z-10 h-[48px] w-[24px] -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white shadow-[-1px_1px_4px_0px_rgba(0,0,0,0.1)] text-[var(--ds-text-tertiary)] hover:text-[var(--ds-brand-text-primary)] hover:!bg-[#f6f6f6]' onClick={() => setCanvasOpen(true)}><ChevronRight className='size-4'/></IconButton>
      </div>

      <NativeDesignPanelContent mode='scroll' style={{visibility:canvasOpen?'hidden':undefined}} {...(canvasOpen ? {inert:''} : {})}>
        {!selected ? <EmptyPanel message='添加产品需要长期保存和管理的第一个业务对象。' /> : (
          <div className='min-h-full'>
            <DesignPanelHeader>
              <EditablePanelTitle ref={detailTitle} autoFocus={pendingObjectId.current === selected.id} aria-label='当前业务对象名称' className='max-w-xs' value={selected.name} disabled={disabled} placeholder='例如：订单' onBlur={() => { pendingObjectId.current = null }} onChange={(event) => { pendingObjectId.current = null; updateObject({ name: event.target.value }) }} />
              <Dialog>
                <DialogTrigger asChild>
                  <DeleteButton label={`删除对象${selected.name}`} disabled={disabled} />
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>删除“{selected.name}”？</DialogTitle>
                    <DialogDescription>其中的信息、状态及连接到该对象的关系会一并删除，此操作不能在面板内撤销。</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button type='button' variant='outline'>取消</Button></DialogClose>
                    <DialogClose asChild><Button type='button' variant='destructive' onClick={removeObject}>确认删除</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </DesignPanelHeader>

            <Section title='这个对象是什么？' description='用一句业务里的普通话说明它，不需要描述数据库或页面。'>
              <Textarea aria-label='这个对象是什么？' className='mt-3 min-h-20 max-w-3xl resize-y' value={selected.description} disabled={disabled} placeholder='例如：客户已经确认购买的一组商品，以及约定的价格和交付要求。' onChange={(event) => { updateObject({ description: event.target.value }) }} />
            </Section>

            {relations.some(r => r.kind==='generalization' && r.source===selected.id) && <div className='border-b border-border px-4 py-3 text-sm text-[var(--ds-text-secondary)]'>
              沿用父类型的定义与信息：
              {relations.filter(r => r.kind==='generalization' && r.source===selected.id).map(r => <Button key={r.id} type='button' variant='link' size='sm' onClick={() => revealObject(r.target)}>{objectRecords[r.target]?.name ?? '对象已不存在'}</Button>)}
              <p className='mt-1'>下方仅维护本类型自己的信息；共享信息在父类型原处修改。</p>
            </div>}
            <Tabs value={activeArea} onValueChange={setActiveArea} className='p-4'>
              <TabsList aria-label='业务对象设计内容'>
                <TabsTrigger value='fields'>记录的信息 {fields.length}</TabsTrigger>
                <TabsTrigger value='states'>业务状态 {states.length || ''}</TabsTrigger>
                <TabsTrigger value='relations'>对象关系 {relations.filter(r => r.source===selected.id || r.target===selected.id).length || ''}</TabsTrigger>
              </TabsList>

              <TabsContent value='fields' className='mt-4'>
                <div className='flex items-start justify-between gap-4'>
                  <div><h3 className='text-sm font-semibold'>这个对象需要记录什么？</h3><p className='mt-1 text-sm text-[var(--ds-text-secondary)]'>每一项都是用户需要查看、填写或搜索的信息。点击即可展开修改。</p></div>
                  <Button type='button' size='sm' variant='outline' className='!text-sm' disabled={disabled} onClick={addField}><Plus className='mr-1 size-4' />添加信息</Button>
                </div>
                {fields.length ? (
                  <div className='mt-3 space-y-2'>
                    {fields.map((field, index) => {
                      const active = field.id === selectedField?.id
                      const typeLabel = VALUE_TYPES.find(([value]) => value === field.value_type)?.[1] ?? '其他'
                      const requirementLabel = REQUIREMENTS.find(([value]) => value === field.requirement)?.[1] ?? '可以不填'
                      return (
                        <article key={field.id} className='overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background'>
                          <header className={cn('flex min-h-12 items-center border-b border-transparent bg-[var(--ds-bg-gary-default)]', active && 'border-border')}>
                            <button type='button' className='focus-brand-ring flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left' aria-expanded={active} aria-label={`${active ? '收起' : '展开'}${field.name || '未命名信息'}`} onClick={() => { setSelectedFieldId(active ? null : field.id) }}>
                              {active ? <ChevronUp className='size-4 shrink-0 text-[var(--ds-text-secondary)]' /> : <ChevronDown className='size-4 shrink-0 text-[var(--ds-text-secondary)]' />}
                              <span className='min-w-0 flex-1'><span className='block truncate font-medium text-[var(--ds-text-primary)]'>{field.name || '未命名信息'}</span><span className='mt-0.5 block truncate text-sm text-[var(--ds-text-secondary)]'>{field.meaning || '点击补充这项信息的含义'}</span></span>
                              <span className='hidden shrink-0 text-sm text-[var(--ds-text-secondary)] sm:inline'>{typeLabel} · {requirementLabel}</span>
                            </button>
                            <div className='flex shrink-0 gap-0.5 pr-2'>
                              <Button type='button' size='icon' variant='ghost' aria-label={`上移${field.name}`} disabled={disabled || index === 0} onClick={() => { updateObject({ field_order: move(fields.map((item) => item.id), field.id, -1) }) }}><ArrowUp className='size-4' /></Button>
                              <Button type='button' size='icon' variant='ghost' aria-label={`下移${field.name}`} disabled={disabled || index === fields.length - 1} onClick={() => { updateObject({ field_order: move(fields.map((item) => item.id), field.id, 1) }) }}><ArrowDown className='size-4' /></Button>
                              <DeleteButton label={`删除${field.name}`} disabled={disabled} onClick={() => { removeField(field.id) }} />
                            </div>
                          </header>
                          {active ? (
                            <div className='p-3'>
                              <div className='grid gap-3 md:grid-cols-2'>
                                <DesignPanelField label='信息名称'><Input value={field.name} disabled={disabled} onChange={(event) => { updateField(field, { name: event.target.value }) }} /></DesignPanelField>
                                <DesignPanelField label='用户怎样填写或看到它？'>
                                  <DesignPanelSelect value={field.value_type} disabled={disabled} onChange={(event) => { const nextType = event.target.value as ValueType; updateField(field, { value_type: nextType, options: choiceTypes.has(nextType) ? field.options : [] }) }}>
                                    {VALUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                  </DesignPanelSelect>
                                </DesignPanelField>
                              </div>
                              <div className='mt-3'><DesignPanelField label='这项信息表示什么？' hint='说明用户为什么需要它'><Textarea value={field.meaning} disabled={disabled} onChange={(event) => { updateField(field, { meaning: event.target.value }) }} /></DesignPanelField></div>
                              <div className='mt-3'>
                                <p className='font-medium text-[var(--ds-text-primary)]'>什么时候必须填写？</p>
                                <div className='mt-2 flex flex-wrap gap-x-5 gap-y-2'>
                                  {REQUIREMENTS.map(([value, label]) => <label key={value} className='flex cursor-pointer items-center gap-1.5 text-sm'><input type='radio' name={`requirement-${field.id}`} checked={field.requirement === value} disabled={disabled} onChange={() => { updateField(field, { requirement: value, required_when: value === 'conditional' ? field.required_when : '' }) }} />{label}</label>)}
                                </div>
                                {field.requirement === 'conditional' ? <Input className='mt-2 max-w-lg' aria-label='必填条件' value={field.required_when} disabled={disabled} placeholder='例如：选择企业客户时' onChange={(event) => { updateField(field, { required_when: event.target.value }) }} /> : null}
                              </div>
                              {choiceTypes.has(field.value_type) ? <div className='mt-3'><p className='font-medium text-[var(--ds-text-primary)]'>用户可以选择什么？</p><div className='mt-2'><ChoiceEditor values={field.options} disabled={disabled} onChange={(options) => { updateField(field, { options }) }} /></div></div> : null}
                              <div className='mt-3 max-w-lg'><DesignPanelField label='示例值（可选）'><Input value={field.example} disabled={disabled} placeholder='填写一个用户实际可能看到的值' onChange={(event) => { updateField(field, { example: event.target.value }) }} /></DesignPanelField></div>
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className='mt-3 rounded-[var(--radius-sm)] border border-dashed border-border px-4 py-8 text-center'><p className='text-sm text-[var(--ds-text-secondary)]'>还没有信息。先添加用户要查看、填写或搜索的第一项。</p><Button type='button' variant='outline' className='mt-3' disabled={disabled} onClick={addField}><Plus className='mr-1 size-4' />添加信息</Button></div>
                )}
              </TabsContent>

              <TabsContent value='states' className='mt-4'>
                <div className='flex items-start justify-between gap-4'>
                  <div><h3 className='text-sm font-semibold'>产品需要区分哪些业务状态？</h3><p className='mt-1 text-sm text-[var(--ds-text-secondary)]'>这里只定义用户会看到的状态名称和含义；状态如何变化仍在业务流程中设计。</p></div>
                  <Button type='button' size='sm' variant='outline' className='!text-sm' disabled={disabled} onClick={addState}><Plus className='mr-1 size-4' />添加状态</Button>
                </div>
                {states.length ? (
                  <div className='mt-3 overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background'>
                    <div className='hidden grid-cols-[150px_minmax(220px,1fr)_108px] gap-3 border-b border-border bg-[var(--ds-bg-gary-default)] px-3 py-2 text-sm font-medium text-[var(--ds-text-secondary)] md:grid'><span>状态名称</span><span>这个状态表示什么</span><span className='text-right'>操作</span></div>
                    {states.map((item, index) => (
                      <div key={item.id} className='grid gap-2 border-b border-border p-3 last:border-b-0 md:grid-cols-[150px_minmax(220px,1fr)_108px] md:items-center md:gap-3'>
                        <Input aria-label={`状态名称：${item.name}`} value={item.name} disabled={disabled} placeholder='例如：待审批' onChange={(event) => { updateState(item, { name: event.target.value }) }} />
                        <Input aria-label={`${item.name}的含义`} value={item.meaning} disabled={disabled} placeholder='例如：已经提交，正在等待审批' onChange={(event) => { updateState(item, { meaning: event.target.value }) }} />
                        <div className='flex justify-end gap-0.5'>
                          <Button type='button' size='icon' variant='ghost' aria-label={`上移${item.name}`} disabled={disabled || index === 0} onClick={() => { updateObject({ state_order: move(states.map((stateItem) => stateItem.id), item.id, -1) }) }}><ArrowUp className='size-4' /></Button>
                          <Button type='button' size='icon' variant='ghost' aria-label={`下移${item.name}`} disabled={disabled || index === states.length - 1} onClick={() => { updateObject({ state_order: move(states.map((stateItem) => stateItem.id), item.id, 1) }) }}><ArrowDown className='size-4' /></Button>
                          <DeleteButton label={`删除${item.name}`} disabled={disabled} onClick={() => { removeState(item.id) }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className='mt-3 rounded-[var(--radius-sm)] border border-dashed border-border px-4 py-8 text-center'><p className='text-sm text-[var(--ds-text-secondary)]'>暂不设计状态也完全可以。只有产品需要据此改变显示或操作时再添加。</p></div>}
              </TabsContent>
              <TabsContent value='relations' className='mt-4'>
                <div className='flex items-start justify-between gap-4'>
                  <div><h3 className='text-sm font-semibold'>这个对象与其他对象是什么关系？</h3><p className='mt-1 text-sm text-[var(--ds-text-secondary)]'>继承表达“是一种”；关联表达引用、包含等业务含义。数量可以暂不确定。</p></div>
                  <Button type='button' size='sm' variant='outline' disabled={disabled} onClick={() => {addRelation(selected.id); setCanvasOpen(true)}}>添加关系</Button>
                </div>
                {relationError && <p role='alert' className='mt-3 text-sm text-destructive'>{relationError}</p>}
                <div className='mt-3 space-y-2'>
                  {relations.filter(r => r.source===selected.id || r.target===selected.id).map(r => <article key={r.id} className='overflow-hidden rounded-[var(--radius-sm)] border border-border'>
                    <div className='flex items-center bg-[var(--ds-bg-gary-default)]'>
                      <button type='button' className='focus-brand-ring flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm' aria-label={`${activeRelationId===r.id?'收起':'展开'}关系${r.name}`} aria-expanded={activeRelationId===r.id} onClick={() => setActiveRelationId(activeRelationId===r.id?null:r.id)}>
                        {activeRelationId===r.id?<ChevronUp className='size-4 shrink-0'/>:<ChevronDown className='size-4 shrink-0'/>}
                        <span>{objectRecords[r.source]?.name ?? '对象已不存在'} {r.name} {objectRecords[r.target]?.name ?? '对象已不存在'}</span>
                      </button><DeleteButton label={`移除关系${r.name}`} disabled={disabled} onClick={() => removeRelation(r.id)}/>
                    </div>
                    {activeRelationId===r.id && <div className='p-3'><BusinessRelationEditor relation={r} objects={objects} disabled={disabled} onChange={updateRelation}/></div>}
                  </article>)}
                  {!relations.some(r => r.source===selected.id || r.target===selected.id) && <EmptyPanel message='暂未建立对象关系。只添加当前设计有依据的关系。'/>}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  )
}

export default BusinessDataPanel

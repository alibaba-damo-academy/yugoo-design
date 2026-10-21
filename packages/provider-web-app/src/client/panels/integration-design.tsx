/** Native new-Plugin system-integration editor for integration_design. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Plug, Plus } from 'lucide-react'
import { Button } from '../ported/ui/button.tsx'
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
} from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { isRecord } from '../types.ts'

interface PluginSecret {
  id: string
  name: string
  description: string
}

interface SystemIntegration {
  id: string
  title: string
  description: string
  url: string
  secrets: Record<string, PluginSecret>
  secret_order: string[]
  prompt_content: string
  business_rules: string
}

interface IntegrationDesignState {
  schema_version: 8
  integrations: Record<string, SystemIntegration>
  integration_order: string[]
}

interface PanelProps {
  draft: unknown
  onChange: (next: IntegrationDesignState) => void
  running?: boolean
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function secretRecord(id: string, value: unknown): PluginSecret | undefined {
  if (!isRecord(value)) return undefined
  return {
    id,
    name: typeof value.name === 'string' ? value.name : '',
    description: typeof value.description === 'string' ? value.description : '',
  }
}

function integrationRecord(id: string, value: unknown): SystemIntegration | undefined {
  if (!isRecord(value)) return undefined
  const secrets = Object.fromEntries(
    Object.entries(isRecord(value.secrets) ? value.secrets : {}).flatMap(([secretId, secret]) => {
      const record = secretRecord(secretId, secret)
      return record === undefined ? [] : [[secretId, record]]
    }),
  )
  return {
    id,
    title: typeof value.title === 'string' ? value.title : '',
    description: typeof value.description === 'string' ? value.description : '',
    url: typeof value.url === 'string' ? value.url : '',
    secrets,
    secret_order: strings(value.secret_order),
    prompt_content: typeof value.prompt_content === 'string' ? value.prompt_content : '',
    business_rules: typeof value.business_rules === 'string' ? value.business_rules : '',
  }
}

function stateFromDraft(draft: unknown): IntegrationDesignState {
  const raw = isRecord(draft) ? draft : {}
  const integrations = Object.fromEntries(
    Object.entries(isRecord(raw.integrations) ? raw.integrations : {}).flatMap(([id, value]) => {
      const record = integrationRecord(id, value)
      return record === undefined ? [] : [[id, record]]
    }),
  )
  return {
    schema_version: 8,
    integrations,
    integration_order: strings(raw.integration_order),
  }
}

function FieldHeading(props: { title: string, required?: boolean, description?: string }): ReactElement {
  return (
    <span className='block'>
      <span className='font-medium text-[var(--ds-text-primary)]'>
        {props.title} {props.required === true ? <span className='text-destructive'>*</span> : null}
      </span>
      {props.description === undefined ? null : <span className='mt-1 block text-sm font-normal leading-5 text-[var(--ds-text-secondary)]'>{props.description}</span>}
    </span>
  )
}

/** Render the native new-Plugin connection form and product-side remarks. */
export function IntegrationDesignPanel(props: PanelProps): ReactElement {
  const state = stateFromDraft(props.draft)
  const disabled = props.running === true
  const integrations = useMemo(
    () => ordered(state.integrations, state.integration_order),
    [state.integration_order, state.integrations],
  )
  const [selectedId, setSelectedId] = useState<string | null>(integrations[0]?.id ?? null)
  const pendingId = useRef<string | null>(null)
  const selected = integrations.find((item) => item.id === selectedId) ?? integrations[0] ?? null
  const secrets = useMemo(
    () => selected === null ? [] : ordered(selected.secrets, selected.secret_order),
    [selected?.secrets, selected?.secret_order],
  )

  useEffect(() => {
    if (selectedId === null || !integrations.some((item) => item.id === selectedId)) {
      setSelectedId(integrations[0]?.id ?? null)
    }
  }, [integrations, selectedId])

  const emit = (patch: Partial<IntegrationDesignState>): void => {
    props.onChange({ ...state, ...patch })
  }

  const update = (updates: Partial<SystemIntegration>): void => {
    if (selected === null) return
    emit({ integrations: { ...state.integrations, [selected.id]: { ...selected, ...updates } } })
  }

  const add = (): void => {
    const id = createId('integration')
    const item: SystemIntegration = {
      id,
      title: `新系统集成 ${integrations.length + 1}`,
      description: '',
      url: '',
      secrets: {},
      secret_order: [],
      prompt_content: '',
      business_rules: '',
    }
    emit({ integrations: { ...state.integrations, [id]: item }, integration_order: [...integrations.map((integration) => integration.id), id] })
    pendingId.current = id
    setSelectedId(id)
  }

  const addSecret = (): void => {
    if (selected === null || secrets.length >= 10) return
    const id = createId('secret')
    const secret: PluginSecret = { id, name: '', description: '' }
    update({ secrets: { ...selected.secrets, [id]: secret }, secret_order: [...secrets.map((item) => item.id), id] })
  }

  const updateSecret = (secret: PluginSecret, updates: Partial<PluginSecret>): void => {
    if (selected === null) return
    update({ secrets: { ...selected.secrets, [secret.id]: { ...secret, ...updates } } })
  }

  const removeSecret = (secret: PluginSecret): void => {
    if (selected === null) return
    const next = { ...selected.secrets }
    delete next[secret.id]
    update({ secrets: next, secret_order: secrets.map((item) => item.id).filter((id) => id !== secret.id) })
  }

  const remove = (): void => {
    if (selected === null) return
    const next = { ...state.integrations }
    delete next[selected.id]
    const order = integrations.map((item) => item.id).filter((id) => id !== selected.id)
    emit({ integrations: next, integration_order: order })
    setSelectedId(order[0] ?? null)
  }

  return (
    <NativeDesignPanelFrame autoSaveId='integration-design-panel-sidebar'>
      <DesignPanelSidebar icon={<Plug className='size-4 text-[var(--ds-text-7)]' />} title='系统集成' ariaLabel='系统集成'>
        {integrations.map((item) => (
          <DesignPanelNavItem key={item.id} aria-label={`切换到系统集成${item.title}`} selected={selected?.id === item.id} onClick={() => { setSelectedId(item.id) }}>
            <strong className='block truncate'>{item.title}</strong>
          </DesignPanelNavItem>
        ))}
        <DesignPanelAddButton disabled={disabled} onClick={add}>添加系统集成</DesignPanelAddButton>
      </DesignPanelSidebar>

      <NativeDesignPanelContent mode='scroll'>
        {selected === null ? (
          <EmptyPanel message='还没有系统集成。根据产品需要添加接入说明和业务规则。' />
        ) : (
          <>
            <DesignPanelHeader>
              <label className='block min-w-0 w-full max-w-xl'>
                <EditablePanelTitle
                  autoFocus={pendingId.current === selected.id}
                  aria-label='当前系统集成名称'
                  className='max-w-xl'
                  value={selected.title}
                  disabled={disabled}
                  onFocus={() => { if (pendingId.current === selected.id) pendingId.current = null }}
                  onChange={(event) => { update({ title: event.target.value }) }}
                />
              </label>
              <DeleteButton label={`删除系统集成${selected.title}`} disabled={disabled} onClick={remove} />
            </DesignPanelHeader>

            <Section title='连接设置' description='说明这个新 Plugin 连接能做什么、从哪里访问，以及 Agent 应该怎样使用。'>
              <div className='max-w-3xl space-y-5'>
                <label className='block text-sm'>
                  <FieldHeading title='Description（能力说明）' required description='用一句话说明这个连接替产品完成什么事情。' />
                  <div className='relative mt-2'>
                    <Textarea aria-label='Plugin Description' className='min-h-20 resize-y pb-7' value={selected.description} disabled={disabled} maxLength={500} placeholder='例如：向仓储系统创建发货任务，并返回任务编号' onChange={(event) => { update({ description: event.target.value }) }} />
                    <span className='absolute bottom-2 right-3 text-xs text-[var(--ds-text-secondary)]'>{selected.description.length}/500</span>
                  </div>
                </label>
                <label className='block text-sm'>
                  <FieldHeading title='URL（访问地址）' required description='填写服务入口或接口文档地址，便于后续实现和核对。' />
                  <Input aria-label='Plugin URL' type='url' className='mt-2' value={selected.url} disabled={disabled} placeholder='https://api.example.com' onChange={(event) => { update({ url: event.target.value }) }} />
                </label>
                <div className='space-y-3 border-t border-border pt-5'>
                  <div className='flex items-start justify-between gap-3'>
                    <div><h4 className='text-sm font-medium'>凭据需求</h4><p className='mt-1 text-sm leading-5 text-[var(--ds-text-secondary)]'>这里只记录宿主需要配置的凭据名称和用途。实际密钥必须通过宿主应用凭据服务提供，不能写入设计文件。</p></div>
                    <Button type='button' size='sm' variant='ghost' disabled={disabled || secrets.length >= 10} onClick={addSecret}><Plus className='mr-1 size-4' />添加 Secret</Button>
                  </div>
                  {secrets.length === 0 ? (
                    <div className='rounded-[var(--radius-sm)] border border-dashed border-border bg-[var(--ds-bg-gary-default)] px-3 py-5 text-center text-sm text-[var(--ds-text-secondary)]'>如果服务不需要密钥，可以保持为空</div>
                  ) : <div className='space-y-3'>{secrets.map((secret, index) => (
                    <div key={secret.id} className='rounded-[var(--radius-sm)] border border-border bg-[var(--ds-bg-gary-default)] p-3'>
                      <div className='flex items-center justify-between'><strong className='text-sm'>凭据 {index + 1}</strong><DeleteButton label={`删除 Secret ${index + 1}`} disabled={disabled} onClick={() => { removeSecret(secret) }} /></div>
                      <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                        <label className='block text-sm'><span className='font-medium'>Name *</span><Input aria-label={`Secret ${index + 1} Name`} className='mt-1.5 bg-white' value={secret.name} disabled={disabled} placeholder='例如：WMS_API_KEY' onChange={(event) => { updateSecret(secret, { name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }) }} /><span className='mt-1 block text-xs text-[var(--ds-text-secondary)]'>仅使用大写字母、数字和下划线</span></label>
                        <label className='block text-sm'><span className='font-medium'>Description（用途说明）</span><Input aria-label={`Secret ${index + 1} Description`} className='mt-1.5 bg-white' value={secret.description} disabled={disabled} placeholder='例如：用于调用仓储系统创建发货任务' onChange={(event) => { updateSecret(secret, { description: event.target.value }) }} /></label>
                      </div>
                    </div>
                  ))}</div>}
                </div>
                <label className='block text-sm'>
                  <FieldHeading title='Prompt（使用方法）' required description='告诉 Agent 何时使用这个连接、需要完成什么，以及应该返回哪些结果。' />
                  <Textarea aria-label='Plugin 使用方法提示词' className='mt-2 min-h-28 resize-y text-sm' value={selected.prompt_content} disabled={disabled} placeholder='例如：订单审核通过后创建发货任务；提交订单编号、收货信息和商品明细；返回发货任务编号和创建状态。' onChange={(event) => { update({ prompt_content: event.target.value }) }} />
                </label>
              </div>
            </Section>

            <Section title='备注' description='补充这项连接的触发时机、成功结果和失败处理，不需要重复描述 API 字段。'>
              <div className='relative max-w-3xl'>
                <Textarea aria-label='系统集成业务规则' value={selected.business_rules} disabled={disabled} maxLength={10000} className='min-h-28 resize-y bg-white pb-7 text-sm' placeholder={'例如：\n- 订单审核通过后执行\n- 成功后保存发货任务编号，并将订单更新为等待出库\n- 失败时保留订单并提示重试，不重复创建发货任务'} onChange={(event) => { update({ business_rules: event.target.value }) }} />
                <span className='absolute bottom-2 right-3 text-xs text-[var(--ds-text-secondary)]'>{selected.business_rules.length}/10000</span>
              </div>
            </Section>
          </>
        )}
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  )
}

export default IntegrationDesignPanel

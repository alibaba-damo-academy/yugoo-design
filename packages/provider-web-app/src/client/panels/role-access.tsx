/** Native role/access editor bound directly to the role_access Design File. */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Plus, Users } from 'lucide-react'
import { Button } from '../ported/ui/button.tsx'
import { Checkbox } from '../ported/ui/checkbox.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ported/ui/dialog.tsx'
import { Input } from '../ported/ui/input.tsx'
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx'
import {
  DesignPanelAddButton,
  DeleteButton,
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSelect,
  DesignPanelSidebar,
  EditablePanelTitle,
  inputClass,
  Section,
} from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { isRecord } from '../types.ts'

interface RoleDefinition {
  id: string
  title: string
  assignment_rule: string
}

interface AccessPolicy {
  id: string
  title: string
  role_ref: string
  capability: string
  effect: 'allow' | 'deny'
  applies_when: string
  requirements: ('confirm' | 'reauthenticate' | 'custom')[]
  custom_requirement: string
}

interface RoleAccessState {
  schema_version: number
  title: string
  summary: string
  roles: Record<string, RoleDefinition>
  role_order: string[]
  policies: Record<string, AccessPolicy>
  policy_order: string[]
}

interface PanelProps {
  draft: unknown
  onChange: (next: RoleAccessState) => void
  running?: boolean
}

const ASSIGNMENT_OPTIONS = [
  { label: '注册用户', value: '注册后自动拥有' },
  { label: '由管理员授予', value: '由管理员授予' },
] as const

const REQUIREMENT_OPTIONS = [
  { value: 'confirm', label: '再次确认' },
  { value: 'reauthenticate', label: '重新验证身份' },
] as const

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function text(value: unknown): string {
  return String(value ?? '')
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function roleRecord(id: string, value: unknown): RoleDefinition | undefined {
  if (!isRecord(value)) return undefined
  return {
    id,
    title: typeof value.title === 'string' ? value.title : '',
    assignment_rule: typeof value.assignment_rule === 'string' ? value.assignment_rule : '',
  }
}

function policyRecord(id: string, value: unknown): AccessPolicy | undefined {
  if (!isRecord(value)) return undefined
  const requirements = strings(value.requirements).filter(
    (entry): entry is AccessPolicy['requirements'][number] =>
      entry === 'confirm' || entry === 'reauthenticate' || entry === 'custom',
  )
  return {
    id: typeof value.id === 'string' ? value.id : id,
    title: typeof value.title === 'string' ? value.title : '',
    role_ref: typeof value.role_ref === 'string' ? value.role_ref : '',
    capability: typeof value.capability === 'string' ? value.capability : '',
    effect: value.effect === 'deny' ? 'deny' : 'allow',
    applies_when: typeof value.applies_when === 'string' ? value.applies_when : '',
    requirements,
    custom_requirement: typeof value.custom_requirement === 'string' ? value.custom_requirement : '',
  }
}

function ordered<T>(records: Record<string, T>, order: string[]): T[] {
  const seen = new Set(order)
  return [...order, ...Object.keys(records).filter((id) => !seen.has(id))]
    .map((id) => records[id])
    .filter((item): item is T => item !== undefined)
}

function stateFromDraft(draft: unknown): RoleAccessState {
  const raw = isRecord(draft) ? draft : {}
  const roles = Object.fromEntries(
    Object.entries(isRecord(raw.roles) ? raw.roles : {}).flatMap(([id, value]) => {
      const record = roleRecord(id, value)
      return record === undefined ? [] : [[id, record]]
    }),
  )
  const policies = Object.fromEntries(
    Object.entries(isRecord(raw.policies) ? raw.policies : {}).flatMap(([id, value]) => {
      const record = policyRecord(id, value)
      return record === undefined ? [] : [[id, record]]
    }),
  )
  return {
    schema_version: typeof raw.schema_version === 'number' ? raw.schema_version : 5,
    title: typeof raw.title === 'string' ? raw.title : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    roles,
    role_order: strings(raw.role_order),
    policies,
    policy_order: strings(raw.policy_order),
  }
}

function permissionTitle(item: AccessPolicy): string {
  return `${item.effect === 'deny' ? '禁止' : '允许'}${item.capability || '未填写权限'}`
}

/** Render the native role assignment and permission-decision workspace. */
export function RoleAccessPanel(props: PanelProps): ReactElement {
  const state = stateFromDraft(props.draft)
  const disabled = props.running === true
  const roles = useMemo(
    () => ordered(state.roles, state.role_order),
    [state.role_order, state.roles],
  )
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(roles[0]?.id ?? null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const pendingRoleId = useRef<string | null>(null)
  const [customAssignmentRoleIds, setCustomAssignmentRoleIds] = useState<Set<string>>(new Set())
  const selectedRole = selectedRoleId === null
    ? roles[0] ?? null
    : roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null
  const selectedAssignmentRule = text(selectedRole?.assignment_rule)
  const hasPresetAssignmentRule = ASSIGNMENT_OPTIONS.some((option) => option.value === selectedAssignmentRule)
  const usesCustomAssignmentRule = selectedRole !== null && (
    customAssignmentRoleIds.has(selectedRole.id)
    || (selectedAssignmentRule !== '' && !hasPresetAssignmentRule)
  )

  useEffect(() => {
    if (selectedRoleId === null && selectedRole !== null) setSelectedRoleId(selectedRole.id)
    if (selectedRoleId !== null && roles.some((role) => role.id === selectedRoleId)) {
      pendingRoleId.current = null
    } else if (selectedRoleId !== null && pendingRoleId.current !== selectedRoleId) {
      setSelectedRoleId(roles[0]?.id ?? null)
    }
  }, [roles, selectedRole, selectedRoleId])

  const policies = useMemo(
    () => ordered(state.policies, state.policy_order)
      .filter((item) => item.role_ref === (selectedRole?.id ?? '')),
    [selectedRole?.id, state.policies, state.policy_order],
  )

  const emit = (patch: Partial<RoleAccessState>): void => {
    props.onChange({ ...state, ...patch })
  }

  const updateRole = (updates: Partial<RoleDefinition>): void => {
    if (selectedRole === null) return
    emit({ roles: { ...state.roles, [selectedRole.id]: { ...selectedRole, ...updates } } })
  }

  const addRole = (): void => {
    const id = createId('role')
    const title = roles.length === 0 ? '新角色' : `新角色 ${roles.length + 1}`
    emit({
      roles: { ...state.roles, [id]: { id, title, assignment_rule: '' } },
      role_order: [...roles.map((item) => item.id), id],
    })
    pendingRoleId.current = id
    setSelectedRoleId(id)
  }

  const updatePolicy = (item: AccessPolicy, updates: Partial<AccessPolicy>): void => {
    emit({ policies: { ...state.policies, [item.id]: { ...item, ...updates } } })
  }

  const updatePermissionDecision = (item: AccessPolicy, updates: Partial<AccessPolicy>): void => {
    const next = { ...item, ...updates }
    updatePolicy(item, { ...updates, title: permissionTitle(next) })
  }

  const addPolicy = (): void => {
    if (selectedRole === null) return
    const id = createId('policy')
    const item: AccessPolicy = {
      id,
      title: '新权限',
      role_ref: selectedRole.id,
      effect: 'allow',
      capability: '',
      applies_when: '',
      requirements: [],
      custom_requirement: '',
    }
    emit({
      policies: { ...state.policies, [id]: item },
      policy_order: [...state.policy_order, id],
    })
  }

  const removePolicy = (item: AccessPolicy): void => {
    const next = { ...state.policies }
    delete next[item.id]
    emit({ policies: next, policy_order: state.policy_order.filter((id) => id !== item.id) })
  }

  const removeSelectedRole = (): void => {
    if (selectedRole === null) return
    const rolesNext = { ...state.roles }
    delete rolesNext[selectedRole.id]
    const policiesNext = Object.fromEntries(
      Object.entries(state.policies).filter(([, policy]) => policy.role_ref !== selectedRole.id),
    )
    const roleOrderNext = state.role_order.filter((id) => id !== selectedRole.id)
    const policyOrderNext = state.policy_order.filter((id) => policiesNext[id] !== undefined)
    setSelectedRoleId(roleOrderNext[0] ?? null)
    setDeleteOpen(false)
    emit({ roles: rolesNext, role_order: roleOrderNext, policies: policiesNext, policy_order: policyOrderNext })
  }

  const deletionDialog = (
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除“{selectedRole?.title ?? ''}”？</DialogTitle>
          <DialogDescription>只属于该角色的权限会一并删除，其他角色不会受到影响。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button type='button' variant='outline'>取消</Button></DialogClose>
          <Button type='button' variant='destructive' onClick={removeSelectedRole}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return (
    <NativeDesignPanelFrame autoSaveId='role-access-panel-sidebar' overlay={deletionDialog}>
      <DesignPanelSidebar
        icon={<Users className='size-4 text-[var(--ds-text-7)]' />}
        title='角色'
        ariaLabel='产品角色'
      >
        {roles.map((role) => (
          <DesignPanelNavItem
            key={role.id}
            aria-label={`切换到角色${role.title}`}
            selected={selectedRole?.id === role.id}
            onClick={() => { setSelectedRoleId(role.id) }}
          >
            <strong className='block truncate'>{role.title}</strong>
          </DesignPanelNavItem>
        ))}
        <DesignPanelAddButton disabled={disabled} onClick={addRole}>添加角色</DesignPanelAddButton>
      </DesignPanelSidebar>

      <NativeDesignPanelContent mode='scroll'>
        {selectedRole === null ? (
          <div className='flex h-full items-center justify-center px-6 text-center text-sm text-[hsl(var(--muted-foreground))]'>
            先添加一个角色，再说明这个角色给谁以及可以做什么。
          </div>
        ) : (
          <>
            <DesignPanelHeader>
              <EditablePanelTitle
                autoFocus={pendingRoleId.current === selectedRole.id}
                aria-label='当前角色名称'
                className='max-w-xs'
                value={selectedRole.title}
                disabled={disabled}
                placeholder='例如：销售经理'
                onBlur={() => { pendingRoleId.current = null }}
                onChange={(event) => { pendingRoleId.current = null; updateRole({ title: event.target.value }) }}
              />
              <DeleteButton
                label={`删除角色${selectedRole.title}`}
                disabled={disabled}
                onClick={() => { setDeleteOpen(true) }}
              />
            </DesignPanelHeader>

            <Section title='谁会拥有这个角色？' description='选择这个角色如何获得；只有“其他”需要自己填写规则。'>
              <div className='mt-3 flex flex-nowrap items-center gap-4 overflow-x-auto pb-1'>
                {ASSIGNMENT_OPTIONS.map((option) => (
                  <label key={option.label} className='flex shrink-0 cursor-pointer items-center gap-1.5 text-sm'>
                    <input
                      type='radio'
                      name={`assignment-${selectedRole.id}`}
                      checked={selectedAssignmentRule === option.value}
                      disabled={disabled}
                      onChange={() => {
                        setCustomAssignmentRoleIds((previous) => {
                          const next = new Set(previous); next.delete(selectedRole.id); return next
                        })
                        updateRole({ assignment_rule: option.value })
                      }}
                    />
                    {option.label}
                  </label>
                ))}
                <label className='flex shrink-0 cursor-pointer items-center gap-1.5 text-sm'>
                  <input
                    type='radio'
                    name={`assignment-${selectedRole.id}`}
                    aria-label='其他获得规则'
                    checked={usesCustomAssignmentRule}
                    disabled={disabled}
                    onChange={() => {
                      setCustomAssignmentRoleIds((previous) => new Set(previous).add(selectedRole.id))
                      updateRole({ assignment_rule: '' })
                    }}
                  />
                  其他
                </label>
              </div>
              {usesCustomAssignmentRule ? (
                <input
                  autoFocus
                  aria-label='其他角色获得规则'
                  className={`${inputClass} mt-3`}
                  value={selectedAssignmentRule}
                  disabled={disabled}
                  placeholder='例如：受邀加入项目后拥有，离开项目时失去'
                  onChange={(event) => { updateRole({ assignment_rule: event.target.value }) }}
                />
              ) : null}
            </Section>

            <Section
              title='权限清单'
              description='每条权限只回答允许或禁止哪项能力；有边界时再补一句适用条件。'
              action={<Button type='button' size='sm' variant='outline' disabled={disabled} onClick={addPolicy}><Plus className='mr-1 size-4' />添加权限</Button>}
            >
              <div className='space-y-3'>
                {policies.length === 0 ? (
                  <p className='rounded-[var(--radius-sm)] bg-[var(--ds-bg-gary-default)] px-3 py-4 text-sm text-[hsl(var(--muted-foreground))]'>
                    还没有权限。先添加这个角色最重要的一项操作。
                  </p>
                ) : policies.map((item, index) => {
                  const requirements = item.requirements
                  return (
                    <article key={item.id} className='overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background'>
                      <header className='flex h-10 items-center justify-between border-b border-border bg-[var(--ds-bg-gary-default)] px-3'>
                        <span className='flex items-center gap-2 text-sm font-medium'>
                          <span className='flex size-5 items-center justify-center rounded-[var(--radius-sm)] bg-background text-sm text-[hsl(var(--muted-foreground))]'>{index + 1}</span>
                          权限
                        </span>
                        <DeleteButton label={`删除${item.title}`} disabled={disabled} onClick={() => { removePolicy(item) }} />
                      </header>
                      <div className='space-y-3 p-3'>
                        <div className='flex flex-wrap items-center gap-2 text-sm'>
                          <span className='shrink-0 text-[hsl(var(--muted-foreground))]'>这个角色</span>
                          <DesignPanelSelect
                            aria-label={`${item.id}.effect`}
                            className='w-auto'
                            value={item.effect}
                            disabled={disabled}
                            onChange={(event) => { updatePermissionDecision(item, { effect: event.target.value === 'deny' ? 'deny' : 'allow' }) }}
                          >
                            <option value='allow'>允许</option><option value='deny'>禁止</option>
                          </DesignPanelSelect>
                          <input
                            aria-label='权限内容'
                            className={`${inputClass} min-w-32 flex-1`}
                            value={item.capability}
                            disabled={disabled}
                            placeholder='例如：审批订单、查看项目成员'
                            onChange={(event) => { updatePermissionDecision(item, { capability: event.target.value }) }}
                          />
                        </div>
                        <label className='grid gap-2 border-t border-border pt-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center'>
                          <span className='text-sm font-medium'>适用条件（可选）</span>
                          <input aria-label='权限适用条件' className={inputClass} value={item.applies_when} disabled={disabled} placeholder='例如：仅限自己负责的客户，且客户仍在跟进中' onChange={(event) => { updatePolicy(item, { applies_when: event.target.value }) }} />
                        </label>
                        <div className='border-t border-border pt-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-3'>
                          <span className='text-sm font-medium'>操作前需要（可选）</span>
                          <div>
                            <div className='mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 sm:mt-0'>
                              {REQUIREMENT_OPTIONS.map((option) => (
                                <label key={option.value} className='flex cursor-pointer items-center gap-2 text-sm'>
                                  <Checkbox
                                    checked={requirements.includes(option.value)}
                                    disabled={disabled}
                                    onCheckedChange={(checked) => { updatePolicy(item, { requirements: checked ? [...requirements, option.value] : requirements.filter((value) => value !== option.value) }) }}
                                  />
                                  {option.label}
                                </label>
                              ))}
                              <label className='flex cursor-pointer items-center gap-2 text-sm'>
                                <Checkbox
                                  aria-label='其他额外步骤'
                                  checked={requirements.includes('custom')}
                                  disabled={disabled}
                                  onCheckedChange={(checked) => { updatePolicy(item, {
                                    requirements: checked ? [...requirements, 'custom'] : requirements.filter((value) => value !== 'custom'),
                                    custom_requirement: checked ? item.custom_requirement : '',
                                  }) }}
                                />
                                其他
                              </label>
                            </div>
                            {requirements.includes('custom') ? (
                              <input autoFocus aria-label='其他额外步骤说明' className={`${inputClass} mt-2`} value={item.custom_requirement} disabled={disabled} placeholder='说明执行前还需要做什么' onChange={(event) => { updatePolicy(item, { custom_requirement: event.target.value }) }} />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </Section>
          </>
        )}
      </NativeDesignPanelContent>

    </NativeDesignPanelFrame>
  )
}

export default RoleAccessPanel

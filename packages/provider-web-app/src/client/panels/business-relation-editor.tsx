import type { ReactElement } from 'react'
import { Input } from '../ported/ui/input.tsx'
import { Button } from '../ported/ui/button.tsx'
import { Textarea } from '../ported/ui/textarea.tsx'
import { DesignPanelField, DesignPanelSelect } from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { BUSINESS_MULTIPLICITIES, reverseBusinessRelation, type BusinessMultiplicity, type BusinessRelation } from './business-relations.ts'

interface Props {
  relation: BusinessRelation
  objects: readonly {id: string; name: string}[]
  disabled: boolean
  onChange: (next: BusinessRelation) => void
}
/** Same canonical relationship controls in the form and canvas inspector. */
export function BusinessRelationEditor({relation, objects, disabled, onChange}: Props): ReactElement {
  const name = (id: string) => objects.find(o => o.id === id)?.name || '未选择对象'
  const update = (patch: Partial<BusinessRelation>) => onChange({...relation, ...patch})
  return <div className='space-y-3'>
    <DesignPanelField label='关系含义'>
      <DesignPanelSelect disabled={disabled} value={relation.kind} onChange={event => {
        const kind = event.target.value as BusinessRelation['kind']
        if (kind === 'generalization') {
          const {source_count: _source, target_count: _target, ...next} = relation
          onChange({...next, kind, name:'是一种'})
        } else onChange({...relation, kind, name:'关联'})
      }}>
        <option value='association'>业务关联</option><option value='generalization'>类型继承（是一种）</option>
      </DesignPanelSelect>
    </DesignPanelField>
    <div className='grid gap-3 sm:grid-cols-2'>
      {(['source', 'target'] as const).map(key => <DesignPanelField key={key} label={relation.kind === 'generalization' ? key === 'source' ? '子类型' : '父类型' : key === 'source' ? '从这个对象' : '关联到这个对象'}>
        <DesignPanelSelect disabled={disabled} value={relation[key]} onChange={event => update({[key]:event.target.value})}>
          <option value=''>请选择对象</option>
          {!objects.some(o => o.id === relation[key]) && relation[key] && <option value={relation[key]}>对象已不存在：{relation[key]}</option>}
          {objects.map(o => <option key={o.id} value={o.id}>{o.name || '未命名对象'}</option>)}
        </DesignPanelSelect>
      </DesignPanelField>)}
    </div>
    <Button type='button' size='sm' variant='outline' disabled={disabled} onClick={() => onChange(reverseBusinessRelation(relation))}>交换双方</Button>
    <DesignPanelField label='关系名称'><Input disabled={disabled} value={relation.name} onChange={event => update({name:event.target.value})}/></DesignPanelField>
    {relation.kind === 'association' && <p className='text-sm text-[var(--ds-text-secondary)]'>{name(relation.source)} → {relation.name || '关联'} → {name(relation.target)}。交换双方后，请确认关系名称仍符合你的意思。</p>}
    {relation.kind === 'association' ? <div className='space-y-3'>
      <DesignPanelField label={`每个${name(relation.source)}关联多少${name(relation.target)}？`}>
        <DesignPanelSelect disabled={disabled} value={relation.target_count ?? ''} onChange={event => {
          const {target_count: _old, ...rest} = relation
          onChange(event.target.value ? {...rest, target_count:event.target.value as BusinessMultiplicity} : rest)
        }}><option value=''>尚未确定</option>{BUSINESS_MULTIPLICITIES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</DesignPanelSelect>
      </DesignPanelField>
      <DesignPanelField label={`每个${name(relation.target)}关联多少${name(relation.source)}？`}>
        <DesignPanelSelect disabled={disabled} value={relation.source_count ?? ''} onChange={event => {
          const {source_count: _old, ...rest} = relation
          onChange(event.target.value ? {...rest, source_count:event.target.value as BusinessMultiplicity} : rest)
        }}><option value=''>尚未确定</option>{BUSINESS_MULTIPLICITIES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</DesignPanelSelect>
      </DesignPanelField>
    </div> : <p className='text-sm text-[var(--ds-text-secondary)]'>{name(relation.source)}是一种{name(relation.target)}，沿用父类型的定义与信息。父类型的信息只在原处维护。</p>}
    <DesignPanelField label='含义与约束（选填）' hint='数量、归属或删除时的约定尚未确定，也可以在这里说明。'>
      <Textarea disabled={disabled} value={relation.description ?? ''} onChange={event => update({description:event.target.value})}/>
    </DesignPanelField>
  </div>
}

/** Isolated source-rendered fixture. It never reads or saves a Design Project. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderManifest, applyDesignEditToDraft } from '../src/interpreter.ts'
import '../src/visual-components.css'

const manifest = {
  version: 1, panel_kind: 'neutral_choices', sections: [{ id: 'items', title: 'Items', add_mode: 'none' }],
  fields: [
    { key: 'name', label: 'Name', control: 'text', applies_to: ['items'] },
    { key: 'description', label: 'Description', control: 'textarea', applies_to: ['items'] },
    { key: 'priority', label: 'Priority', control: 'select', options: [{ value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }], applies_to: ['items'] },
  ],
  ui: { component: 'record_board', id: 'board', title: 'Items', source: 'items', board: { label: 'name', description: 'description', group: 'group', badge: 'priority', rejected: 'rejected' } },
} as const

function App() {
  const [data, setData] = useState({ items: { example: { name: 'Review evidence', description: 'Choose priority from the shared menu.', group: 'Examples', priority: 'Medium', untouched: 'Keep' } } })
  const [disabled, setDisabled] = useState(false), [dark, setDark] = useState(false), [form, setForm] = useState(false)
  const [writes, setWrites] = useState(0)
  ;(window as any).selectProbe = { data, writes }
  return <main className="dsh-design-panel" style={{ height: '100vh', color: dark ? '#eee' : '#272727', background: dark ? '#202124' : '#fff',
    '--ds-bg-white': dark ? '#292a2d' : '#fff', '--ds-fill-1': dark ? '#202124' : '#fff', '--ds-fill-5': dark ? '#555' : '#dfdfdf',
    '--ds-border-default': dark ? '#666' : '#dfdfdf', '--ds-text-primary': dark ? '#eee' : '#272727',
    '--ds-brand-light-bg-default': dark ? '#3d315a' : '#f7f4fe', '--ds-brand-text-primary': dark ? '#c4b5fd' : '#6849d8',
  } as any}>
    <header style={{ display: 'flex', gap: 12, padding: 12 }}><button onClick={() => setDark(value => !value)}>Theme</button>
      <button onClick={() => setDisabled(value => !value)}>Read only</button><button onClick={() => setForm(value => !value)}>Form</button></header>
    <div style={{ height: 'calc(100% - 64px)' }}>{renderManifest({ ...manifest, ui: form ? { component: 'record_form', id: 'form', source: 'items' } : manifest.ui } as any, data, {
      locale: 'en-US', editable: !disabled,
      onEdit: edit => { setWrites(value => value + 1); setData(previous => applyDesignEditToDraft(previous, manifest as any, edit) as typeof previous) },
      onTransaction: edits => { setWrites(value => value + 1); setData(previous => edits.reduce((draft, edit) => applyDesignEditToDraft(draft, manifest as any, edit) as typeof previous, previous)) },
    })}</div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)

import { useEffect, useId, useRef, useState } from 'react'
import { panelText } from '../panel-i18n.tsx'
import { Languages, Moon, Sun } from 'lucide-react'
import { Button } from './ported/ui/button.tsx'

type PreferenceChange = { kind: 'language'; value: 'zh' | 'en' } | { kind: 'appearance'; value: 'light' | 'dark' }

/** The Host owns the current preference and its persistence. */
export interface DesignWorkspacePreferences {
  language: 'zh' | 'en'
  /** The Host's resolved appearance, including while its preference is system. */
  effectiveAppearance: 'light' | 'dark'
  onLanguageChange: (language: 'zh' | 'en') => void | Promise<void>
  onAppearanceChange: (appearance: 'light' | 'dark') => void | Promise<void>
}

/** Presentation only: changing chrome never saves or replaces a design draft. */
export function DesignWorkspacePreferenceControls({ preferences }: { preferences: DesignWorkspacePreferences }) {
  const locale = preferences.language === 'zh' ? 'zh-CN' : 'en-US'
  const text = (key: Parameters<typeof panelText>[0]) => panelText(key, locale)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<{ request: PreferenceChange; detail: string }>()
  const changing = useRef(false)
  const group = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<PreferenceChange['kind']>()
  const errorId = useId()
  useEffect(() => {
    if (pending || !restoreFocus.current || !group.current) return
    const target = group.current.querySelector<HTMLButtonElement>(`[data-workspace-preference="${restoreFocus.current}"]`)
    const doc = group.current.ownerDocument
    // A disabled control can lose focus while saving. Preserve deliberate
    // navigation to another control while the Host is saving.
    if (doc.activeElement === doc.body) target?.focus()
    restoreFocus.current = undefined
  }, [pending])
  const error = failure ? panelText('workspacePreferencesChangeFailed', locale, {
    preference: text(failure.request.kind === 'language' ? 'workspacePreferencesLanguage' : 'workspacePreferencesAppearance'), error: failure.detail,
  }) : ''
  const change = async (request: PreferenceChange, retry = false) => {
    if (changing.current) return
    changing.current = true
    restoreFocus.current = request.kind
    setPending(true)
    if (!retry) setFailure(undefined)
    try {
      await (request.kind === 'language' ? preferences.onLanguageChange(request.value) : preferences.onAppearanceChange(request.value))
      setFailure(undefined)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFailure({ request, detail })
    } finally {
      changing.current = false
      setPending(false)
    }
  }
  return <div ref={group} className='dsh-workspace-preferences' data-testid='design-workspace-preferences'
    role='group' aria-label={text('workspacePreferences')} aria-busy={pending}>
    <div className='dsh-workspace-preference-controls'>
      <Button type='button' variant='ghostIcon' size='icon' disabled={pending}
        data-workspace-preference='language'
        aria-label={text(preferences.language === 'zh' ? 'workspacePreferencesSwitchEnglish' : 'workspacePreferencesSwitchChinese')}
        title={text(preferences.language === 'zh' ? 'workspacePreferencesSwitchEnglish' : 'workspacePreferencesSwitchChinese')}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void change({ kind: 'language', value: preferences.language === 'zh' ? 'en' : 'zh' })}>
        <Languages strokeWidth={1.5} aria-hidden='true' />
      </Button>
      <Button type='button' variant='ghostIcon' size='icon' disabled={pending}
        data-workspace-preference='appearance'
        aria-label={text(preferences.effectiveAppearance === 'dark' ? 'workspacePreferencesSwitchLight' : 'workspacePreferencesSwitchDark')}
        title={text(preferences.effectiveAppearance === 'dark' ? 'workspacePreferencesSwitchLight' : 'workspacePreferencesSwitchDark')}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void change({ kind: 'appearance', value: preferences.effectiveAppearance === 'dark' ? 'light' : 'dark' })}>
        {preferences.effectiveAppearance === 'dark' ? <Sun strokeWidth={1.5} aria-hidden='true' /> : <Moon strokeWidth={1.5} aria-hidden='true' />}
      </Button>
    </div>
    {failure ? <div id={errorId} className='dsh-workspace-preference-error' role='alert'>
      <span>{error}</span>
      <Button variant='ghost' size='sm' disabled={pending} onClick={() => void change(failure.request, true)}>{text(pending ? 'workspacePreferencesSaving' : 'workspacePreferencesRetry')}</Button>
    </div> : pending ? <div className='dsh-workspace-preference-status' role='status'>{text('workspacePreferencesSaving')}</div> : null}
  </div>
}

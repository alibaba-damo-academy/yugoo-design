/**
 * Stand-in for the original `useLangSwitch()` i18n hook. `host.ts` only
 * exposes `useLang`, so this mirrors host.ts's navigator-based language pick
 * verbatim; the inline zh/en ternaries in the research components stay in
 * sync with the `t` dictionary because both use the same selection rule.
 */

/** The active language, shaped like the original hook's return value. */
export function useLangSwitch(): { currentLanguage: 'zh_CN' | 'en_US' } {
  const browserLang = navigator.language || navigator.languages?.[0] || 'en';
  return {
    currentLanguage: browserLang.toLowerCase().startsWith('zh')
      ? 'zh_CN'
      : 'en_US',
  };
}

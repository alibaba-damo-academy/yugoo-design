/** Generic cross-panel navigation guard (pure; node-testable). */

/**
 * Whether a cross-panel navigation target may activate a tab.
 * Cross-panel references (e.g. PRD evidence chips) may carry uninstalled
 * skill names or non-skill markers (`user:`, `upload:`); only targets that
 * are currently projected skills may navigate, so unknown refs no-op
 * instead of blanking the dock.
 * @param skills - the currently projected skill ids.
 * @param target - the navigation target carried by a cross-panel reference.
 * @returns whether the host may switch the active panel to `target`.
 */
export function canNavigate(skills: readonly string[], target: string): boolean {
  return skills.includes(target)
}

/** Default share of the design workspace assigned to the Design dock. */
export const DESIGN_DOCK_RATIO = 0.7

/** Width of the host's collapsed navigation rail. */
export const COLLAPSED_NAV_WIDTH = 56

/** Minimum usable conversation width while the Design dock is open. */
export const CONVERSATION_MIN_WIDTH = 360

/** Minimum usable Design dock width. */
export const DESIGN_DOCK_MIN_WIDTH = 320

/**
 * Keep a requested dock width inside the Host workspace while preserving the
 * minimum conversation column.
 *
 * @param viewportWidth - browser viewport width in CSS pixels.
 * @param requestedWidth - current or dragged Design dock width.
 * @param navigationWidth - rendered Host navigation width in CSS pixels.
 * @returns the dock width that fits the current Host layout.
 */
export function clampDesignDockWidth(
  viewportWidth: number,
  requestedWidth: number,
  navigationWidth: number = COLLAPSED_NAV_WIDTH,
): number {
  const viewport = Number.isFinite(viewportWidth) ? Math.max(0, Math.round(viewportWidth)) : 0
  const requested = Number.isFinite(requestedWidth) ? Math.max(0, Math.round(requestedWidth)) : 0
  const navigation = Number.isFinite(navigationWidth) ? Math.max(0, Math.round(navigationWidth)) : 0
  const maximum = Math.max(
    DESIGN_DOCK_MIN_WIDTH,
    viewport - navigation - CONVERSATION_MIN_WIDTH,
  )
  return Math.max(DESIGN_DOCK_MIN_WIDTH, Math.min(requested, maximum))
}

/**
 * Resolve the automatic Design dock width for a viewport.
 *
 * The 70/30 ratio applies to the workspace left after the host navigation
 * collapses. Small viewports preserve a usable conversation before honoring
 * the ratio, while very small viewports preserve the Design dock itself.
 *
 * @param viewportWidth - browser viewport width in CSS pixels.
 * @param navigationWidth - current Host navigation width in CSS pixels.
 * @returns the automatic Design dock width in CSS pixels.
 */
export function automaticDesignDockWidth(
  viewportWidth: number,
  navigationWidth: number = COLLAPSED_NAV_WIDTH,
): number {
  const viewport = Number.isFinite(viewportWidth) ? Math.max(0, Math.round(viewportWidth)) : 0
  const navigation = Number.isFinite(navigationWidth) ? Math.max(0, Math.round(navigationWidth)) : 0
  const workspace = Math.max(0, viewport - navigation)
  const ratioWidth = Math.round(workspace * DESIGN_DOCK_RATIO)
  const conversationSafeWidth = Math.max(DESIGN_DOCK_MIN_WIDTH, workspace - CONVERSATION_MIN_WIDTH)
  return Math.max(DESIGN_DOCK_MIN_WIDTH, Math.min(ratioWidth, conversationSafeWidth))
}

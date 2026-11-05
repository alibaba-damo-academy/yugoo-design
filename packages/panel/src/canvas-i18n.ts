import type { AriaLabelConfig } from '@xyflow/react'
import type { usePanelI18n } from './panel-i18n.tsx'

/** Keep native canvas controls and assistive text in the Panel's current locale. */
export function canvasAriaLabels(t: ReturnType<typeof usePanelI18n>['t'], nodeDescription = t('canvasNodeKeyboard')): AriaLabelConfig {
  return {
    'node.a11yDescription.default': nodeDescription,
    'node.a11yDescription.keyboardDisabled': nodeDescription,
    'node.a11yDescription.ariaLiveMessage': ({ x, y }) => t('canvasNodePosition', { x, y }),
    'edge.a11yDescription.default': t('canvasEdgeKeyboard'),
    'controls.ariaLabel': t('canvasControls'),
    'controls.zoomIn.ariaLabel': t('zoomIn'),
    'controls.zoomOut.ariaLabel': t('zoomOut'),
    'controls.fitView.ariaLabel': t('fitAll'),
    'controls.interactive.ariaLabel': t('canvasInteractivity'),
    'minimap.ariaLabel': t('canvasMinimap'),
    'handle.ariaLabel': t('canvasConnection'),
  }
}

import { usePanelI18n } from '../panel-i18n.tsx'
import React from 'react'
import { Maximize2, Monitor, Moon, RotateCcw, Sun, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from './ported/ui/button.js'

// Approved v5 source hues, shared by both graph renderers and the source legend.
export const graphAmbientColors = ['#279e91', '#9866c9', '#d19141', '#3297b3', '#c66391', '#648acb', '#93aa39', '#b68c56', '#409db6', '#cc7954', '#8382c9', '#4f9f7b', '#74a5b8']
export const graphSourceColors = ['#4d9485', '#8d79b3', '#bb8e60', '#548ca8', '#b17992', '#798cbb', '#8a9b52', '#8c8170', '#668aa2', '#ac7c68', '#9291b8', '#79957b', '#8a9eaa']
export const graphDarkSourceColors = ['#65ceb8', '#b5a0dd', '#e2b78b', '#78b6d6', '#dca0bb', '#a3b5e3', '#b9d06f', '#c2ad8b', '#88b4d1', '#d8a38d', '#b1b0de', '#97c99a', '#adc8d8']

export interface GraphCanvasTheme {
  dark: boolean
  onToggleDark: () => void
  followingPage?: boolean
  onFollowPage?: () => void
}

/** Camera actions keep their position, order and appearance across 2D and 3D. */
export function GraphCameraTools(props: GraphCanvasTheme & {
  disabled?: boolean
  onZoom: (factor: number) => void
  onFit: () => void
  onRestart?: () => void
  children?: React.ReactNode
}) {
  const { t } = usePanelI18n()
  return <div className='graph-camera-tools' role='group' aria-label={t('graphCameraControls')}>
    <Button variant='ghostIcon' size='icon' className='graph-camera-action' disabled={props.disabled} title={t('graphCameraZoomIn')} aria-label={t('graphCameraZoomIn')} onClick={() => props.onZoom(1.25)}><ZoomIn strokeWidth={1.5} aria-hidden='true' /></Button>
    <Button variant='ghostIcon' size='icon' className='graph-camera-action' disabled={props.disabled} title={t('graphCameraZoomOut')} aria-label={t('graphCameraZoomOut')} onClick={() => props.onZoom(.8)}><ZoomOut strokeWidth={1.5} aria-hidden='true' /></Button>
    <Button variant='ghostIcon' size='icon' className='graph-camera-action' disabled={props.disabled} title={t('graphCameraFit')} aria-label={t('graphCameraFit')} onClick={props.onFit}><Maximize2 strokeWidth={1.5} aria-hidden='true' /></Button>
    <Button variant='ghostIcon' size='icon' className='graph-camera-action' title={t(props.dark ? 'graphCameraLight' : 'graphCameraDark')} aria-label={t(props.dark ? 'graphCameraLight' : 'graphCameraDark')} onClick={props.onToggleDark}>{props.dark ? <Sun strokeWidth={1.5} aria-hidden='true' /> : <Moon strokeWidth={1.5} aria-hidden='true' />}</Button>
    {props.onFollowPage && <Button variant='ghostIcon' size='icon' className='graph-camera-action' title={t('graphCameraFollowPage')} aria-label={t('graphCameraFollowPage')} aria-pressed={props.followingPage === true} onClick={props.onFollowPage}><Monitor strokeWidth={1.5} aria-hidden='true' /></Button>}
    {props.onRestart && <Button variant='ghostIcon' size='icon' className='graph-camera-action' disabled={props.disabled} title={t('graphCameraReset')} aria-label={t('graphCameraReset')} onClick={props.onRestart}><RotateCcw strokeWidth={1.5} aria-hidden='true' /></Button>}
    {props.children}
  </div>
}

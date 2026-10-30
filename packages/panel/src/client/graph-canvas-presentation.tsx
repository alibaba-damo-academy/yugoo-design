import React from 'react'

// Approved v5 source hues, shared by both graph renderers and the source legend.
export const graphAmbientColors = ['#279e91', '#9866c9', '#d19141', '#3297b3', '#c66391', '#648acb', '#93aa39', '#b68c56', '#409db6', '#cc7954', '#8382c9', '#4f9f7b', '#74a5b8']
export const graphSourceColors = ['#4d9485', '#8d79b3', '#bb8e60', '#548ca8', '#b17992', '#798cbb', '#8a9b52', '#8c8170', '#668aa2', '#ac7c68', '#9291b8', '#79957b', '#8a9eaa']
export const graphDarkSourceColors = ['#65ceb8', '#b5a0dd', '#e2b78b', '#78b6d6', '#dca0bb', '#a3b5e3', '#b9d06f', '#c2ad8b', '#88b4d1', '#d8a38d', '#b1b0de', '#97c99a', '#adc8d8']

export interface GraphCanvasTheme {
  dark: boolean
  onToggleDark: () => void
}

/** Camera actions keep their position, order and appearance across 2D and 3D. */
export function GraphCameraTools(props: GraphCanvasTheme & {
  disabled?: boolean
  onZoom: (factor: number) => void
  onFit: () => void
  onRestart?: () => void
  children?: React.ReactNode
}) {
  return <div className='graph-camera-tools' role='group' aria-label='画布控件'>
    <button disabled={props.disabled} aria-label='放大图谱' onClick={() => props.onZoom(1.25)}>＋</button>
    <button disabled={props.disabled} aria-label='缩小图谱' onClick={() => props.onZoom(.8)}>－</button>
    <button disabled={props.disabled} onClick={props.onFit}>适应画布</button>
    <button onClick={props.onToggleDark}>画布切换到{props.dark ? '浅色' : '深色'}</button>
    {props.onRestart && <><button disabled={props.disabled} onClick={props.onRestart}>解除固定并重新布局</button><button disabled>拖动后固定 · 仅当前视图</button></>}
    {props.children}
  </div>
}

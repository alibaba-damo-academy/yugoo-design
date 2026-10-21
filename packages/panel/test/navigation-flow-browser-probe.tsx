import React, { useEffect } from 'react'
import { ReactFlow as ActualReactFlow, useStoreApi, type ReactFlowProps } from '@xyflow/react'
export * from '@xyflow/react'

type ProbeWindow = Window & {
  pageFlowSnapshot?: () => unknown
  pageFlowEvents?: unknown[]
  pageConnectionCallbacks?: unknown[]
}
function callback(kind: string, value: unknown) {
  const probe = window as ProbeWindow
  probe.pageConnectionCallbacks ??= []
  probe.pageConnectionCallbacks.push({ kind, time: performance.now(), value, flow: probe.pageFlowSnapshot?.() })
}

/** Mounted inside the real ReactFlow's existing provider, with no extra provider. */
function ObservePageFlow() {
  const store = useStoreApi()
  useEffect(() => {
    const probe = window as ProbeWindow
    const snapshot = () => {
      const state = store.getState()
      return { connectionMode: state.connectionMode, domNode: !!state.domNode, transform: state.transform,
        nodes: [...state.nodeLookup.values()].map(node => ({ id: node.id, measured: node.measured,
          sourceHandles: node.internals.handleBounds?.source, targetHandles: node.internals.handleBounds?.target })),
        edges: state.edges.map(edge => edge.id),
        connection: { inProgress: state.connection.inProgress, isValid: state.connection.isValid,
          from: state.connection.fromHandle, to: state.connection.toHandle } }
    }
    probe.pageFlowSnapshot = snapshot
    probe.pageFlowEvents = []
    let previous = ''
    const unsubscribe = store.subscribe(() => {
      const next = snapshot(), signature = JSON.stringify(next)
      if (signature !== previous) {
        previous = signature
        if (probe.pageFlowEvents!.length < 200) probe.pageFlowEvents!.push({ time: performance.now(), ...next })
      }
    })
    return () => { unsubscribe(); delete probe.pageFlowSnapshot }
  }, [store])
  return null
}

/** Test build alias: forward every prop/event while appending a read-only child. */
export function ReactFlow(props: ReactFlowProps) {
  return <ActualReactFlow {...props}
    onConnectStart={(event, params) => { callback('start', params); props.onConnectStart?.(event, params) }}
    onConnect={params => { callback('connect', params); props.onConnect?.(params) }}
    onConnectEnd={(event, state) => {
      callback('end', { isValid: state.isValid, from: state.fromNode?.id, to: state.toNode?.id })
      props.onConnectEnd?.(event, state)
    }}>
    {props.children}<ObservePageFlow />
  </ActualReactFlow>
}

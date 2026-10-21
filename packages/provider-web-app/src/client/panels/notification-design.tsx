import type { ReactElement } from 'react'
import {
  NotificationDesignPanel as NotificationDesignPanelView,
  type NotificationDesignItem,
  type NotificationDesignState,
} from '../ported/design/OfficialWebAppPanels/NotificationDesignPanel.tsx'
import { isRecord } from '../types.ts'

interface NotificationDesignPanelProps {
  draft: unknown
  onChange: (next: NotificationDesignState) => void
  running?: boolean
}

function notification(id: string, value: unknown): NotificationDesignItem | null {
  if (!isRecord(value)) return null
  return {
    id: typeof value.id === 'string' ? value.id : id,
    title: typeof value.title === 'string' ? value.title : '',
    trigger: typeof value.trigger === 'string' ? value.trigger : '',
    recipients: Array.isArray(value.recipients) ? value.recipients.map(String) : [],
    channels: Array.isArray(value.channels) ? value.channels.map(String) : [],
    message: typeof value.message === 'string' ? value.message : '',
    action_target: typeof value.action_target === 'string' ? value.action_target : '',
  }
}

function stateFromDraft(draft: unknown): NotificationDesignState {
  if (!isRecord(draft)) return { schema_version: 3, notifications: {}, notification_order: [] }
  const notifications = isRecord(draft.notifications)
    ? Object.fromEntries(Object.entries(draft.notifications).flatMap(([id, value]) => {
      const item = notification(id, value)
      return item === null ? [] : [[id, item]]
    }))
    : {}
  return {
    schema_version: 3,
    notifications,
    notification_order: Array.isArray(draft.notification_order)
      ? draft.notification_order.filter((id): id is string => typeof id === 'string')
      : Object.keys(notifications),
  }
}

/** Native notification-design editor bound to the persisted ordered catalog. */
export function NotificationDesignPanel({ draft, onChange, running }: NotificationDesignPanelProps): ReactElement {
  const state = stateFromDraft(draft)
  return (
    <NotificationDesignPanelView
      panel={state}
      disabled={running === true}
      onChange={(changes) => { onChange({ ...state, ...changes, schema_version: 3 }) }}
    />
  )
}

export default NotificationDesignPanel

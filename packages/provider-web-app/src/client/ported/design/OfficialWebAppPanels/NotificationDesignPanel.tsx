import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, MessageSquare, Plug, Plus, X } from 'lucide-react';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Input } from '../../ui/input.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { NativeDesignPanelContent, NativeDesignPanelFrame } from './NativeDesignPanelFrame.tsx';
import {
  createId,
  DeleteButton,
  DesignPanelAddButton,
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSidebar,
  EditablePanelTitle,
  EmptyPanel,
  ordered,
  Section,
  splitList,
  strings,
  text,
} from './panelPrimitives.tsx';

export interface NotificationDesignItem {
  id: string;
  title: string;
  trigger?: string;
  recipients?: string[];
  channels?: string[];
  message?: string;
  action_target?: string;
}

export interface NotificationDesignState {
  schema_version?: 3;
  notifications?: Record<string, NotificationDesignItem>;
  notification_order?: string[];
}

export interface NotificationDesignPanelProps {
  panel: NotificationDesignState;
  disabled: boolean;
  onChange: (changes: Partial<NotificationDesignState>) => void;
}

export const NotificationDesignPanel = ({
  panel,
  disabled,
  onChange,
}: NotificationDesignPanelProps) => {
  const notifications = useMemo(
    () => ordered(panel.notifications, panel.notification_order),
    [panel.notification_order, panel.notifications]
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    notifications[0]?.id ?? null
  );
  const [recipientDraft, setRecipientDraft] = useState('');
  const [externalChannelDraft, setExternalChannelDraft] = useState('');
  const [isAddingCustomChannel, setIsAddingCustomChannel] = useState(false);
  const pendingNotificationId = useRef<string | null>(null);
  const selected =
    notifications.find(item => item.id === selectedId) ??
    notifications[0] ??
    null;

  useEffect(() => {
    if (!selectedId || !notifications.some(item => item.id === selectedId)) {
      setSelectedId(notifications[0]?.id ?? null);
    }
  }, [notifications, selectedId]);

  useEffect(() => {
    setRecipientDraft('');
    setExternalChannelDraft('');
    setIsAddingCustomChannel(false);
  }, [selected?.id]);

  const update = (updates: Partial<NotificationDesignItem>) => {
    if (!selected) return;
    onChange({
      notifications: {
        ...panel.notifications,
        [selected.id]: { ...selected, ...updates },
      },
    });
  };

  const add = () => {
    const id = createId('notification');
    onChange({
      notifications: {
        ...panel.notifications,
        [id]: {
          id,
          title: `新通知 ${notifications.length + 1}`,
          trigger: '',
          recipients: [],
          channels: ['in_app'],
          message: '',
          action_target: '',
        },
      },
      notification_order: [...notifications.map(item => item.id), id],
    });
    pendingNotificationId.current = id;
    setSelectedId(id);
  };

  const remove = () => {
    if (!selected) return;
    const next = { ...(panel.notifications ?? {}) };
    delete next[selected.id];
    const order = notifications
      .map(item => item.id)
      .filter(id => id !== selected.id);
    onChange({ notifications: next, notification_order: order });
    setSelectedId(order[0] ?? null);
  };

  const recipients = strings(selected?.recipients);
  const channels = strings(selected?.channels);
  const externalChannels = channels.filter(channel => channel !== 'in_app');

  const addRecipients = () => {
    const additions = splitList(recipientDraft);
    if (!additions.length) return;
    update({ recipients: [...new Set([...recipients, ...additions])] });
    setRecipientDraft('');
  };

  const addExternalChannels = () => {
    const additions = splitList(externalChannelDraft);
    if (!additions.length) return;
    update({
      channels: [
        ...(channels.includes('in_app') ? ['in_app'] : []),
        ...new Set([...externalChannels, ...additions]),
      ],
    });
    setExternalChannelDraft('');
    setIsAddingCustomChannel(false);
  };

  const addInAppChannel = () => {
    if (!channels.includes('in_app')) {
      update({ channels: ['in_app', ...channels] });
    }
  };

  return (
    <NativeDesignPanelFrame autoSaveId='notification-design-panel-sidebar'>
      <DesignPanelSidebar
        icon={<Bell className='size-4 text-[var(--ds-text-7)]' />}
        title='通知'
        ariaLabel='产品通知'
      >
        {notifications.map(notification => {
          const isSelected = selected?.id === notification.id;
          return (
            <DesignPanelNavItem
              key={notification.id}
              aria-label={`切换到通知${notification.title}`}
              selected={isSelected}
              onClick={() => setSelectedId(notification.id)}
            >
              <strong className='block truncate'>{notification.title}</strong>
            </DesignPanelNavItem>
          );
        })}
        <DesignPanelAddButton disabled={disabled} onClick={add}>
          添加通知
        </DesignPanelAddButton>
      </DesignPanelSidebar>

      <NativeDesignPanelContent mode='scroll'>
        {!selected ? (
          <EmptyPanel message='还没有通知。只添加即使用户不在当前页面，也不能错过的重要提醒。' />
        ) : (
          <>
            <DesignPanelHeader>
              <EditablePanelTitle
                autoFocus={pendingNotificationId.current === selected.id}
                aria-label='当前通知名称'
                className='max-w-xl'
                value={selected.title}
                disabled={disabled}
                placeholder='例如：订单待审批'
                onFocus={() => {
                  if (pendingNotificationId.current === selected.id)
                    pendingNotificationId.current = null;
                }}
                onChange={event => update({ title: event.target.value })}
              />
              <DeleteButton
                label={`删除通知${selected.title}`}
                disabled={disabled}
                onClick={remove}
              />
            </DesignPanelHeader>

            <Section title='什么时候提醒？'>
              <Textarea
                aria-label='通知时机'
                className='min-h-24 max-w-3xl resize-y'
                value={text(selected.trigger)}
                disabled={disabled}
                placeholder='例如：订单进入待审批后立即提醒；2 小时仍未处理时再提醒一次。'
                onChange={event => update({ trigger: event.target.value })}
              />
            </Section>

            <Section title='提醒谁？'>
              <div className='max-w-3xl space-y-4'>
                <div>
                  <h3 className='text-sm font-semibold'>接收者</h3>
                  {recipients.length ? (
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {recipients.map(recipient => (
                        <span
                          key={recipient}
                          className='inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-[var(--ds-bg-gary-default)] px-2.5 py-1 text-sm'
                        >
                          <span className='truncate'>{recipient}</span>
                          <button
                            type='button'
                            aria-label={`移除接收者${recipient}`}
                            className='rounded-full p-0.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--hover))] hover:text-foreground'
                            disabled={disabled}
                            onClick={() =>
                              update({
                                recipients: recipients.filter(
                                  item => item !== recipient
                                ),
                              })
                            }
                          >
                            <X className='size-3.5' />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className='mt-1.5 text-sm text-[hsl(var(--muted-foreground))]'>
                      还没有接收者。
                    </p>
                  )}
                  <div className='mt-2 flex gap-2'>
                    <Input
                      aria-label='新接收者'
                      value={recipientDraft}
                      disabled={disabled}
                      placeholder='例如：订单创建人'
                      onChange={event => setRecipientDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        addRecipients();
                      }}
                    />
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='shrink-0 !text-sm'
                      disabled={disabled || !recipientDraft.trim()}
                      onClick={addRecipients}
                    >
                      添加
                    </Button>
                  </div>
                </div>

                <div className='border-t border-border pt-4'>
                  <h3 className='text-sm font-semibold'>通知方式</h3>
                  <div className='mt-2 grid gap-2 sm:grid-cols-2'>
                    {channels.map(channel => {
                      const isInApp = channel === 'in_app';
                      return (
                        <article
                          key={channel}
                          className='flex min-w-0 items-start gap-3 rounded-[var(--radius-sm)] border border-border bg-background p-3'
                        >
                          <span className='rounded-[var(--radius-sm)] bg-[var(--ds-bg-gary-default)] p-2'>
                            {isInApp ? (
                              <MessageSquare className='size-4' />
                            ) : (
                              <Plug className='size-4' />
                            )}
                          </span>
                          <span className='min-w-0 flex-1'>
                            <strong className='block truncate text-sm font-medium'>
                              {isInApp ? '应用内通知' : channel}
                            </strong>
                            <span className='mt-0.5 block text-sm text-[hsl(var(--muted-foreground))]'>
                              {isInApp
                                ? '产品内置'
                                : '需要 Plugin 或第三方服务'}
                            </span>
                          </span>
                          <button
                            type='button'
                            aria-label={`移除通知方式${
                              isInApp ? '应用内通知' : channel
                            }`}
                            className='rounded-full p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--hover))] hover:text-foreground'
                            disabled={disabled}
                            onClick={() =>
                              update({
                                channels: channels.filter(
                                  item => item !== channel
                                ),
                              })
                            }
                          >
                            <X className='size-4' />
                          </button>
                        </article>
                      );
                    })}

                    {isAddingCustomChannel ? (
                      <div className='min-h-20 rounded-[var(--radius-sm)] border border-dashed border-primary bg-background p-3'>
                        <div className='flex items-center justify-between gap-2'>
                          <strong className='text-sm font-medium'>
                            其他通知方式
                          </strong>
                          <button
                            type='button'
                            aria-label='取消添加其他通知方式'
                            className='rounded-full p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--hover))] hover:text-foreground'
                            onClick={() => {
                              setExternalChannelDraft('');
                              setIsAddingCustomChannel(false);
                            }}
                          >
                            <X className='size-4' />
                          </button>
                        </div>
                        <div className='mt-2 flex gap-2'>
                          <Input
                            autoFocus
                            aria-label='新通知方式名称'
                            value={externalChannelDraft}
                            disabled={disabled}
                            placeholder='例如：企业邮箱'
                            onChange={event =>
                              setExternalChannelDraft(event.target.value)
                            }
                            onKeyDown={event => {
                              if (event.key !== 'Enter') return;
                              event.preventDefault();
                              addExternalChannels();
                            }}
                          />
                          <Button
                            type='button'
                            size='sm'
                            variant='outline'
                            className='shrink-0 !text-sm'
                            disabled={disabled || !externalChannelDraft.trim()}
                            onClick={addExternalChannels}
                          >
                            添加
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type='button'
                            className='flex min-h-20 items-start gap-3 rounded-[var(--radius-sm)] border border-dashed border-border bg-background p-3 text-left hover:border-primary hover:bg-[hsl(var(--hover))]'
                            disabled={disabled}
                          >
                            <Plus className='mt-0.5 size-4 shrink-0' />
                            <span className='min-w-0 flex-1'>
                              <strong className='block text-sm font-medium'>
                                添加通知方式
                              </strong>
                              <span className='mt-0.5 block text-sm text-[hsl(var(--muted-foreground))]'>
                                应用内通知或其他方式
                              </span>
                            </span>
                            <ChevronDown className='mt-0.5 size-4 shrink-0 text-[hsl(var(--muted-foreground))]' />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align='start'
                          className='w-64'
                          sideOffset={4}
                        >
                          <DropdownMenuItem
                            className='cursor-pointer items-start gap-3 p-3'
                            disabled={channels.includes('in_app')}
                            onSelect={addInAppChannel}
                          >
                            <MessageSquare className='mt-0.5 size-4 shrink-0' />
                            <span>
                              <strong className='block text-sm font-medium'>
                                应用内通知
                              </strong>
                              <span className='mt-0.5 block text-sm text-[hsl(var(--muted-foreground))]'>
                                {channels.includes('in_app')
                                  ? '产品内置 · 已添加'
                                  : '产品内置 · 默认方式'}
                              </span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className='cursor-pointer items-start gap-3 p-3'
                            onSelect={() => setIsAddingCustomChannel(true)}
                          >
                            <Plug className='mt-0.5 size-4 shrink-0' />
                            <span>
                              <strong className='block text-sm font-medium'>
                                其他通知方式
                              </strong>
                              <span className='mt-0.5 block text-sm text-[hsl(var(--muted-foreground))]'>
                                需要 Plugin 或第三方服务
                              </span>
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>
            </Section>

            <Section title='提醒什么？'>
              <div className='grid max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]'>
                <div className='space-y-4'>
                  <label className='block text-sm'>
                    <span className='font-medium'>消息内容</span>
                    <Textarea
                      aria-label='通知消息内容'
                      className='mt-1.5 min-h-28 resize-y'
                      value={text(selected.message)}
                      disabled={disabled}
                      placeholder='例如：说明哪张订单需要审批、关键金额和提交人'
                      onChange={event =>
                        update({ message: event.target.value })
                      }
                    />
                  </label>
                  <label className='block text-sm'>
                    <span className='font-medium'>点击后去哪里？（可选）</span>
                    <Input
                      aria-label='通知行动入口'
                      className='mt-1.5'
                      value={text(selected.action_target)}
                      disabled={disabled}
                      placeholder='例如：订单详情的审批区域'
                      onChange={event =>
                        update({ action_target: event.target.value })
                      }
                    />
                  </label>
                </div>
                <aside className='self-start rounded-[var(--radius-sm)] border border-border bg-[var(--ds-bg-gary-default)] p-3'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='rounded-full bg-primary/10 p-2'>
                      <Bell className='size-4 text-primary' />
                    </span>
                    <strong className='truncate text-sm'>
                      {selected.title}
                    </strong>
                  </div>
                  <p className='mt-3 whitespace-pre-wrap text-sm leading-6'>
                    {text(selected.message) || '通知内容预览'}
                  </p>
                  {selected.action_target ? (
                    <span className='mt-3 block text-sm font-medium text-primary'>
                      {text(selected.action_target)} →
                    </span>
                  ) : null}
                </aside>
              </div>
            </Section>
          </>
        )}
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  );
};

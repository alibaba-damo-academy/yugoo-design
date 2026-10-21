import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../ui/cn.ts';
import { IconFont } from '../ui/icon-font.tsx';
import type { ITabOption } from './DesignTabs.tsx';
import { currentLanguage } from '../host.ts';

/**
 * DesignTabsBar - 设计子面板的浏览器 tab 式管理条（Chrome 标签条风格）。
 *
 * 布局：`[▾ 全部面板下拉（溢出时）] [ tab tab tab … ＋（横向可滚动） ]`
 * - 标签区：所有 tab 常驻并横向滚动，不折叠隐藏；激活 tab 自动滚动进可视
 *   范围，鼠标滚轮纵向滚动映射为横向滚动；＋ 紧跟最后一个 tab 一起滚动。
 * - 左侧「全部面板」下拉：仅在标签溢出时出现，列出**全部**面板供快速跳转。
 *
 * 该组件只做「哪些 tab 显示 / 滚动 / 跳转」与「+ 点击」，不负责选择器内容与消息发送。
 */
export interface IDesignTabsBarProps {
  value: string;
  onChange: (value: string) => void;
  options: ITabOption[];
  /** 点击右侧 + 按钮：打开新空面板（技能目录选择器）。 */
  onAddPanel: () => void;
  /** Disable new-skill engagement while the selected project is read-only. */
  addDisabled?: boolean;
  /** 在屏 tab 被 agent 更新的瞬时闪烁信号。 */
  flashTab?: { type: string; nonce: number } | null;
  className?: string;
}

const TabBadges: React.FC<{
  option: ITabOption;
  isActive: boolean;
  flash: { type: string; nonce: number } | null;
}> = ({ option, isActive, flash }) => {
  if (option.badge) {
    return (
      <span
        data-testid={`chat-design-tab-dirty-${option.value}`}
        className='dsh-design-tab-badge'
      />
    );
  }
  if (option.unread) {
    return (
      <span data-testid={`chat-design-tab-unread-${option.value}`} className='dsh-design-tab-new'>
        new
      </span>
    );
  }
  if (flash?.type === option.value) {
    return (
      <span
        key={flash.nonce}
        data-testid={`chat-design-tab-flash-${option.value}`}
        className='dsh-design-tab-new'
        data-flash
      >
        {currentLanguage() === 'zh_CN' ? '已更新' : 'updated'}
      </span>
    );
  }
  return null;
};

const TabButton: React.FC<{
  option: ITabOption;
  isActive: boolean;
  flash: { type: string; nonce: number } | null;
  onClick: () => void;
}> = ({ option, isActive, flash, onClick }) => (
  <button
    type='button'
    data-testid={`chat-design-tab-${option.value}`}
    data-state={isActive ? 'active' : 'inactive'}
    onClick={onClick}
    className={cn(
      'dsh-design-tab',
      option.icon && 'gap-2',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-6)]/20',
      !isActive &&
        'bg-transparent text-[var(--ds-text-7)] hover:text-[var(--ds-text-primary)]',
      isActive && 'text-[var(--ds-text-9)]'
    )}
  >
    {option.icon ? (
      <IconFont
        className={cn(
          'text-[14px]',
          isActive
            ? 'text-[var(--ds-text-primary)]'
            : 'text-[rgba(16,8,43,0.48)]'
        )}
        type={option.icon}
      />
    ) : null}
    <span className='overflow-hidden text-ellipsis whitespace-nowrap'>{option.label}</span>
    <TabBadges option={option} isActive={isActive} flash={flash} />
  </button>
);

export const DesignTabsBar: React.FC<IDesignTabsBarProps> = ({
  value,
  onChange,
  options,
  onAddPanel,
  flashTab,
  className,
  addDisabled,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // 在屏 tab 更新的瞬时闪烁（复用 DesignTabs 的 nonce 淡出）。
  const [flash, setFlash] = useState<{ type: string; nonce: number } | null>(
    null
  );
  useEffect(() => {
    if (!flashTab) return;
    setFlash(flashTab);
    const id = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(id);
  }, [flashTab?.type, flashTab?.nonce]);

  // 标签区是否溢出（决定是否显示「全部面板」下拉）。无布局环境（测试首帧）下
  // scrollWidth === clientWidth === 0 → 不溢出，不显示下拉。
  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    checkOverflow();
  }, [checkOverflow, options]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => checkOverflow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow]);

  // 激活 tab 始终滚动进可视范围（新预发 / 手动切换 / 下拉跳转后不被滚动位置藏住）。
  // rAF 等布局稳定后再滚，避免切换当帧量到旧布局导致不滚动。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>('[data-state="active"]')
        ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [value, options]);

  // 鼠标纵向滚轮 → 标签区横向滚动（trackpad 横向滚动走原生）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 关闭下拉：点击外部。
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setMenuOpen(false);
    },
    [onChange]
  );

  return (
    <div
      ref={rootRef}
      data-testid='chat-design-tabs'
      className={cn(
        'dsh-design-tabs',
        className
      )}
    >
      {/* 横向可滚动标签区：所有 tab 常驻，不折叠。隐藏滚动条。
          + 紧跟最后一个 tab（Chrome 风格），随标签一起滚动。 */}
      <div
        ref={scrollRef}
        className='dsh-design-tabs-scroll'
      >
        {options.map(option => (
          <TabButton
            key={option.value}
            option={option}
            isActive={option.value === value}
            flash={flash}
            onClick={() => handleSelect(option.value)}
          />
        ))}
        <button
          type='button'
          data-testid='chat-design-tabs-add'
          onClick={onAddPanel}
          disabled={addDisabled}
          title='新建设计面板'
          aria-label='新建设计面板'
          className={cn(
            'dsh-design-tabs-add',
            'disabled:cursor-not-allowed disabled:opacity-40',
            'text-[var(--ds-text-7)] hover:text-[var(--ds-text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-6)]/20'
          )}
        >
          <IconFont type='icon-line-operation-add' className='text-[14px]' />
        </button>
      </div>

      {/* 「全部面板」下拉：固定在最左侧（order-first），仅溢出时出现，列出全部
          面板供快速跳转。 */}
      {isOverflowing ? (
        <div className='dsh-design-tabs-more'>
          <button
            type='button'
            data-testid='chat-design-tabs-overflow'
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
            className={cn(
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-6)]/20',
              'text-[var(--ds-text-7)] hover:bg-[var(--ds-fill-3)] hover:text-[var(--ds-text-primary)]',
            )}
            title='全部面板'
          >
            <IconFont
              type='icon-line-operation-ellipsis'
              className='text-[14px]'
            />
          </button>
          {menuOpen ? (
            <div
              role='menu'
              data-testid='chat-design-tabs-overflow-menu'
              className='absolute left-0 top-full z-20 mt-1 max-h-[60vh] min-w-[180px] overflow-y-auto rounded-lg border border-[var(--ds-line-1)] bg-[var(--ds-fill-1)] py-1 shadow-lg'
            >
              {options.map(option => (
                <button
                  key={option.value}
                  type='button'
                  role='menuitem'
                  data-testid={`chat-design-tabs-overflow-item-${option.value}`}
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    'hover:bg-[var(--ds-fill-3)]',
                    option.value === value
                      ? 'text-[var(--ds-text-primary)]'
                      : 'text-[var(--ds-text-7)]'
                  )}
                >
                  {option.icon ? (
                    <IconFont type={option.icon} className='text-[14px]' />
                  ) : null}
                  <span className='truncate'>{option.label}</span>
                  {option.badge ? (
                    <span className='ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ds-icon-outline-muted)]' />
                  ) : option.unread ? (
                    <span className='ml-auto shrink-0 rounded-full bg-[var(--ds-brand-6)] px-1 text-[10px] leading-[14px] text-white'>
                      new
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
};

export default DesignTabsBar;

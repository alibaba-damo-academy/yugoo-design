import React from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { EllipsisTooltip } from '../../ui/ellipsis-tooltip.tsx';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { cn } from '../../ui/cn.ts';
export interface INavigationItem {
  id: string;
  title: string;
  [key: string]: unknown;
}

export const inputClass =
  'w-full rounded-[var(--input-radius)] border border-input bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';

export const textareaClass = `${inputClass} min-h-20 resize-y`;

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const ordered = <T extends { id: string }>(
  records: Record<string, T> | undefined,
  order: string[] | undefined
): T[] => {
  const source = records ?? {};
  const preferred = order ?? [];
  const seen = new Set(preferred);
  return [...preferred, ...Object.keys(source).filter(id => !seen.has(id))]
    .map(id => source[id])
    .filter(Boolean);
};

export const text = (value: unknown): string => String(value ?? '');
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

export const splitList = (value: string): string[] =>
  value
    .split(/[，,·]/)
    .map(item => item.trim())
    .filter(Boolean);

export const DesignPanelField = ({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <label className={cn('block text-sm', className)}>
    <span className='font-medium text-[var(--ds-text-primary)]'>{label}</span>
    {hint ? (
      <span className='ml-2 font-normal text-[var(--ds-text-secondary)]'>
        {hint}
      </span>
    ) : null}
    <span className='mt-1.5 block'>{children}</span>
  </label>
);

/** Backward-compatible name for ported panels; shares the canonical styling. */
export const FormField = DesignPanelField;

export const DesignPanelHeader = ({
  variant = 'detail',
  className,
  children,
}: {
  variant?: 'detail' | 'workspace';
  className?: string;
  children: React.ReactNode;
}) => (
  <header
    data-panel-header-variant={variant}
    className={cn(
      'flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ds-border-default)] bg-[var(--ds-bg-gary-default)] px-4',
      variant === 'detail' ? 'h-11' : 'min-h-12 py-2',
      className
    )}
  >
    {children}
  </header>
);

export const EditablePanelTitle = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<typeof Input>
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    data-panel-title='editable'
    className={cn(
      'h-8 min-w-0 max-w-xl flex-1 border-transparent bg-transparent px-0 text-sm font-semibold shadow-none hover:border-[var(--ds-border-default)] focus-visible:border-[var(--ds-border-default)] focus-visible:bg-background focus-visible:px-2',
      className
    )}
    {...props}
  />
));
EditablePanelTitle.displayName = 'EditablePanelTitle';

export const DesignPanelSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'focus-brand-ring h-9 w-full rounded-[var(--input-radius)] border border-input bg-background px-2.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
DesignPanelSelect.displayName = 'DesignPanelSelect';

export const DesignPanelTitle = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <strong
    data-panel-title='static'
    className={cn(
      'block truncate text-sm font-semibold text-[var(--ds-text-primary)]',
      className
    )}
  >
    {children}
  </strong>
);

export const DesignPanelHeaderText = ({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) => (
  <div className='min-w-0'>
    <DesignPanelTitle>{title}</DesignPanelTitle>
    {subtitle ? (
      <span className='block truncate text-sm text-[var(--ds-text-secondary)]'>
        {subtitle}
      </span>
    ) : null}
  </div>
);

export const EmptyPanel = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center p-8 text-sm text-[hsl(var(--muted-foreground))]'>
    {message}
  </div>
);

const SidebarIcon = ({ children }: { children: React.ReactNode }) => {
  const sizedIcon = React.isValidElement<{ style?: React.CSSProperties }>(
    children
  )
    ? React.cloneElement(children, {
        style: {
          ...children.props.style,
          width: 16,
          height: 16,
          flexShrink: 0,
        },
      })
    : children;

  return (
    <span className='flex size-4 shrink-0 items-center justify-center'>
      {sizedIcon}
    </span>
  );
};

export const DesignPanelSidebar = ({
  icon,
  title,
  children,
  ariaLabel = title,
  navClassName,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  ariaLabel?: string;
  navClassName?: string;
}) => (
  <aside className='flex h-full min-h-0 flex-col overflow-hidden p-4 pt-3'>
    <div className='flex shrink-0 items-center gap-2 pb-3 text-sm text-[var(--ds-text-9)]'>
      <SidebarIcon>{icon}</SidebarIcon>
      <EllipsisTooltip>{title}</EllipsisTooltip>
    </div>
    <nav
      className={cn(
        'min-h-0 flex-1 space-y-1 overflow-y-auto pr-1',
        navClassName
      )}
      aria-label={ariaLabel}
    >
      {children}
    </nav>
  </aside>
);

export const DesignPanelNavItem = ({
  selected = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
}) => (
  <button
    type='button'
    aria-current={selected ? 'page' : undefined}
    className={cn(
      'focus-brand-ring flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-[500] transition-colors disabled:cursor-not-allowed disabled:opacity-60 [&_strong]:font-[500] [&_svg]:!size-4 [&_svg]:shrink-0',
      selected
        ? 'bg-[#F3F0FF] text-[#10082B]'
        : 'text-[var(--ds-text-primary)] hover:bg-[var(--ds-bg-gary-hover)]',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

export const DesignPanelAddButton = ({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <Button
    type='button'
    variant='ghost'
    className={cn(
      'h-9 w-full justify-start rounded-lg px-2 py-2 text-sm font-normal text-[var(--ds-text-secondary)] hover:bg-[var(--ds-bg-gary-hover)]',
      className
    )}
    {...props}
  >
    <Plus className='!h-3.5 !w-3.5 shrink-0' />
    <span className='truncate'>{children}</span>
  </Button>
);

export const DesignPanelTreeBranch = ({
  isLast,
  children,
}: {
  isLast: boolean;
  children: React.ReactNode;
}) => (
  <div className='relative'>
    <div
      className={cn(
        'pointer-events-none absolute -left-4 top-[-10px] w-px bg-[var(--ds-border-default)]',
        isLast ? 'h-[28px]' : 'h-[calc(100%+4px)]'
      )}
    />
    <div className='pointer-events-none absolute -left-4 top-[18px] h-3 w-4 -translate-y-1/2 rounded-bl-[12px] border-b border-l border-[var(--ds-border-default)]' />
    {children}
  </div>
);

export const DesignPanelNavGroup = ({
  expanded,
  selected = false,
  label,
  ariaLabel,
  trailing,
  children,
  onSelect,
  onToggle,
}: {
  expanded: boolean;
  selected?: boolean;
  label: React.ReactNode;
  ariaLabel?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  onSelect: () => void;
  onToggle: () => void;
}) => {
  const items = React.Children.toArray(children);
  return (
    <div>
      <div className='flex min-h-9 w-full items-stretch gap-0.5'>
        <button
          type='button'
          aria-label={ariaLabel ? `${ariaLabel} toggle` : 'Toggle group'}
          aria-expanded={expanded}
          onClick={onToggle}
          className='focus-brand-ring flex w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ds-text-tertiary)] transition-colors hover:bg-[var(--ds-bg-gary-hover)]'
        >
          {expanded ? (
            <ChevronDown className='h-4 w-4' />
          ) : (
            <ChevronRight className='h-4 w-4' />
          )}
        </button>
        <DesignPanelNavItem
          selected={selected}
          aria-label={ariaLabel}
          className='min-w-0 flex-1 px-2'
          onClick={onSelect}
        >
          <span className='min-w-0 flex-1 truncate'>{label}</span>
          {trailing ? (
            <span className='ml-1 flex shrink-0 items-center'>{trailing}</span>
          ) : null}
        </DesignPanelNavItem>
      </div>
      {expanded ? (
        <div className='relative ml-4 pl-4'>
          {items.map((item, index) => (
            <DesignPanelTreeBranch
              key={(item as React.ReactElement).key ?? index}
              isLast={index === items.length - 1}
            >
              {item}
            </DesignPanelTreeBranch>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const Sidebar = ({
  icon,
  title,
  items,
  selectedId,
  disabled,
  addLabel,
  onSelect,
  onAdd,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  items: INavigationItem[];
  selectedId: string | null;
  disabled: boolean;
  addLabel: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  subtitle?: (item: INavigationItem) => string;
}) => (
  <DesignPanelSidebar icon={icon} title={title}>
    {items.map(item => (
      <DesignPanelNavItem
        key={item.id}
        selected={selectedId === item.id}
        onClick={() => onSelect(item.id)}
      >
        <span className='min-w-0 flex-1'>
          <strong className='block truncate text-sm'>{item.title}</strong>
          {subtitle ? (
            <span className='mt-1 block line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]'>
              {subtitle(item)}
            </span>
          ) : null}
        </span>
      </DesignPanelNavItem>
    ))}
    <DesignPanelAddButton disabled={disabled} onClick={onAdd}>
      {addLabel}
    </DesignPanelAddButton>
  </DesignPanelSidebar>
);

export const DesignPanelSection = ({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className='space-y-3 border-b border-[var(--ds-border-default)] p-4 last:border-b-0'>
    <div className='flex items-start justify-between gap-3'>
      <div>
        <h3 className='text-sm font-semibold'>{title}</h3>
        {description ? (
          <p className='mt-1 text-sm text-[hsl(var(--muted-foreground))]'>
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** Backward-compatible name for ported panels; shares the canonical styling. */
export const Section = DesignPanelSection;

interface IDeleteButtonProps {
  label: string;
  disabled: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  compact?: boolean;
}

export const DeleteButton = React.forwardRef<HTMLButtonElement, IDeleteButtonProps>(({
  label,
  disabled,
  onClick,
  compact = false,
}, ref) => (
  <Button
    ref={ref}
    type='button'
    size='icon'
    variant='ghost'
    aria-label={label}
    disabled={disabled}
    className={cn(compact && 'h-7 w-7 shrink-0', '[&_svg]:!h-4 [&_svg]:!w-4')}
    onClick={onClick}
  >
    <Trash2 aria-hidden='true' />
  </Button>
));

DeleteButton.displayName = 'DeleteButton';

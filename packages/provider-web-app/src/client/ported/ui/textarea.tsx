import * as React from 'react';

import { cn } from './cn.ts';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * 随内容自动增高：输入或受控 value 变化时把高度设为 scrollHeight，
   * 去掉手动拉伸手柄与滚动条（min-height 仍作为下限）。默认关闭，不影响既有用法。
   */
  autoResize?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref)
          (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current =
            node;
      },
      [ref]
    );

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el || !autoResize) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, [autoResize]);

    // 受控 value 变化后重算高度（外部更新 / 首帧 / 清空都覆盖）。
    React.useLayoutEffect(() => {
      resize();
    }, [resize, props.value, props.defaultValue]);

    return (
      <textarea
        className={cn(
          'focus-brand-ring flex min-h-[60px] w-full rounded-lg border border-[var(--ds-fill-5)] bg-[#fff] px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          autoResize && 'resize-none overflow-hidden',
          className
        )}
        ref={setRefs}
        onChange={event => {
          onChange?.(event);
          resize();
        }}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };

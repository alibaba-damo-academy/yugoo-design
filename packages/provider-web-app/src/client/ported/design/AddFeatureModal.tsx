import React, { useCallback, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog.tsx';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.tsx';
import { Button } from '../ui/button.tsx';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../ui/form.tsx';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLang } from '../host.ts';
import { IconFont } from '../ui/icon-font.tsx';

interface IAddFeatureModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: IFeatureFormData) => void;
  /**
   * dsh adaptation: the original sends the request into the chat via the
   * chat store (with a hidden context payload); the panel adapter routes
   * the same prompt text through `sendPrompt`.
   */
  onSendPrompt?: (text: string) => void;
}

export interface IFeatureFormData {
  function_name: string;
  function_description: string;
  priority: 'High' | 'Medium' | 'Low';
}

/**
 * 防抖函数
 * @param func 要防抖的函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * 新增功能模态框组件
 *
 * 功能特性:
 * - 功能名称输入（必填）
 * - 功能描述文本域（必填）
 * - 优先级选择器（必填）
 * - AI智能添加按钮
 * - 使用 react-hook-form + zod + ui/form 进行表单验证
 * - 提交防抖，防止重复提交
 */
const AddFeatureModal: React.FC<IAddFeatureModalProps> = ({
  open,
  onClose,
  onSubmit,
  onSendPrompt,
}) => {
  const t = useLang();
  // 表单验证规则
  const formSchema = useMemo(() => {
    return z.object({
      function_name: z
        .string()
        .min(1, { message: t.function_name_placeholder }),
      function_description: z
        .string()
        .min(1, { message: t.function_description_placeholder }),
      priority: z.enum(['High', 'Medium', 'Low'], {
        error: t.priorities_placeholder,
      }),
    });
  }, [t]);
  const form = useForm<IFeatureFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      function_name: '',
      function_description: '',
      priority: 'Medium',
    },
    mode: 'onChange',
  });

  const isSubmittingRef = useRef(false);

  const handleClose = () => {
    form.reset();
    isSubmittingRef.current = false;
    onClose();
  };

  // 防抖处理函数
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleFormSubmit = useCallback(
    debounce((data: IFeatureFormData) => {
      // 防止重复提交
      if (isSubmittingRef.current) {
        return;
      }

      isSubmittingRef.current = true;

      try {
        // onSubmit?.(data);
        try {
          // dsh 的 sendPrompt 没有 hidden context 通道，原实现随消息附带的
          // new_function 上下文改为直接写进提示文本。
          const priorityLabel =
            data.priority === 'High'
              ? t.priority_high
              : data.priority === 'Medium'
                ? t.priority_medium
                : t.priority_low;
          onSendPrompt?.(
            `${t.new_function_added}: ${data.function_name}（${t.function_priority_label}：${priorityLabel}）\n${data.function_description}`
          );
          handleClose();
        } catch {
          // submission failed; the modal stays open for retry
        }
      } finally {
        // 延迟重置提交状态，确保防抖期间不会重复提交
        setTimeout(() => {
          isSubmittingRef.current = false;
        }, 1000);
      }
    }, 500), // 500ms 防抖延迟
    []
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className='max-w-[684px]'
        style={{
          borderRadius: '12px',
          boxShadow:
            '0px 4px 14px 0px rgba(0, 0, 0, 0.1), 0px 0px 1px 0px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* 标题区域 */}
        <DialogHeader>
          <div className='flex items-center justify-between'>
            <DialogTitle>{t.add_function_label}</DialogTitle>
          </div>
        </DialogHeader>

        {/* 表单内容区域 */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)}>
            <div className='space-y-4'>
              {/* 功能名称 */}
              <FormField
                control={form.control}
                name='function_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-sm font-normal'>
                      <span className='text-[var(--ds-error-6)]'>*</span>{' '}
                      <span className='text-[rgba(0,0,0,0.88)]'>
                        {t.function_name}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t.function_name_placeholder}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 功能描述 */}
              <FormField
                control={form.control}
                name='function_description'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-sm font-normal'>
                      <span className='text-[var(--ds-error-6)]'>*</span>{' '}
                      <span className='text-[rgba(0,0,0,0.88)]'>
                        {t.function_description_label}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t.function_description_placeholder}
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 优先级 */}
              <FormField
                control={form.control}
                name='priority'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-sm font-normal'>
                      <span className='text-[var(--ds-error-6)]'>*</span>{' '}
                      <span className='text-[rgba(0,0,0,0.88)]'>
                        {t.function_priority_label}
                      </span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className='bg-[#fff] rounded-[8px] border-[var(--ds-fill-5)] shadow-none'>
                          <SelectValue placeholder={t.priorities_placeholder} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className='z-modal'>
                        <SelectItem
                          className='z-modal  hover:bg-accent hover:text-accent-foreground'
                          value='High'
                        >
                          {t.priority_high}
                        </SelectItem>
                        <SelectItem
                          className='z-modal  hover:bg-accent hover:text-accent-foreground'
                          value='Medium'
                        >
                          {t.priority_medium}
                        </SelectItem>
                        <SelectItem
                          className='z-modal hover:bg-accent hover:text-accent-foreground'
                          value='Low'
                        >
                          {t.priority_low}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* 底部按钮区域 */}
            <DialogFooter className=''>
              <div className='flex items-center justify-end gap-3 w-full'>
                <Button type='button' variant='outline' onClick={handleClose}>
                  {t.button_cancel}
                </Button>
                <Button
                  type='submit'
                  disabled={!form.formState.isValid || isSubmittingRef.current}
                >
                  <IconFont type='icon-MagicWandLine' />
                  {t.ai_intelligent_add}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddFeatureModal;

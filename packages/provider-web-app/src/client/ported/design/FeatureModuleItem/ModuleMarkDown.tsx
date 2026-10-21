import React, { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import MarkdownChart from './MarkdownChart.tsx';
export interface IModuleMarkDownProps {
  children: string;
  className?: string;
}

// 缓存插件配置，避免每次渲染重新创建
const remarkPlugins = [remarkGfm, remarkBreaks];
const rehypePlugins = [rehypeRaw];

const ModuleMarkDown = memo<IModuleMarkDownProps>(
  ({ children, className = '' }) => {
    // 处理 Markdown 粗体格式的预处理逻辑
    const processedChildren = useMemo(() => {
      let processedText = children;

      // 修复各种粗体格式问题，确保 react-markdown 能正确解析
      // 包括：**"text"**、**.csv**、**text** 等各种情况

      // 1. 清理和标准化所有粗体标记
      processedText = processedText.replace(
        /\*\*([^*\r\n]+?)\*\*/g,
        (_, content) => {
          // 清理内容，保持原有格式但去除首尾多余空格
          const cleanContent = content.trim();
          return `**${cleanContent}**`;
        }
      );

      // 2. 只对包含特殊符号的粗体文本进行前后空格分隔处理
      // 特殊符号包括：引号、括号、逗号等可能影响解析的字符
      processedText = processedText.replace(
        /([^\s])\*\*([^*\r\n]*["'"'".]+[^*\r\n]*)\*\*([^\s])/g,
        (_, before, content, after) => {
          // 只有包含特殊符号的粗体文本才添加前后空格
          return `${before} **${content.trim()}** ${after}`;
        }
      );

      // 3. 连续 URL 中间只有顿号/逗号时，GFM autolink 容易把后一个 URL
      // 拼进前一个 href。补一个空格让 Markdown 正确识别为两个独立链接。
      processedText = processedText.replace(
        /(https?:\/\/[^\s，,、]+)([，,、])(?=https?:\/\/)/g,
        '$1$2 '
      );

      // 4. 确保列表前有空行：模型常把「标题/正文 + 紧跟的 - 列表」写成单换行，
      // remarkBreaks 会渲染成一坨段落而非真正的 <ul>。在第一项前插入空行，
      // 让 gfm 正确解析成列表。
      processedText = processedText.replace(
        /([^\n])\n(\s*[-*+] )/g,
        '$1\n\n$2'
      );

      return processedText;
    }, [children]);

    return (
      <>
        <style>
          {`
            .module-markdown ol, ul, menu {
              line-height: 1
            }
            .module-markdown ol, ul{
              display:flex;
              flex-direction:column
            }
            .module-markdown li{
              line-height: 2
            }
            .module-markdown img{
              max-width: 100%;
              height: auto;
              border-radius: 8px;
              margin: 8px 0
            }
            .module-markdown table{
              width: 100%;
              border-collapse: collapse;
              margin: 8px 0;
              font-size: 13px
            }
            .module-markdown th, .module-markdown td{
              border: 1px solid #ECEBEE;
              padding: 6px 10px;
              text-align: left
            }
            .module-markdown th{ background:#F7F5FF }
            /* PPT-style conclusion kit */
            .module-markdown .kpi-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin:10px 0 }
            .module-markdown .kpi{ border:1px solid #ECEBEE; border-radius:10px; padding:12px; text-align:center; background:linear-gradient(180deg,#F7F5FF,#fff) }
            .module-markdown .kpi b{ display:block; font-size:22px; color:#663AE8; line-height:1.2 }
            .module-markdown .kpi span{ font-size:12px; color:#6b6b78 }
            .module-markdown .cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin:10px 0 }
            .module-markdown .card{ border:1px solid #ECEBEE; border-radius:10px; padding:12px; background:#fff }
            .module-markdown .card h4{ margin:0 0 4px; font-size:13px; color:#10082B }
            .module-markdown .card p{ margin:0; font-size:12px; color:#6b6b78 }
            .module-markdown .ccl-title{ font-size:16px; font-weight:600; color:#10082B; margin:4px 0 }
        `}
        </style>
        <div
          className={`module-markdown ${className}`}
          style={{
            fontFamily: 'var(--font-main)',
            background: '#FFF',
          }}
        >
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={{
              a: ({ children: linkChildren, ...props }) => (
                <a {...props} target='_blank' rel='noopener noreferrer'>
                  {linkChildren}
                </a>
              ),
              // ```chart 围栏 → recharts；其余代码块保持原样
              code: ({ className, children, ...props }) => {
                if (/\blanguage-chart\b/.test(className ?? '')) {
                  const raw = String(children ?? '');
                  return (
                    <MarkdownChart
                      raw={raw}
                      fallback={<code className={className}>{children}</code>}
                    />
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
            skipHtml={false}
          >
            {processedChildren}
          </ReactMarkdown>
        </div>
      </>
    );
  }
);

ModuleMarkDown.displayName = 'ModuleMarkDown';

export default ModuleMarkDown;

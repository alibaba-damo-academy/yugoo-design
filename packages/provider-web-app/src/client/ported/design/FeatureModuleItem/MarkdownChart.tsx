import React, { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * 把 conclusion / findings markdown 里的 ```chart 围栏渲染成图表。
 * 模型只需写一小段 JSON spec（bar / line / radar / pie），FE 用 recharts 本地绘制。
 * 解析失败时回退成原始代码块，绝不抛错把整份报告搞崩。
 */
export interface IChartSpec {
  type: 'bar' | 'line' | 'radar' | 'pie';
  title?: string;
  data: Array<Record<string, string | number>>;
  /** 分类轴字段名，默认 name */
  x?: string;
  /** 数值系列字段名（bar/line/radar）；pie 用 value */
  series?: string[];
}

const COLORS = [
  '#663AE8',
  '#22B07D',
  '#E8973A',
  '#3A8FE8',
  '#D14B7A',
  '#9B59B6',
];

const Box: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className='my-3 rounded-lg border border-[#ECEBEE] bg-white p-3'>
    {title && (
      <div className='mb-2 text-sm font-medium text-[#10082B]'>{title}</div>
    )}
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  </div>
);

const MarkdownChart = memo<{ raw: string; fallback: React.ReactNode }>(
  ({ raw, fallback }) => {
    const spec = useMemo<IChartSpec | null>(() => {
      try {
        const s = JSON.parse(raw) as IChartSpec;
        if (!s?.type || !Array.isArray(s.data) || s.data.length === 0)
          return null;
        return s;
      } catch {
        return null;
      }
    }, [raw]);

    if (!spec) return <>{fallback}</>;

    const x = spec.x || 'name';
    const series = spec.series?.length ? spec.series : ['value'];

    if (spec.type === 'bar') {
      return (
        <Box title={spec.title}>
          <BarChart data={spec.data}>
            <CartesianGrid strokeDasharray='3 3' stroke='#F0EFF3' />
            <XAxis dataKey={x} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                fill={COLORS[i % COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </Box>
      );
    }
    if (spec.type === 'line') {
      return (
        <Box title={spec.title}>
          <LineChart data={spec.data}>
            <CartesianGrid strokeDasharray='3 3' stroke='#F0EFF3' />
            <XAxis dataKey={x} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {series.length > 1 && <Legend />}
            {series.map((k, i) => (
              <Line
                key={k}
                type='monotone'
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
              />
            ))}
          </LineChart>
        </Box>
      );
    }
    if (spec.type === 'radar') {
      return (
        <Box title={spec.title}>
          <RadarChart data={spec.data}>
            <PolarGrid />
            <PolarAngleAxis dataKey={x} tick={{ fontSize: 12 }} />
            {series.length > 1 && <Legend />}
            {series.map((k, i) => (
              <Radar
                key={k}
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.25}
              />
            ))}
          </RadarChart>
        </Box>
      );
    }
    // pie
    return (
      <Box title={spec.title}>
        <PieChart>
          <Tooltip />
          <Pie
            data={spec.data}
            dataKey={series[0]}
            nameKey={x}
            outerRadius={90}
            label
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </Box>
    );
  }
);

MarkdownChart.displayName = 'MarkdownChart';

export default MarkdownChart;

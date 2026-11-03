'use client';

// Charts follow the dataviz rules: fixed categorical order, 2px lines, thin bars with 4px
// rounded ends, hairline solid grid, one y-axis, a legend for 2+ series, hover tooltips.
import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

const VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8', '--line', '--muted', '--ink', '--ink-2', '--surface', '--axis'];

// Light-mode values, used until the page's CSS variables are read (no black first paint).
const LIGHT: Record<string, string> = {
  '--series-1': '#2a78d6', '--series-2': '#eb6834', '--series-3': '#1baf7a', '--series-4': '#eda100',
  '--series-5': '#e87ba4', '--series-6': '#008300', '--series-7': '#6250d6', '--series-8': '#e34948',
  '--line': '#e1e0d9', '--muted': '#898781', '--ink': '#0b0b0b', '--ink-2': '#52514e', '--surface': '#fcfcfb', '--axis': '#c3c2b7',
};

function useTheme() {
  const [c, setC] = useState<Record<string, string>>(LIGHT);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      setC(Object.fromEntries(VARS.map((v) => [v, s.getPropertyValue(v).trim() || LIGHT[v]])));
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  }, []);
  return c;
}

const euro = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : `${Math.round(a)}`;
  return `${n < 0 ? '-' : ''}€${s}`;
};
const euroFull = (n: number) => n.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ background: p.color }} aria-hidden />
          <span className="num font-semibold text-ink">{euroFull(Number(p.value))}</span>
          <span className="text-ink-2">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

const axisProps = (c: Record<string, string>) => ({
  tick: { fill: c['--muted'], fontSize: 12 },
  axisLine: { stroke: c['--axis'] },
  tickLine: false,
});

type Datum = Record<string, number | string>;

export function GroupedBars({ data, series, height = 260 }: { data: Datum[]; series: { key: string; label: string }[]; height?: number }) {
  const c = useTheme();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--line']} />
          <XAxis dataKey="label" {...axisProps(c)} />
          <YAxis tickFormatter={euro} width={52} {...axisProps(c)} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: c['--line'], opacity: 0.4 }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} itemSorter={(item: any) => series.findIndex((s) => s.key === item.dataKey)} formatter={(value: string) => <span style={{ color: c['--ink-2'] }}>{value}</span>} />
          {series.map((s, i) => (
            <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} fill={c[`--series-${i + 1}`]} maxBarSize={24} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackedBars({ data, series, height = 280 }: { data: Datum[]; series: { key: string; label: string }[]; height?: number }) {
  const c = useTheme();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--line']} />
          <XAxis dataKey="label" {...axisProps(c)} />
          <YAxis tickFormatter={euro} width={52} {...axisProps(c)} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: c['--line'], opacity: 0.4 }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} itemSorter={(item: any) => series.findIndex((s) => s.key === item.dataKey)} formatter={(value: string) => <span style={{ color: c['--ink-2'] }}>{value}</span>} />
          {series.map((s, i) => (
            <Bar isAnimationActive={false}
              key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={c[`--series-${i + 1}`]} maxBarSize={28}
              stroke={c['--surface']} strokeWidth={2}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SingleLine({ data, dataKey, label, height = 220 }: { data: Datum[]; dataKey: string; label: string; height?: number }) {
  const c = useTheme();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--line']} />
          <XAxis dataKey="label" {...axisProps(c)} />
          <YAxis tickFormatter={euro} width={56} {...axisProps(c)} axisLine={false} />
          <ReferenceLine y={0} stroke={c['--axis']} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: c['--muted'], strokeWidth: 1 }} />
          <Line isAnimationActive={false}
            type="monotone" dataKey={dataKey} name={label} stroke={c['--series-1']} strokeWidth={2}
            dot={{ r: 4, fill: c['--series-1'], stroke: c['--surface'], strokeWidth: 2 }} activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HorizontalBars({ data, height }: { data: { label: string; value: number }[]; height?: number }) {
  const c = useTheme();
  return (
    <div style={{ height: height ?? Math.max(120, data.length * 30 + 20) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={c['--line']} />
          <XAxis type="number" tickFormatter={euro} {...axisProps(c)} />
          <YAxis type="category" dataKey="label" width={150} {...axisProps(c)} axisLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: c['--line'], opacity: 0.4 }} />
          <Bar isAnimationActive={false}
            dataKey="value" name="Paid" fill={c['--series-1']} maxBarSize={18} radius={[0, 4, 4, 0]}
            label={{ position: 'right', fill: c['--ink-2'], fontSize: 12, formatter: (v: any) => euro(Number(v)) }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const fmtDaily = (n: number, format: 'eur' | 'count') => (format === 'eur'
  ? n.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
  : n.toLocaleString('en-IE'));

function DailyTip({ active, payload, label, name, format, color }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink-2">{label}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} aria-hidden />
        <span className="num font-semibold text-ink">{fmtDaily(Number(payload[0].value), format)}</span>
        <span className="text-ink-2">{name}</span>
      </p>
    </div>
  );
}

// One series of daily bars, in euros (cents shown) or as a plain count. Used by the Ads page.
export function DailyBars({ data, dataKey, label, format = 'eur', color = 1, height = 200 }: {
  data: Datum[]; dataKey: string; label: string; format?: 'eur' | 'count'; color?: number; height?: number;
}) {
  const c = useTheme();
  const fill = c[`--series-${color}`];
  const tick = (n: number) => (format === 'eur' ? `€${n >= 1000 ? `${Math.round(n / 100) / 10}K` : Math.round(n)}` : String(n));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--line']} />
          <XAxis dataKey="label" {...axisProps(c)} minTickGap={12} />
          <YAxis tickFormatter={tick} width={44} allowDecimals={format === 'eur'} {...axisProps(c)} axisLine={false} />
          <Tooltip content={<DailyTip name={label} format={format} color={fill} />} cursor={{ fill: c['--line'], opacity: 0.4 }} />
          <Bar isAnimationActive={false} dataKey={dataKey} name={label} fill={fill} maxBarSize={28} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

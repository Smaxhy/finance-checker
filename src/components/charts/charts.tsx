"use client";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

function compactMoney(v: number, currency = "EUR") {
  return formatMoney(v, currency, { compact: Math.abs(v) >= 10_000, decimals: 0 });
}

interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  currency,
  labelFormatter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: SeriesDef[];
  currency: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card min-w-36 px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-medium text-fg">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p || p.value === undefined || p.value === null) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-secondary">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular font-medium text-fg">{formatMoney(Number(p.value), currency)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[12px] text-secondary">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface BarDatum {
  label: string;
  tooltipLabel?: string;
  value: number;
  [k: string]: string | number | undefined;
}

export function SpendBarChart({
  data,
  currency = "EUR",
  height = 220,
  color = "var(--chart-spend)",
  name = "Spent",
}: {
  data: BarDatum[];
  currency?: string;
  height?: number;
  color?: string;
  name?: string;
}) {
  const series = [{ key: "value", label: name, color }];
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={56} tickFormatter={(v) => compactMoney(v, currency)} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", radius: 6 }}
            content={(p) => (
              <ChartTooltip
                active={p.active}
                payload={p.payload}
                label={p.label}
                series={series}
                currency={currency}
                labelFormatter={(l) => (data.find((d) => d.label === l)?.tooltipLabel as string) ?? l}
              />
            )}
          />
          <Bar dataKey="value" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive animationDuration={500} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Daily / weekly / monthly switcher around SpendBarChart. */
export function SpendingTrend({
  datasets,
  currency = "EUR",
  height = 230,
}: {
  datasets: { key: string; label: string; data: BarDatum[]; caption: string }[];
  currency?: string;
  height?: number;
}) {
  const [active, setActive] = useState(datasets[0]?.key);
  const current = datasets.find((d) => d.key === active) ?? datasets[0];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{current?.caption}</p>
        <div className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border" role="tablist" aria-label="Chart period">
          {datasets.map((d) => (
            <button
              key={d.key}
              role="tab"
              aria-selected={d.key === active}
              onClick={() => setActive(d.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-150",
                d.key === active ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-secondary",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {current ? <SpendBarChart key={current.key} data={current.data} currency={currency} height={height} /> : null}
    </div>
  );
}

export function CumulativeCompareChart({
  data,
  currency = "EUR",
  height = 220,
  currentLabel = "This month",
  previousLabel = "Last month",
}: {
  data: { day: number; current?: number; previous?: number }[];
  currency?: string;
  height?: number;
  currentLabel?: string;
  previousLabel?: string;
}) {
  const series = [
    { key: "current", label: currentLabel, color: "var(--chart-spend)" },
    { key: "previous", label: previousLabel, color: "var(--chart-muted)" },
  ];
  return (
    <div>
      <div className="mb-2">
        <Legend series={series} />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={56} tickFormatter={(v) => compactMoney(v, currency)} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} currency={currency} labelFormatter={(l) => `Day ${l}`} />}
            />
            <Line type="monotone" dataKey="previous" stroke="var(--chart-muted)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} strokeLinecap="round" />
            <Line type="monotone" dataKey="current" stroke="var(--chart-spend)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} strokeLinecap="round" connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function IncomeExpenseChart({
  data,
  currency = "EUR",
  height = 240,
}: {
  data: { label: string; income: number; spent: number }[];
  currency?: string;
  height?: number;
}) {
  const series = [
    { key: "income", label: "Income", color: "var(--chart-income)" },
    { key: "spent", label: "Spending", color: "var(--chart-spend)" },
  ];
  return (
    <div>
      <div className="mb-2">
        <Legend series={series} />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={56} tickFormatter={(v) => compactMoney(v, currency)} />
            <Tooltip cursor={{ fill: "var(--surface-2)", radius: 6 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} series={series} currency={currency} />} />
            <Bar dataKey="income" name="Income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar dataKey="spent" name="Spending" fill="var(--chart-spend)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Sparkline({ values, height = 36, color = "var(--chart-spend)" }: { values: number[]; height?: number; color?: string }) {
  const data = values.map((v, i) => ({ i, v }));
  const id = `spark-${values.length}-${Math.round(values.reduce((a, b) => a + b, 0))}`;
  return (
    <div style={{ height }} className="w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

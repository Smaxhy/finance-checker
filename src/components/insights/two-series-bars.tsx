"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Legend } from "@/components/charts/charts";
import { formatMoney } from "@/lib/format";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

interface Series {
  key: string;
  label: string;
  color: string;
}

/** Grouped bars for two named series (validated accent + aqua pair), with legend and hover tooltip. */
export function TwoSeriesBars({
  data,
  series,
  currency = "EUR",
  height = 230,
}: {
  data: Record<string, string | number>[];
  series: [Series, Series];
  currency?: string;
  height?: number;
}) {
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
            <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={56} tickFormatter={(v) => formatMoney(v, currency, { decimals: 0, compact: Math.abs(v) >= 10_000 })} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)", radius: 6 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="card min-w-36 px-3 py-2 text-[12px] shadow-lg">
                    <p className="mb-1 font-medium text-fg">{String(label)}</p>
                    {series.map((s) => {
                      const p = payload.find((x) => x.dataKey === s.key);
                      return (
                        <div key={s.key} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-1.5 text-secondary">
                            <span className="size-2 rounded-sm" style={{ background: s.color }} />
                            {s.label}
                          </span>
                          <span className="tabular font-medium text-fg">{formatMoney(Number(p?.value ?? 0), currency)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={20} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDayMonth, formatFull, formatMonth, formatWeekdayDay } from "../dates";
import { type SeriesDay, formatCompact, formatNumber, valueTicks } from "../series";
import { chartColors } from "../theme";

interface Props {
  series: SeriesDay[];
  average: number | null;
  today: string;
  unit: string;
}

// Recharts plots `plot`; gaps sit at 0 and are drawn as a flat marker by
// DayBar below, so they never look like real values.
type ChartDay = SeriesDay & { plot: number };

export function DailyChart({ series, average, today, unit }: Props) {
  const data: ChartDay[] = series.map((d) => ({ ...d, plot: d.value ?? 0 }));
  const { ticks, format } = axisTicks(series);
  const yTicks = valueTicks(Math.max(average ?? 0, ...series.map((d) => d.value ?? 0)));

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 20, bottom: 0, left: 0 }} barCategoryGap={series.length > 120 ? "8%" : "22%"}>
          <CartesianGrid vertical={false} stroke={chartColors.grid} />
          <XAxis
            dataKey="date"
            ticks={ticks}
            tickFormatter={format}
            interval={0}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid }}
            tick={{ fill: chartColors.axis, fontSize: 12 }}
            tickMargin={8}
          />
          <YAxis
            width={44}
            ticks={yTicks}
            domain={[0, yTicks.at(-1)!]}
            tickFormatter={formatCompact}
            tickLine={false}
            axisLine={false}
            tick={{ fill: chartColors.axis, fontSize: 12 }}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: chartColors.cursor }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const day = payload?.[0]?.payload as ChartDay | undefined;
              if (!active || !day) return null;
              return (
                <div className="chart-tooltip">
                  <div className="chart-tooltip__date">{formatFull(day.date)}</div>
                  <div className="chart-tooltip__value">
                    {day.status === "recorded" ? (
                      <>
                        {formatNumber(day.value!)} <span>{unit}</span>
                      </>
                    ) : day.status === "no-data" ? (
                      "No data from Google"
                    ) : (
                      "Not synced"
                    )}
                  </div>
                </div>
              );
            }}
          />
          {average !== null && (
            <ReferenceLine y={average} stroke={chartColors.average} strokeDasharray="3 4" strokeWidth={1} />
          )}
          <Bar
            dataKey="plot"
            maxBarSize={32}
            isAnimationActive={false}
            shape={(props: unknown) => <DayBar {...(props as BarShapeProps)} today={today} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartDay;
}

function DayBar({ x = 0, y = 0, width = 0, height = 0, payload, today }: BarShapeProps & { today: string }) {
  if (!payload) return null;
  // No value: a short flat dash on the baseline. A real 0 draws nothing.
  if (payload.status !== "recorded") {
    return <rect x={x} y={y + height - 2} width={Math.max(width, 1)} height={2} fill={chartColors.gap} />;
  }
  if (height <= 0) return null;
  const fill = payload.date === today ? chartColors.barToday : chartColors.bar;
  return <rect x={x} y={y} width={Math.max(width, 1)} height={height} fill={fill} />;
}

// Which dates get an x-axis label, and how to write them, by range length:
// every day for a week, every 5th day for a month, the 1st and 15th for a
// quarter, and the 1st of each month for a year.
function axisTicks(series: SeriesDay[]): { ticks: string[]; format: (date: string) => string } {
  const dates = series.map((d) => d.date);
  const n = dates.length;
  if (n <= 7) return { ticks: dates, format: formatWeekdayDay };
  if (n <= 31) return { ticks: dates.filter((_, i) => (n - 1 - i) % 5 === 0), format: formatDayMonth };
  if (n <= 120) return { ticks: dates.filter((d) => d.endsWith("-01") || d.endsWith("-15")), format: formatDayMonth };
  return { ticks: dates.filter((d) => d.endsWith("-01")), format: formatMonth };
}

import { WarningCircle } from "@phosphor-icons/react";
import { type Metric, getMetric } from "../api";
import { formatDayMonth, formatFull } from "../dates";
import { useAsync } from "../hooks";
import { fillRange, formatNumber, summarize } from "../series";
import { DailyChart } from "./DailyChart";

interface Props {
  metric: Metric;
  title: string;
  unit: string; // as shown to people: "steps", "kcal"
  start: string;
  end: string;
  today: string;
  // Changes whenever a sync finishes, so the panel re-reads the database.
  refreshKey: string;
}

export function MetricPanel({ metric, title, unit, start, end, today, refreshKey }: Props) {
  const { data, error, loading, reload } = useAsync(
    () => getMetric(metric, start, end),
    [metric, start, end, refreshKey],
  );

  // Only use data that matches the range on screen; while a new range
  // loads, the old response still has the old dates.
  const current = data && data.start === start && data.end === end ? data : undefined;
  const series = current ? fillRange(current.days, start, end) : undefined;
  const summary = series ? summarize(series, today) : undefined;
  const headingId = `${metric}-heading`;

  return (
    <section className="panel" aria-labelledby={headingId} aria-busy={loading}>
      <header className="panel__head">
        <h2 id={headingId} className="panel__title">
          {title}
          <span className="panel__unit">{unit} / day</span>
        </h2>
        <dl className="stats">
          <Stat
            label="Today"
            value={summary?.today}
            unit={unit}
            note={summary && summary.today === null ? "Nothing yet" : formatDayMonth(today)}
            accent
          />
          <Stat
            label="Daily avg"
            value={summary?.average}
            unit={unit}
            note={summary ? `${summary.recordedDays} of ${summary.totalDays} days recorded` : undefined}
          />
          <Stat
            label="Best day"
            value={summary?.best?.value}
            unit={unit}
            note={summary?.best ? formatDayMonth(summary.best.date) : undefined}
          />
        </dl>
      </header>

      {error && !series ? (
        <div className="panel__state panel__state--error" role="alert">
          <WarningCircle size={20} aria-hidden="true" />
          <p>{error.message}</p>
          <button type="button" className="btn btn--ghost" onClick={reload}>
            Try again
          </button>
        </div>
      ) : !series || !summary ? (
        <div className="chart chart--loading" aria-label={`Loading ${title.toLowerCase()}`} />
      ) : summary.recordedDays === 0 ? (
        <div className="panel__state">
          <p>No {title.toLowerCase()} recorded in this range.</p>
          <p className="muted">Google may not have data for these days yet, or the first sync is still running.</p>
        </div>
      ) : (
        <figure className="panel__figure">
          <figcaption className="sr-only">
            {title} per day from {formatFull(start)} to {formatFull(end)}. Average{" "}
            {formatNumber(summary.average!)} {unit}
            {summary.best && `, best ${formatNumber(summary.best.value)} on ${formatFull(summary.best.date)}`}.
          </figcaption>
          <DailyChart series={series} average={summary.average} today={today} unit={unit} />
          <ul className="legend" aria-hidden="true">
            <li>
              <span className="legend__key legend__key--bar" /> Recorded
            </li>
            <li>
              <span className="legend__key legend__key--gap" /> No data
            </li>
            <li>
              <span className="legend__key legend__key--avg" /> Average
            </li>
          </ul>
          <details className="table-toggle">
            <summary>Show as table</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">{unit}</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{formatFull(d.date)}</td>
                    <td>{d.value === null ? <span className="muted">{d.status === "missing" ? "Not synced" : "No data"}</span> : formatNumber(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      )}
    </section>
  );
}

interface StatProps {
  label: string;
  value: number | null | undefined; // undefined: still loading
  unit: string;
  note?: string;
  accent?: boolean;
}

function Stat({ label, value, unit, note, accent }: StatProps) {
  return (
    <div className={`stat${accent ? " stat--accent" : ""}`}>
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">
        {value === undefined ? <span className="stat__placeholder" /> : value === null ? "–" : formatNumber(value)}
        {value !== undefined && value !== null && <span className="stat__unit">{unit}</span>}
      </dd>
      <dd className="stat__note">{note ?? " "}</dd>
    </div>
  );
}

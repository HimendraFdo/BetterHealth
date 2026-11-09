import { useEffect, useState } from "react";
import { getStatus, postSync } from "./api";
import { ConnectBanner } from "./components/ConnectBanner";
import { MetricPanel } from "./components/MetricPanel";
import { RANGES, RangePicker, type RangeKey } from "./components/RangePicker";
import { SyncStatus } from "./components/SyncStatus";
import { addDays, formatDayMonth, formatDayMonthYear } from "./dates";
import { useAsync } from "./hooks";

export function App() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const status = useAsync(getStatus, []);
  const { reload: reloadStatus } = status;
  const syncing = status.data?.syncing === true;

  // Re-check the status every minute, or every 3 seconds while a sync is
  // running, so the header and charts update by themselves.
  useEffect(() => {
    const id = setInterval(reloadStatus, syncing ? 3_000 : 60_000);
    return () => clearInterval(id);
  }, [syncing, reloadStatus]);

  async function syncNow() {
    setSyncBusy(true);
    setSyncError(undefined);
    try {
      await postSync();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncBusy(false);
      reloadStatus();
    }
  }

  const today = status.data?.today;
  const days = RANGES.find((r) => r.key === range)!.days;
  const start = today ? addDays(today, -(days - 1)) : undefined;
  // Changes whenever a sync saves new data, telling the panels to re-read.
  const refreshKey = status.data?.metrics.map((m) => m.lastSyncedAt).join("|") ?? "";

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to dashboard
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <span className="wordmark">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <rect x="1" y="11" width="3" height="8" />
              <rect x="6" y="6" width="3" height="13" />
              <rect x="11" y="9" width="3" height="10" />
              <rect x="16" y="1" width="3" height="18" />
            </svg>
            BetterHealth
          </span>
          <SyncStatus status={status.data} busy={syncBusy} onSync={syncNow} />
        </div>
      </header>

      <main id="main" className="page">
        {status.error && !status.data ? (
          <div className="banner" role="alert">
            <div className="banner__body">
              <p className="banner__title">Can't load the dashboard</p>
              <p className="banner__text">{status.error.message}</p>
            </div>
            <button type="button" className="btn btn--outline" onClick={reloadStatus}>
              Try again
            </button>
          </div>
        ) : (
          status.data && <ConnectBanner status={status.data} syncError={syncError} />
        )}

        <div className="overview">
          <div>
            <h1 className="overview__title">Activity</h1>
            <p className="overview__range">
              {start && today ? (
                <>
                  <time dateTime={start}>{formatDayMonth(start)}</time> –{" "}
                  <time dateTime={today}>{formatDayMonthYear(today)}</time>
                </>
              ) : (
                " "
              )}
            </p>
          </div>
          <RangePicker value={range} onChange={setRange} />
        </div>

        {start && today && (
          <div className="panels">
            <MetricPanel metric="steps" title="Steps" unit="steps" start={start} end={today} today={today} refreshKey={refreshKey} />
            <MetricPanel metric="calories" title="Calories" unit="kcal" start={start} end={today} today={today} refreshKey={refreshKey} />
          </div>
        )}
      </main>
    </>
  );
}

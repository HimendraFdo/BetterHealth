import { ArrowsClockwise } from "@phosphor-icons/react";
import type { StatusResponse } from "../api";
import { formatDayMonth, timeAgo } from "../dates";
import { useNow } from "../hooks";

interface Props {
  status: StatusResponse | undefined;
  busy: boolean;
  onSync: () => void;
}

// "Synced 4 minutes ago · through 9 Nov" and the Sync now button.
export function SyncStatus({ status, busy, onSync }: Props) {
  const now = useNow();
  const syncing = busy || status?.syncing === true;

  // The newest save across metrics is when data last arrived.
  const lastSaved = status?.metrics
    .map((m) => m.lastSyncedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  const through = status?.metrics
    .map((m) => m.syncedThrough)
    .filter((d): d is string => d !== null)
    .sort()
    .at(0);

  let text: string;
  if (!status) text = "Checking…";
  else if (syncing) text = "Syncing with Google…";
  else if (lastSaved) text = `Synced ${timeAgo(lastSaved, now)}${through ? ` · through ${formatDayMonth(through)}` : ""}`;
  else text = "Never synced";

  return (
    <div className="sync">
      <p className="sync__text" role="status">
        <span className={`sync__dot${syncing ? " sync__dot--live" : status?.lastSync?.ok === false ? " sync__dot--bad" : ""}`} aria-hidden="true" />
        {text}
      </p>
      <button
        type="button"
        className="btn btn--outline"
        onClick={onSync}
        disabled={syncing || !status?.googleConfigured || !status.connected}
      >
        <ArrowsClockwise size={16} weight="bold" aria-hidden="true" className={syncing ? "spin" : undefined} />
        {syncing ? "Syncing" : "Sync now"}
      </button>
    </div>
  );
}

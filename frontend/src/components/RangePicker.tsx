export const RANGES = [
  { key: "7d", days: 7, short: "7D", long: "Last 7 days" },
  { key: "30d", days: 30, short: "30D", long: "Last 30 days" },
  { key: "90d", days: 90, short: "90D", long: "Last 90 days" },
  { key: "1y", days: 365, short: "1Y", long: "Last year" },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

interface Props {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}

// A row of toggle buttons. aria-pressed tells screen readers which one is on.
export function RangePicker({ value, onChange }: Props) {
  return (
    <div className="segmented" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          className="segmented__option"
          aria-pressed={r.key === value}
          aria-label={r.long}
          title={r.long}
          onClick={() => onChange(r.key)}
        >
          {r.short}
        </button>
      ))}
    </div>
  );
}

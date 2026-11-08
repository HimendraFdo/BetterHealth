-- Calories burned per calendar day (Google's total-calories: resting + active).
CREATE TABLE daily_calories (
    date date PRIMARY KEY,
    -- NULL means Google had no data that day. double precision because
    -- Google sends fractions, e.g. 3274.69.
    kcal double precision,
    synced_at timestamptz NOT NULL DEFAULT now()
);

-- How far each metric has been synced. Without this, a metric with no data
-- yet (calories before your Fitbit moved to Google) would look "never
-- synced" and the full history would be downloaded again on every run.
CREATE TABLE sync_state (
    metric text PRIMARY KEY,
    -- The newest day fetched so far.
    synced_through date NOT NULL,
    last_synced_at timestamptz NOT NULL DEFAULT now()
);

import { describe, expect, it } from "vitest";
import { fillRange, summarize, valueTicks } from "./series";

describe("fillRange", () => {
  it("fills every date and keeps no-data apart from missing", () => {
    const series = fillRange(
      [
        { date: "2026-11-01", value: 5000 },
        { date: "2026-11-03", value: null },
      ],
      "2026-11-01",
      "2026-11-04",
    );
    expect(series.map((d) => [d.date, d.status])).toEqual([
      ["2026-11-01", "recorded"],
      ["2026-11-02", "missing"],
      ["2026-11-03", "no-data"],
      ["2026-11-04", "missing"],
    ]);
  });

  it("treats a real 0 as recorded", () => {
    expect(fillRange([{ date: "2026-11-01", value: 0 }], "2026-11-01", "2026-11-01")[0]?.status).toBe("recorded");
  });
});

describe("summarize", () => {
  it("averages recorded days only and finds the best day", () => {
    const series = fillRange(
      [
        { date: "2026-11-01", value: 4000 },
        { date: "2026-11-02", value: null },
        { date: "2026-11-03", value: 8000 },
      ],
      "2026-11-01",
      "2026-11-04",
    );
    expect(summarize(series, "2026-11-04")).toEqual({
      today: null,
      average: 6000,
      best: { date: "2026-11-03", value: 8000 },
      recordedDays: 2,
      totalDays: 4,
    });
  });
});


describe("valueTicks", () => {
  it("picks round steps that cover the maximum", () => {
    expect(valueTicks(12_251)).toEqual([0, 5000, 10000, 15000]);
    expect(valueTicks(3858)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(valueTicks(0)).toEqual([0, 1]);
  });
});

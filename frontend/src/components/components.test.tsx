import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StatusResponse } from "../api";
import { ConnectBanner } from "./ConnectBanner";
import { MetricPanel } from "./MetricPanel";
import { RangePicker } from "./RangePicker";

const status = (overrides: Partial<StatusResponse> = {}): StatusResponse => ({
  googleConfigured: true,
  connected: true,
  syncing: false,
  lastSync: { at: "2026-11-09T10:00:00Z", ok: true },
  today: "2026-11-09",
  metrics: [],
  ...overrides,
});

describe("ConnectBanner", () => {
  it("renders nothing when connected and syncing fine", () => {
    const { container } = render(<ConnectBanner status={status()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks to connect when there are no tokens", () => {
    render(<ConnectBanner status={status({ connected: false, lastSync: null })} />);
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", "/auth/google");
  });

  it("asks to reconnect when the sign-in expired", () => {
    render(
      <ConnectBanner
        status={status({ lastSync: { at: "x", ok: false, error: { code: "auth_expired", message: "expired" } } })}
      />,
    );
    expect(screen.getByText("Google sign-in expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/auth/google");
  });
});

describe("RangePicker", () => {
  it("marks the current range and reports clicks", async () => {
    const onChange = vi.fn();
    render(<RangePicker value="30d" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });
});

describe("MetricPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows today, the average of recorded days, and the best day", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          metric: "calories",
          unit: "kcal",
          start: "2026-11-07",
          end: "2026-11-09",
          days: [
            { date: "2026-11-07", value: 2000.4 },
            { date: "2026-11-08", value: null },
            { date: "2026-11-09", value: 3000.6 },
          ],
        }),
      ),
    );

    render(
      <MetricPanel metric="calories" title="Calories" unit="kcal" start="2026-11-07" end="2026-11-09" today="2026-11-09" refreshKey="" />,
    );

    // Values are rounded for display; the null day isn't counted.
    expect(await screen.findByText("2 of 3 days recorded")).toBeInTheDocument();
    const values = screen.getAllByRole("definition").map((el) => el.textContent);
    expect(values).toContain("3,001kcal"); // today
    expect(values).toContain("2,501kcal"); // average of 2000.4 and 3000.6
    expect(screen.getByRole("cell", { name: "No data" })).toBeInTheDocument();
  });

  it("shows the error with a retry button when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Range must be 1 to 366 days" }, { status: 400 })),
    );
    render(<MetricPanel metric="steps" title="Steps" unit="steps" start="2026-11-07" end="2026-11-09" today="2026-11-09" refreshKey="" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Range must be 1 to 366 days");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

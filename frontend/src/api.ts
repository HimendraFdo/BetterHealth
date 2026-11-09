// Types for what the backend sends, mirrored from backend/src/app.ts.
// They're copied rather than imported: the backend is a separate Node
// program, and importing from it would drag server code into the browser
// bundle. If the backend's response shape changes, change it here too.

export type Metric = "steps" | "calories";

export interface DailyValue {
  date: string; // "YYYY-MM-DD"
  value: number | null; // null: Google had no data that day (not the same as 0)
}

export interface MetricResponse {
  metric: Metric;
  unit: string;
  start: string;
  end: string;
  // Only days the sync has stored; dates with no record are left out.
  days: DailyValue[];
}

export type SyncErrorCode = "not_connected" | "auth_expired" | "account_not_linked" | "api_error" | "unknown";

export interface StatusResponse {
  googleConfigured: boolean;
  connected: boolean;
  syncing: boolean;
  lastSync: { at: string; ok: boolean; error?: { code: SyncErrorCode; message: string } } | null;
  today: string;
  metrics: { metric: Metric; unit: string; syncedThrough: string | null; lastSyncedAt: string | null }[];
}

export interface SyncResponse {
  results: { metric: Metric; start: string; end: string; daysStored: number; requests: number }[];
}

// An error with the HTTP status, so callers can tell "server down" from
// "Google needs reconnecting" (401).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// fetch() only rejects on network failure; a 500 still "succeeds". This
// turns non-2xx answers into errors carrying the backend's { error } text.
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const unreachable = "Can't reach the BetterHealth server. Is the backend running?";
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(unreachable, 0);
  }
  const body: unknown = await res.json().catch(() => undefined);
  // In development, Vite's proxy answers 502 with no JSON when Fastify is down.
  if (res.status === 502 && body === undefined) throw new ApiError(unreachable, 502);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const getStatus = () => request<StatusResponse>("/api/status");

export const getMetric = (metric: Metric, start: string, end: string) =>
  request<MetricResponse>(`/api/${metric}?start=${start}&end=${end}`);

export const postSync = () => request<SyncResponse>("/api/sync", { method: "POST" });

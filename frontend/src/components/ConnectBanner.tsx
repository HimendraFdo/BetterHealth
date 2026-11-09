import { LinkSimple, WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { StatusResponse } from "../api";

// Shown when Google isn't connected, the sign-in expired, or the last sync
// failed. Returns null (renders nothing) when all is well.
export function ConnectBanner({ status, syncError }: { status: StatusResponse; syncError?: string }) {
  if (!status.googleConfigured) {
    return (
      <Banner title="Google isn't set up on the server">
        Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to backend/.env, then restart the backend.
      </Banner>
    );
  }

  const code = status.lastSync?.error?.code;
  if (!status.connected || code === "not_connected") {
    return (
      <Banner title="Connect your Google account" action={<ConnectLink label="Connect Google" />}>
        BetterHealth reads your Fitbit steps and calories from Google Health. Nothing syncs until you connect.
      </Banner>
    );
  }
  if (code === "auth_expired") {
    return (
      <Banner title="Google sign-in expired" action={<ConnectLink label="Reconnect" />}>
        The dashboard is showing the data saved so far. Reconnect to start syncing again.
      </Banner>
    );
  }
  if (code === "account_not_linked") {
    return (
      <Banner title="This Google account isn't linked to Google Health" action={<ConnectLink label="Reconnect" />}>
        Sign in to the Google Health app with this account, then reconnect.
      </Banner>
    );
  }

  const message = syncError ?? (status.lastSync?.ok === false ? status.lastSync.error?.message : undefined);
  if (message) return <Banner title="Last sync failed">{message}</Banner>;
  return null;
}

function Banner({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="banner" role="alert">
      <WarningCircle size={20} weight="bold" aria-hidden="true" className="banner__icon" />
      <div className="banner__body">
        <p className="banner__title">{title}</p>
        <p className="banner__text">{children}</p>
      </div>
      {action}
    </div>
  );
}

// A plain link, not fetch(): OAuth needs the whole browser tab to go to
// Google and come back.
function ConnectLink({ label }: { label: string }) {
  return (
    <a className="btn btn--solid" href="/auth/google">
      <LinkSimple size={16} weight="bold" aria-hidden="true" />
      {label}
    </a>
  );
}

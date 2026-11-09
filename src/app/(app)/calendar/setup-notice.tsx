import { ButtonLink } from "@/components/ui/button";
import { SetupRequired } from "@/components/ui/misc";

export function CalendarSetupNotice({ state, googleConfigured, missing }: { state: "connected" | "missing" | "error"; googleConfigured: boolean; missing: string[] }) {
  if (state === "connected") return null;
  if (state === "error") {
    return (
      <SetupRequired
        className="mb-4"
        title="Google Calendar needs attention"
        description="The last sync failed or access expired. Reconnect to keep your agenda up to date - existing events stay visible."
        action={
          <ButtonLink href="/settings/accounts" variant="secondary" size="sm">
            Open connected accounts
          </ButtonLink>
        }
      />
    );
  }
  return (
    <SetupRequired
      className="mb-4"
      title="Google Calendar is not connected"
      description={
        googleConfigured
          ? "Connect it (read-only) to see your Google events next to renewals, bills, bookings and tasks. Events you add here and events found in email still show below."
          : "Google sign-in isn't configured on this server yet. Add the OAuth client credentials, then connect Google Calendar (read-only) from Connected Accounts."
      }
      missing={googleConfigured ? undefined : missing}
      action={
        <ButtonLink href="/settings/accounts" variant="secondary" size="sm">
          {googleConfigured ? "Connect Google Calendar" : "Connected accounts"}
        </ButtonLink>
      }
    />
  );
}

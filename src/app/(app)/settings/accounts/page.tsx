import Link from "next/link";
import { AlertTriangle, Bot, CalendarDays, CheckCircle2, FileUp, Landmark, Mail, Plus, ShieldCheck, Wallet } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile, must } from "@/lib/data/core";
import { listAccounts } from "@/lib/data/finance";
import { env, integrationStatus } from "@/lib/env";
import { GOOGLE_SCOPES } from "@/lib/integrations/google/scopes";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";
import type { Connection, SyncRun } from "@/lib/types";
import { daysBetween } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, SetupRequired } from "@/components/ui/misc";
import { AutoSync, ConnectBankButton, DisconnectButton, SyncButton } from "@/components/settings/connection-controls";
import { DeleteAccountButton } from "@/components/settings/delete-account-button";
import { AiLocalCard, GoogleLocalOptions, GoogleLocalSetup, LocalSignInState } from "@/components/local/settings";
import { IS_LOCAL } from "@/lib/local/mode";
import { str } from "@/lib/finance/periods";
import { SettingsTabs } from "../settings-tabs";

export const metadata = { title: "Connected Accounts" };

const ERRORS: Record<string, string> = {
  google_not_configured: "Google isn't configured on the server yet - see the setup steps below.",
  google_denied: "Google access was not granted.",
  google_state: "The Google sign-in expired or didn't match this session. Please try again.",
  google_exchange: "Google sign-in failed while exchanging the authorisation code. Please try again.",
  google_no_refresh: "Google didn't return a long-lived token. Remove the app at myaccount.google.com/permissions and connect again.",
  bank_not_configured: "Bank connections aren't configured on the server yet - see the setup steps below.",
  bank_invalid: "That bank selection wasn't valid.",
  bank_start: "Couldn't start the bank authorisation. Check the Enable Banking configuration and try again.",
  bank_denied: "Bank access was not granted.",
  bank_state: "The bank authorisation expired or didn't match this session. Please try again.",
  bank_session: "The bank authorisation could not be completed. Please try again.",
};

function StatusBadge({ c }: { c: Connection }) {
  if (c.status === "active") return <Badge tone="positive"><CheckCircle2 /> Connected</Badge>;
  if (c.status === "expired") return <Badge tone="warning"><AlertTriangle /> Needs reconnecting</Badge>;
  return <Badge tone="danger"><AlertTriangle /> {c.status === "error" ? "Sync error" : c.status}</Badge>;
}

export default async function ConnectedAccountsPage({ searchParams }: PageProps<"/settings/accounts">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const status = integrationStatus();
  const [connRes, accounts, runsRes, profile] = await Promise.all([
    supabase.from("connections").select("*").order("created_at"),
    listAccounts(supabase),
    supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
    getProfile(),
  ]);
  const connections = must(connRes, "connections") as Connection[];
  const runs = must(runsRes, "sync runs") as SyncRun[];
  const google = connections.filter((c) => c.provider === "google");
  const banks = connections.filter((c) => c.provider === "enable_banking");
  const otherAccounts = accounts.filter((a) => a.source !== "bank");
  const error = str(sp.error);
  const connected = str(sp.connected);
  const start = (services: string, hint?: string) => `/api/integrations/google/start?services=${services}${hint ? `&hint=${encodeURIComponent(hint)}` : ""}`;

  return (
    <div>
      <PageHeader
        title="Settings"
        description={IS_LOCAL ? "Connections are read-only. Nothing is stored on a server: your data, and any keys you add, stay in this browser." : "Connections are read-only. Credentials are encrypted (AES-256-GCM) and never shown to the browser."}
      />
      <SettingsTabs active="/settings/accounts" />
      <AutoSync />

      {error && ERRORS[error] && <p className="mb-4 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{ERRORS[error]}</p>}
      {connected && !error && <p className="mb-4 rounded-lg bg-positive-soft px-4 py-2.5 text-[13px] text-positive">{connected === "google" ? "Google connected." : "Bank connected."} The first sync is running.</p>}

      <div className="space-y-4">
        {/* Google */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Mail className="size-4 text-muted" /> Gmail & Google Calendar
              </span>
            }
            description="Connect as many Google accounts as you have. Read-only access: gmail.readonly and calendar.readonly. Nothing can be sent, deleted, modified or created."
          />
          <CardBody className="space-y-3">
            {!status.google.configured && IS_LOCAL ? (
              <GoogleLocalSetup />
            ) : !status.google.configured ? (
              <SetupRequired
                title="Google OAuth isn't configured"
                missing={status.google.missing}
                description={
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    <li>In Google Cloud Console create a project, enable the Gmail API and Google Calendar API.</li>
                    <li>Configure the OAuth consent screen (External, add yourself as a test user) with the gmail.readonly and calendar.readonly scopes.</li>
                    <li>
                      Create an OAuth client (Web application) with redirect URI <code className="font-mono text-[11.5px]">{`${env.appUrl}/api/integrations/google/callback`}</code>.
                    </li>
                    <li>Put the client id/secret in the environment and restart.</li>
                  </ol>
                }
              />
            ) : google.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={start("gmail,calendar")} variant="primary" size="sm" prefetch={false}>
                  <Mail /> Connect Gmail and Calendar
                </ButtonLink>
                <ButtonLink href={start("gmail")} variant="secondary" size="sm" prefetch={false}>
                  Gmail only
                </ButtonLink>
                <ButtonLink href={start("calendar")} variant="ghost" size="sm" prefetch={false}>
                  <CalendarDays /> Calendar only
                </ButtonLink>
              </div>
            ) : null}
            {google.map((c) => (
              <div key={c.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      {c.label} <StatusBadge c={c} />
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted">
                      {[c.scopes.includes(GOOGLE_SCOPES.gmail) && "Gmail (read-only)", c.scopes.includes(GOOGLE_SCOPES.calendar) && "Calendar (read-only)"].filter(Boolean).join(" · ")} · last checked {relativeTime(c.last_synced_at)}
                      {IS_LOCAL && <LocalSignInState id={c.id} />}
                    </p>
                    {c.last_error && <p className="mt-1 text-[12.5px] text-danger">{c.last_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === "expired" ? (
                      <ButtonLink
                        href={start([c.scopes.includes(GOOGLE_SCOPES.gmail) && "gmail", c.scopes.includes(GOOGLE_SCOPES.calendar) && "calendar"].filter(Boolean).join(",") || "gmail,calendar", c.label)}
                        variant="primary"
                        size="sm"
                        prefetch={false}
                      >
                        Reconnect
                      </ButtonLink>
                    ) : (
                      <SyncButton connectionId={c.id} label="Check now" />
                    )}
                    {!c.scopes.includes(GOOGLE_SCOPES.gmail) && status.google.configured && (
                      <ButtonLink href={start("gmail", c.label)} variant="ghost" size="sm" prefetch={false}>
                        Add Gmail
                      </ButtonLink>
                    )}
                    {!c.scopes.includes(GOOGLE_SCOPES.calendar) && status.google.configured && (
                      <ButtonLink href={start("calendar", c.label)} variant="ghost" size="sm" prefetch={false}>
                        Add Calendar
                      </ButtonLink>
                    )}
                    <DisconnectButton id={c.id} name={c.label} dataLabel="emails and calendar events" />
                  </div>
                </div>
              </div>
            ))}
            {status.google.configured && google.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <ButtonLink href={start("gmail,calendar")} variant="secondary" size="sm" prefetch={false}>
                  <Plus /> Add another Google account
                </ButtonLink>
                <span className="text-[12px] text-muted">Google lets you pick which account to add. Each one is checked separately and shown together.</span>
              </div>
            )}
            {IS_LOCAL && status.google.configured && <GoogleLocalOptions connectionIds={google.map((c) => c.id)} />}
          </CardBody>
        </Card>

        {/* Banks */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Landmark className="size-4 text-muted" /> Bank accounts (PSD2)
              </span>
            }
            description="Belgian and EU banks via Enable Banking, a licensed account-information provider. Read-only - no payments can ever be made."
            action={status.enableBanking.configured ? <ConnectBankButton label={banks.length ? "Add another bank" : "Connect a bank"} /> : undefined}
          />
          <CardBody className="space-y-3">
            {!status.enableBanking.configured && (
              <SetupRequired
                title="Bank connections aren't configured"
                missing={status.enableBanking.missing}
                description={
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                    <li>Create an account at enablebanking.com and register an application (start in the sandbox).</li>
                    <li>
                      Set its redirect URL to <code className="font-mono text-[11.5px]">{`${env.appUrl}/api/integrations/enablebanking/callback`}</code>.
                    </li>
                    <li>Copy the application id and the generated private key (.pem) into the environment.</li>
                    <li>To use your own real accounts, activate the application by linking them in the Enable Banking control panel.</li>
                  </ol>
                }
                action={
                  <ButtonLink href="/finances/transactions?import=1" variant="secondary" size="sm">
                    <FileUp /> Import a CSV export instead
                  </ButtonLink>
                }
              />
            )}
            {banks.map((c) => {
              const bankAccounts = accounts.filter((a) => a.connection_id === c.id);
              const daysLeft = c.consent_expires_at ? daysBetween(new Date(), new Date(c.consent_expires_at)) : null;
              return (
                <div key={c.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-[13.5px] font-medium">
                        {c.label} <StatusBadge c={c} />
                      </p>
                      <p className="mt-1 text-[12.5px] text-muted">
                        Last synced {relativeTime(c.last_synced_at)}
                        {daysLeft !== null && ` · consent ${daysLeft > 0 ? `valid for ${daysLeft} more days (until ${formatDate(c.consent_expires_at)})` : "expired"}`}
                      </p>
                      {c.last_error && <p className="mt-1 text-[12.5px] text-danger">{c.last_error}</p>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.status === "expired" || (daysLeft !== null && daysLeft < 14) ? <ConnectBankButton label="Renew access" /> : <SyncButton connectionId={c.id} />}
                      <DisconnectButton id={c.id} name={c.label} dataLabel="accounts and transactions" />
                    </div>
                  </div>
                  {bankAccounts.length > 0 && (
                    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                      {bankAccounts.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                          <span className="min-w-0 truncate">
                            {a.name} <span className="text-muted">· {a.iban_masked ?? a.type}</span>
                          </span>
                          <span className="font-medium tabular">{formatMoney(a.balance, a.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardBody>
        </Card>

        {/* Imported & manual */}
        {otherAccounts.length > 0 && (
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Wallet className="size-4 text-muted" /> Imported, manual and sample accounts
                </span>
              }
            />
            <CardBody>
              <ul className="divide-y divide-border">
                {otherAccounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2">
                      {a.name}
                      <span className="text-muted">
                        · {a.source === "csv" ? "CSV import" : a.source === "manual" ? "Manual entries" : "Demo"}
                        {a.iban_masked ? ` · ${a.iban_masked}` : ""}
                      </span>
                      {a.is_demo && <DemoBadge />}
                    </span>
                    <span className="flex items-center gap-3">
                      {a.balance !== null && <span className="font-medium tabular">{formatMoney(a.balance, a.currency)}</span>}
                      {(a.source === "csv" || a.source === "manual") && <DeleteAccountButton id={a.id} name={a.name} />}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        {/* AI */}
        <Card id="ai" className="scroll-mt-20">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Bot className="size-4 text-muted" /> AI provider
              </span>
            }
            description={IS_LOCAL ? "Optional: add Claude for free-form questions and deeper analysis. The built-in assistant works without it." : "Anthropic Claude powers free-form questions and (optionally) richer email extraction. Without it, the built-in assistant answers."}
          />
          <CardBody>
            {IS_LOCAL ? (
              <AiLocalCard assistant={Boolean(profile?.ai_assistant_enabled)} extraction={Boolean(profile?.ai_email_extraction_enabled)} />
            ) : status.anthropic.configured ? (
              <p className="flex items-center gap-2 text-[13px]">
                <Badge tone="positive">
                  <CheckCircle2 /> Configured
                </Badge>
                Nothing is sent until you enable it in{" "}
                <Link href="/settings/privacy#ai" className="text-accent-text hover:underline">
                  Privacy & Security
                </Link>
                .
              </p>
            ) : (
              <SetupRequired
                title="Claude isn't configured (optional)"
                missing={status.anthropic.missing}
                description="The built-in assistant already answers common questions and runs check-ups without any AI provider. Add an Anthropic API key to the server for free-form questions and deeper analysis."
              />
            )}
          </CardBody>
        </Card>

        {/* Sync history */}
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted" /> Recent sync activity
              </span>
            }
            description={
              IS_LOCAL
                ? "Accounts are checked while the app is open. This edition has no server, so nothing runs while it is closed."
                : status.cron.configured
                  ? "Connections also sync automatically once a day."
                  : "Set CRON_SECRET and schedule /api/cron/daily to sync automatically every day."
            }
          />
          <CardBody>
            {runs.length === 0 ? (
              <p className="text-[12.5px] text-muted">No syncs yet.</p>
            ) : (
              <ul className="divide-y divide-border text-[12.5px]">
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={r.status === "success" ? "positive" : r.status === "error" ? "danger" : "neutral"}>{r.status}</Badge>
                      <span className="capitalize">{r.kind}</span>
                      <span className="text-muted">{relativeTime(r.started_at)}</span>
                    </span>
                    <span className="max-w-[60%] truncate text-muted">
                      {r.error ?? Object.entries(r.stats).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

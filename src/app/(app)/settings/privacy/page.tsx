import { Ban, Bot, Database, EyeOff, KeyRound, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile, must } from "@/lib/data/core";
import { integrationStatus } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { AiConsent, DataControls, RetentionSelect } from "@/components/settings/privacy-controls";
import { SettingsTabs } from "../settings-tabs";

export const metadata = { title: "Privacy & Security" };

const PRINCIPLES = [
  { icon: KeyRound, title: "No passwords stored", text: "Gmail, Calendar and your bank are connected through OAuth / PSD2 consent. We never see or store your email or banking passwords." },
  { icon: EyeOff, title: "Read-only by design", text: "Only read-only scopes are requested (gmail.readonly, calendar.readonly, PSD2 account information). The app technically cannot send email, move money or cancel anything." },
  { icon: Lock, title: "Encrypted credentials", text: "Refresh tokens and bank session ids are AES-256-GCM encrypted at rest in a table no browser session can read. All traffic uses TLS." },
  { icon: Database, title: "Data minimisation", text: "From email we keep only extracted facts (sender, subject, amounts, dates, Gmail snippet) - never full message bodies. Old email data is purged after your retention period." },
  { icon: ShieldCheck, title: "Isolation", text: "Row-level security in the database ensures every query can only ever touch your own rows." },
  { icon: Ban, title: "You stay in control", text: "Nothing is sent, paid or cancelled on your behalf. Disconnect anything at any time, export everything, or delete it all." },
];

export default async function PrivacyPage() {
  const { supabase, user } = await requireUser();
  const [profile, auditRes] = await Promise.all([getProfile(), supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(25)]);
  const audit = must(auditRes, "audit log") as { id: number; action: string; details: Record<string, unknown>; created_at: string }[];
  const status = integrationStatus();

  return (
    <div>
      <PageHeader title="Settings" description="How your data is protected, and the controls GDPR gives you." />
      <SettingsTabs active="/settings/privacy" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="How your data is handled" />
          <CardBody>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <li key={p.title} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                    <p.icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-[13px] font-medium">{p.title}</span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card id="ai" className="scroll-mt-20">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Bot className="size-4 text-muted" /> AI processing (opt-in)
              </span>
            }
            description="Off by default. Insights on the dashboard are computed on this server without any AI provider."
          />
          <CardBody>
            <AiConsent assistant={profile?.ai_assistant_enabled ?? false} extraction={profile?.ai_email_extraction_enabled ?? false} configured={status.anthropic.configured} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Email data retention" description="Extracted email data older than this is deleted automatically by the daily job." />
          <CardBody>
            <RetentionSelect days={profile?.email_retention_days ?? 730} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your data" />
          <CardBody>
            <DataControls email={user.email ?? ""} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ScrollText className="size-4 text-muted" /> Security activity
              </span>
            }
            description="Sign-ins, connections, exports and privacy changes on your account."
          />
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="text-[12.5px] whitespace-nowrap text-muted">{formatDateTime(a.created_at)}</td>
                    <td className="font-mono text-[12px]">{a.action}</td>
                    <td className="max-w-md truncate text-[12px] text-muted">{Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ""}</td>
                  </tr>
                ))}
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-[12.5px] text-muted">
                      No activity recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Trash2, UserX } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select, Switch } from "@/components/ui/input";
import { deleteAccount, deleteAllData, updatePrivacy } from "@/app/actions/settings";

export function AiConsent({ assistant, extraction, configured }: { assistant: boolean; extraction: boolean; configured: boolean }) {
  const [a, setA] = useState(assistant);
  const [e, setE] = useState(extraction);
  const [pending, start] = useTransition();
  const save = (patch: { ai_assistant_enabled?: boolean; ai_email_extraction_enabled?: boolean }) =>
    start(async () => {
      const res = await updatePrivacy(patch);
      if (res.ok) toast.success("Privacy settings saved");
      else toast.error(res.message);
    });
  return (
    <div className="divide-y divide-border">
      <label className="flex items-start justify-between gap-6 py-3">
        <span>
          <span className="block text-[13px] font-medium">AI assistant</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">
            When you ask a question, your question and the specific figures the assistant looks up (totals, matching transactions, subscriptions, extracted email fields - never email bodies) are sent to Anthropic&apos;s API to compose the answer. Under Anthropic&apos;s commercial terms API data isn&apos;t used for model training. Conversations are not stored by this app.
          </span>
        </span>
        <Switch
          label="Enable AI assistant"
          checked={a}
          disabled={pending || !configured}
          onChange={(v) => {
            setA(v);
            save({ ai_assistant_enabled: v });
          }}
        />
      </label>
      <label className="flex items-start justify-between gap-6 py-3">
        <span>
          <span className="block text-[13px] font-medium">AI email extraction</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">
            Lets the sync send the text of likely receipts, bills and bookings to Anthropic to extract amounts and dates more accurately. When off, extraction uses on-server rules only and no email content leaves this app.
          </span>
        </span>
        <Switch
          label="Enable AI email extraction"
          checked={e}
          disabled={pending || !configured}
          onChange={(v) => {
            setE(v);
            save({ ai_email_extraction_enabled: v });
          }}
        />
      </label>
      {!configured && <p className="pt-3 text-[12px] text-muted">No AI provider is configured on this server, so nothing can be sent.</p>}
    </div>
  );
}

export function RetentionSelect({ days }: { days: number }) {
  const [pending, start] = useTransition();
  return (
    <Select
      className="w-48"
      defaultValue={String(days)}
      disabled={pending}
      aria-label="Email retention"
      onChange={(ev) =>
        start(async () => {
          const res = await updatePrivacy({ email_retention_days: Number(ev.target.value) });
          if (res.ok) toast.success("Retention updated - older email data is purged on the next daily run");
          else toast.error(res.message);
        })
      }
    >
      {[90, 180, 365, 730, 1825].map((d) => (
        <option key={d} value={d}>
          {d < 365 ? `${d} days` : `${d / 365} year${d === 365 ? "" : "s"}`}
        </option>
      ))}
    </Select>
  );
}

export function DataControls({ email }: { email: string }) {
  const [wipeOpen, setWipeOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
        <div>
          <p className="text-[13px] font-medium">Export your data</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Download everything stored about you as JSON (GDPR Art. 20).</p>
        </div>
        <ButtonLink href="/api/export" variant="secondary" size="sm" prefetch={false}>
          <Download /> Download export
        </ButtonLink>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 p-4">
        <div>
          <p className="text-[13px] font-medium">Delete all data</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Revokes every connection and permanently deletes all transactions, emails, events, subscriptions and settings data. Your login stays.</p>
        </div>
        <Dialog open={wipeOpen} onOpenChange={(o) => (setWipeOpen(o), setConfirm(""))}>
          <Button variant="danger" size="sm" onClick={() => setWipeOpen(true)}>
            <Trash2 /> Delete all data
          </Button>
          <DialogContent title="Delete all of your data?" description="This cannot be undone. Connections are revoked at Google and your bank first.">
            <p className="mb-2 text-[12.5px] text-muted">
              Type <span className="font-mono text-fg">DELETE</span> to confirm.
            </p>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setWipeOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending || confirm !== "DELETE"}
                onClick={() =>
                  start(async () => {
                    const res = await deleteAllData(confirm);
                    if (res.ok) {
                      toast.success(res.message ?? "Deleted");
                      setWipeOpen(false);
                    } else toast.error(res.message);
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Permanently delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/25 p-4">
        <div>
          <p className="text-[13px] font-medium">Delete account</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Deletes all data and your login (GDPR Art. 17). You will be signed out.</p>
        </div>
        <Dialog open={accountOpen} onOpenChange={(o) => (setAccountOpen(o), setConfirm(""))}>
          <Button variant="danger" size="sm" onClick={() => setAccountOpen(true)}>
            <UserX /> Delete account
          </Button>
          <DialogContent title="Delete your account?" description="Everything is removed permanently, including your login.">
            <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-muted">
              <AlertTriangle className="size-3.5 text-danger" /> Type your email address <span className="font-mono text-fg">{email}</span> to confirm.
            </p>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAccountOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending || confirm.trim().toLowerCase() !== email.toLowerCase()}
                onClick={() =>
                  start(async () => {
                    const res = await deleteAccount(confirm);
                    if (res && !res.ok) toast.error(res.message);
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Delete my account
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

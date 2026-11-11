"use client";
// GitHub Pages edition only: optional Claude with the user's own Anthropic API key.
import { useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, ShieldCheck, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch } from "@/components/ui/input";
import { updatePrivacy } from "@/app/actions/settings";
import { AI_EFFORTS, AI_MODELS, isAiEffort, modelName } from "@/lib/ai/models";
import { LOCAL_CHANGE_EVENT } from "@/lib/local/db";
import { getAiEffort, getAiKey, getAiModel, maskedAiKey, setAiEffort, setAiKey, setAiModel } from "@/lib/local/prefs";

function subscribe(onChange: () => void) {
  window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
    {children} <ExternalLink className="size-3" />
  </a>
);

/** Checks the key against Anthropic without spending anything (reads the model's description). */
async function testKey(key: string, model: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const [{ default: Anthropic }, { describeAssistantError }] = await Promise.all([import("@anthropic-ai/sdk"), import("@/lib/ai/assistant")]);
  try {
    await new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 }).models.retrieve(model);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: describeAssistantError(e) };
  }
}

export function AiLocalCard({ assistant, extraction }: { assistant: boolean; extraction: boolean }) {
  const masked = useSyncExternalStore(subscribe, maskedAiKey, () => null);
  const model = useSyncExternalStore(subscribe, getAiModel, () => AI_MODELS[0].id);
  const effort = useSyncExternalStore(subscribe, getAiEffort, () => "medium" as const);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [a, setA] = useState(assistant);
  const [x, setX] = useState(extraction);

  const save = (patch: { ai_assistant_enabled?: boolean; ai_email_extraction_enabled?: boolean }) =>
    start(async () => {
      const res = await updatePrivacy(patch);
      if (!res.ok) toast.error(res.message);
    });

  if (!masked) {
    const looksRight = /^sk-ant-[\w-]{20,}$/.test(value.trim());
    return (
      <div data-testid="ai-setup">
        <p className="flex items-start gap-2 text-[12.5px] text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />
          <span>
            <span className="font-medium text-fg">The built-in assistant already works</span> - it answers common questions and runs check-ups in this browser, free, and sends nothing anywhere.
            Adding Claude is optional: it understands any question, digs deeper and explains more.
          </span>
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[12.5px] text-secondary">
          <li>
            Create an account at <A href="https://console.anthropic.com/">Anthropic Console</A> and add some credit (pay-as-you-go; a question usually costs a few cents).
          </li>
          <li>
            Create a key under <A href="https://console.anthropic.com/settings/keys">API keys</A> and copy it. It starts with <code className="font-mono text-[11.5px]">sk-ant-</code>.
          </li>
          <li>
            Paste it here:
            <form
              className="mt-2 flex flex-col gap-2 sm:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!looksRight) return;
                setBusy(true);
                const result = await testKey(value.trim(), getAiModel());
                setBusy(false);
                if (!result.ok) {
                  toast.error("That key didn't work", { description: result.message });
                  return;
                }
                setAiKey(value.trim());
                setValue("");
                setA(true);
                save({ ai_assistant_enabled: true });
                toast.success("Claude is on", { description: "The assistant now answers with Claude. You can switch it off below at any time." });
              }}
            >
              <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-ant-..." aria-label="Anthropic API key" autoComplete="off" spellCheck={false} className="font-mono text-[12px]" />
              <Button type="submit" variant="primary" disabled={!looksRight || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} {busy ? "Checking…" : "Save and turn on"}
              </Button>
            </form>
          </li>
        </ol>
        <p className="mt-3 text-[12px] text-muted">
          By saving a key you choose to send your questions, and the figures the assistant looks up to answer them, from this browser to Anthropic. Email bodies and logins are never sent. The key
          is stored only in this browser, is left out of exports, and is removed by &quot;Delete all data&quot;. Anyone who can use this browser can use the key, so set a monthly spend limit in the
          Anthropic Console.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ai-configured">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone="positive">
            <CheckCircle2 /> Key saved
          </Badge>
          <code className="font-mono text-[12px] text-muted">{masked}</code>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={async () => {
              const key = getAiKey();
              if (!key) return;
              setBusy(true);
              const result = await testKey(key, model);
              setBusy(false);
              if (result.ok) toast.success("The key works", { description: `${modelName(model)} is available.` });
              else toast.error("The key didn't work", { description: result.message });
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Zap />} Test
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => {
              setAiKey(null);
              setA(false);
              setX(false);
              save({ ai_assistant_enabled: false, ai_email_extraction_enabled: false });
              toast.success("Key removed - the built-in assistant takes over");
            }}
          >
            <Trash2 /> Remove key
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-secondary">Model</span>
          <Select value={model} onChange={(e) => setAiModel(e.target.value)} aria-label="Claude model">
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-[12px] text-muted">{AI_MODELS.find((m) => m.id === model)?.blurb}</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-secondary">Answer depth</span>
          <Select value={effort} onChange={(e) => isAiEffort(e.target.value) && setAiEffort(e.target.value)} aria-label="Answer depth">
            {AI_EFFORTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <span className="mt-1 block text-[12px] text-muted">{AI_EFFORTS.find((e) => e.id === effort)?.blurb}</span>
        </label>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border px-4">
        <label className="flex items-start justify-between gap-6 py-3">
          <span>
            <span className="block text-[13px] font-medium">Use Claude for the assistant</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">
              Your question and the figures looked up for it (totals, matching transactions, subscriptions, extracted email fields - never email bodies) go from this browser to Anthropic. When
              off, the built-in assistant answers and nothing is sent.
            </span>
          </span>
          <Switch
            label="Use Claude for the assistant"
            checked={a}
            disabled={pending}
            onChange={(v) => {
              setA(v);
              save({ ai_assistant_enabled: v });
            }}
          />
        </label>
        <label className="flex items-start justify-between gap-6 py-3">
          <span>
            <span className="block text-[13px] font-medium">Use Claude to read emails more accurately</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">
              When checking mail, the text of likely receipts, bills and bookings is sent to Anthropic to pick out amounts and dates. This costs a little per email. When off, built-in rules do
              it and no email text leaves this browser.
            </span>
          </span>
          <Switch
            label="Use Claude to read emails more accurately"
            checked={x}
            disabled={pending}
            onChange={(v) => {
              setX(v);
              save({ ai_email_extraction_enabled: v });
            }}
          />
        </label>
      </div>
      <p className="text-[12px] text-muted">The answer screen shows roughly what each Claude answer cost. Prices are Anthropic&apos;s; this app adds nothing.</p>
    </div>
  );
}

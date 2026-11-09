import { integrationStatus } from "@/lib/env";
import { SetupRequired } from "@/components/ui/misc";

export const metadata = { title: "Setup required" };

export default function SetupPage() {
  const status = integrationStatus();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Finish setting up Command Centre</h1>
      <p className="mt-2 text-[13px] text-muted">
        The app needs a Supabase project for authentication and storage. Copy <code className="font-mono">.env.example</code> to{" "}
        <code className="font-mono">.env.local</code>, fill in the values and restart the server. See the README for step-by-step
        instructions.
      </p>
      <div className="mt-6 space-y-3">
        <SetupRequired
          title={status.supabase.configured ? "Supabase is configured" : "Supabase is not configured"}
          description="Authentication, database and row-level security."
          missing={status.supabase.missing}
        />
        <SetupRequired title="Token encryption key" description="Required before connecting Gmail, Calendar or a bank." missing={status.encryption.missing} />
      </div>
    </div>
  );
}

import { Command, Lock } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-30%] mx-auto h-[600px] max-w-3xl rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent-soft), transparent)" }}
      />
      <div className="relative w-full max-w-[380px] animate-slide-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-white shadow-[0_8px_30px_-8px_var(--accent)]">
            <Command className="size-4.5" />
          </span>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Command Centre</h1>
          <p className="mt-1 text-[13px] text-muted">Your money, subscriptions, inbox and plans in one place.</p>
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <Lock className="size-3" /> Read-only connections · Encrypted credentials · Your data, deletable anytime
        </p>
      </div>
    </div>
  );
}

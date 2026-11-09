"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { sendMagicLink, signIn, signUp, type AuthState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function Notice({ state }: { state: AuthState }) {
  if (state.error) return <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="alert">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-positive-soft px-3 py-2 text-[12.5px] text-positive" role="status">{state.message}</p>;
  return null;
}

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [state, action, pending] = useActionState(mode === "password" ? signIn : sendMagicLink, {
    error: linkError ? "That sign-in link is invalid or has expired." : undefined,
  });
  return (
    <div className="card p-6">
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/"} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </Field>
        {mode === "password" && (
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
        )}
        <Notice state={state} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-[12.5px]">
        <button className="text-muted hover:text-fg" onClick={() => setMode(mode === "password" ? "magic" : "password")}>
          {mode === "password" ? "Use a magic link instead" : "Use your password"}
        </button>
        <Link href="/signup" className="text-accent-text hover:underline">
          Create account
        </Link>
      </div>
    </div>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, {});
  return (
    <div className="card p-6">
      <form action={action} className="space-y-4">
        <Field label="Name">
          <Input name="name" autoComplete="name" placeholder="Optional" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Notice state={state} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-[12.5px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent-text hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

"use client";
// GitHub Pages edition only: Google sends the browser back here after a read-only
// sign-in. The access token arrives in the URL fragment, which never reaches any server.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { flushNow } from "@/lib/local/db";
import { MAIL_CHECK_EVENT, completeAuth } from "@/lib/local/google";

export default function GoogleReturnPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<{ message: string; returnTo: string } | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = window.location.hash;
    // Take the token out of the address bar (and the history entry) straight away.
    window.history.replaceState(null, "", window.location.pathname);
    completeAuth(fragment)
      .then(async (result) => {
        await flushNow();
        if (result.kind === "redirect") window.location.replace(result.url);
        else if (result.kind === "done") {
          router.replace(result.connectedId ? `/settings/accounts?connected=google&sync=${result.connectedId}` : result.returnTo);
          // A newly connected account is synced by the accounts page; after a refresh, ask the app to check now.
          if (!result.connectedId) window.dispatchEvent(new Event(MAIL_CHECK_EVENT));
        }
        else setError({ message: result.message, returnTo: result.returnTo });
      })
      .catch((e) => setError({ message: e instanceof Error ? e.message : "The Google sign-in could not be completed.", returnTo: "/settings/accounts" }));
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {error ? (
        <div className="card max-w-md p-6 text-center">
          <ShieldAlert className="mx-auto size-6 text-warning" />
          <p className="mt-3 text-[15px] font-medium">Google wasn&apos;t connected</p>
          <p className="mt-1.5 text-[13px] text-muted">{error.message}</p>
          <Link href={error.returnTo} className="mt-4 inline-block text-[13px] text-accent-text hover:underline">
            Back to the app
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 className="size-4 animate-spin" /> Finishing Google sign-in…
        </p>
      )}
    </main>
  );
}

"use client";
// GitHub Pages serves this as 404.html. Subscription detail links (/subscriptions/<id>)
// aren't pre-built pages, so they are forwarded to the single exported shell.
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { NotFoundView } from "@/lib/local/runtime";
import { BASE_PATH } from "@/lib/local/mode";

const noop = () => () => {};

export default function NotFound() {
  const router = useRouter();
  const path = useSyncExternalStore(noop, () => window.location.pathname.slice(BASE_PATH.length), () => null);
  const subscriptionId = path?.match(/^\/subscriptions\/([0-9a-f-]{36})\/?$/i)?.[1];
  useEffect(() => {
    if (subscriptionId) router.replace(`/subscriptions/_?id=${subscriptionId}`);
  }, [router, subscriptionId]);
  if (path === null || subscriptionId) return null;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <NotFoundView />
    </div>
  );
}

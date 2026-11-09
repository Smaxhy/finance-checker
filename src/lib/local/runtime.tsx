"use client";
/**
 * Runs the app's server-rendered pages in the browser for the GitHub Pages
 * edition. Each page is an async function that queries data and returns JSX;
 * here it is called with the on-device database, nested async components are
 * resolved, and the result is rendered. Pages re-run whenever local data
 * changes. Redirects and not-found behave like on the server.
 */
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LOCAL_CHANGE_EVENT, ready } from "./db";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";

// Pages declare their own (narrower) params types, so the runner accepts any page signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageFn = (props: any) => unknown;

function isAsyncFunction(fn: unknown): fn is (props: unknown) => Promise<ReactNode> {
  return typeof fn === "function" && fn.constructor?.name === "AsyncFunction";
}

/** Resolves async (server) components anywhere in an element tree, including element-valued props. */
export async function resolveNode(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveNode(n as ReactNode)));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Record<string, unknown>>;
  if (isAsyncFunction(el.type)) return resolveNode(await el.type(el.props));
  const patch: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(el.props ?? {})) {
    if (key === "children" || isValidElement(value) || Array.isArray(value)) {
      const resolved = await resolveNode(value as ReactNode);
      if (resolved !== value) {
        patch[key] = resolved;
        changed = true;
      }
    }
  }
  return changed ? cloneElement(el, patch) : el;
}

/** Bumps whenever local data changes (debounced so bulk imports re-render once). */
export function useLocalVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 120);
    };
    window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return version;
}

function redirectTarget(e: unknown): string | null {
  const digest = (e as { digest?: unknown })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";").find((p) => p.startsWith("/")) ?? "/";
}

function isNotFound(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.includes("404");
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-7 w-48" />
      <div className="skeleton h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="skeleton h-72" />
    </div>
  );
}

export function LocalPage({ page, dynamicParam }: { page: PageFn; dynamicParam?: string }) {
  const searchParams = useSearchParams();
  const params = useParams() as Record<string, string>;
  const router = useRouter();
  const version = useLocalVersion();
  const [node, setNode] = useState<ReactNode | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const searchKey = searchParams.toString();
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const id = ++run.current;
    (async () => {
      await ready();
      const search = Object.fromEntries(new URLSearchParams(searchKey).entries());
      const p: Record<string, string> = { ...JSON.parse(paramsKey) };
      // Dynamic routes are exported once as "_" and read the real id from ?id=.
      if (dynamicParam && (!p[dynamicParam] || p[dynamicParam] === "_") && search[dynamicParam]) p[dynamicParam] = search[dynamicParam];
      try {
        const out = await page({ params: Promise.resolve(p), searchParams: Promise.resolve(search) });
        const resolved = await resolveNode(out as ReactNode);
        if (id !== run.current) return;
        setNode(resolved);
        setState("ready");
      } catch (e) {
        if (id !== run.current) return;
        const target = redirectTarget(e);
        if (target) return router.replace(target);
        if (isNotFound(e)) return setState("notfound");
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
  }, [page, dynamicParam, searchKey, paramsKey, version, router]);

  if (state === "notfound") return <NotFoundView />;
  if (state === "error")
    return (
      <EmptyState
        title="Something went wrong loading this page"
        description={error ?? undefined}
        action={
          <ButtonLink href="/" variant="secondary">
            Back to overview
          </ButtonLink>
        }
      />
    );
  if (state === "loading" || node === null) return <PageSkeleton />;
  return <>{node}</>;
}

export function NotFoundView() {
  return (
    <EmptyState
      title="Page not found"
      description="It may have been removed, or the link is out of date."
      action={
        <ButtonLink href="/" variant="secondary">
          Back to overview
        </ButtonLink>
      }
    />
  );
}

import { brandIcon } from "@/lib/brand-icon";

const SIZES = new Set([192, 512]);

/** Home-screen icons referenced by the web manifest: /icons/192, /icons/512, /icons/512?maskable=1 */
export async function GET(request: Request, ctx: RouteContext<"/icons/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  const res = brandIcon(size, { maskable });
  res.headers.set("cache-control", "public, max-age=604800, immutable");
  return res;
}

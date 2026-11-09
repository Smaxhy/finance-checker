"use server";
// Server wrappers - the logic lives in src/lib/actions/demo.ts.
import * as impl from "@/lib/actions/demo";

export async function loadDemoData(...args: Parameters<typeof impl.loadDemoData>): ReturnType<typeof impl.loadDemoData> {
  return impl.loadDemoData(...args);
}

export async function clearDemoData(...args: Parameters<typeof impl.clearDemoData>): ReturnType<typeof impl.clearDemoData> {
  return impl.clearDemoData(...args);
}

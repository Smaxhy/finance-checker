"use server";
// Server wrappers - the logic lives in src/lib/actions/subscriptions.ts.
import * as impl from "@/lib/actions/subscriptions";

export type { ActionResult } from "@/lib/actions/subscriptions";

export async function createSubscription(...args: Parameters<typeof impl.createSubscription>): ReturnType<typeof impl.createSubscription> {
  return impl.createSubscription(...args);
}

export async function updateSubscription(...args: Parameters<typeof impl.updateSubscription>): ReturnType<typeof impl.updateSubscription> {
  return impl.updateSubscription(...args);
}

export async function confirmDetection(...args: Parameters<typeof impl.confirmDetection>): ReturnType<typeof impl.confirmDetection> {
  return impl.confirmDetection(...args);
}

export async function dismissSubscription(...args: Parameters<typeof impl.dismissSubscription>): ReturnType<typeof impl.dismissSubscription> {
  return impl.dismissSubscription(...args);
}

export async function restoreSubscription(...args: Parameters<typeof impl.restoreSubscription>): ReturnType<typeof impl.restoreSubscription> {
  return impl.restoreSubscription(...args);
}

export async function markReviewed(...args: Parameters<typeof impl.markReviewed>): ReturnType<typeof impl.markReviewed> {
  return impl.markReviewed(...args);
}

export async function requestCancellation(...args: Parameters<typeof impl.requestCancellation>): ReturnType<typeof impl.requestCancellation> {
  return impl.requestCancellation(...args);
}

export async function confirmCancellation(...args: Parameters<typeof impl.confirmCancellation>): ReturnType<typeof impl.confirmCancellation> {
  return impl.confirmCancellation(...args);
}

export async function reactivateSubscription(...args: Parameters<typeof impl.reactivateSubscription>): ReturnType<typeof impl.reactivateSubscription> {
  return impl.reactivateSubscription(...args);
}

export async function deleteSubscription(...args: Parameters<typeof impl.deleteSubscription>): ReturnType<typeof impl.deleteSubscription> {
  return impl.deleteSubscription(...args);
}

"use server";
// Server wrappers - the logic lives in src/lib/actions/emails.ts.
import * as impl from "@/lib/actions/emails";

export async function updateEmailCategory(...args: Parameters<typeof impl.updateEmailCategory>): ReturnType<typeof impl.updateEmailCategory> {
  return impl.updateEmailCategory(...args);
}

export async function setEmailImportant(...args: Parameters<typeof impl.setEmailImportant>): ReturnType<typeof impl.setEmailImportant> {
  return impl.setEmailImportant(...args);
}

export async function removeEmailRecord(...args: Parameters<typeof impl.removeEmailRecord>): ReturnType<typeof impl.removeEmailRecord> {
  return impl.removeEmailRecord(...args);
}

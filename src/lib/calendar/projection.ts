import type { BillingCycle } from "@/lib/types";
import { addDaysKey, addMonthsKey } from "./time";

/**
 * Projects every expected charge of a recurring payment inside [from, to]
 * (inclusive day keys), starting at its next payment date. Unlike a single
 * "next payment", this lets a 60-day timeline or a future month show each
 * monthly / weekly occurrence.
 */
export function projectChargeDates(nextPayment: string | null, cycle: BillingCycle, from: string, to: string, maxOccurrences = 60): string[] {
  if (!nextPayment) return [];
  const out: string[] = [];
  let current = nextPayment;
  let i = 0;
  const step = (k: string, n: number): string => {
    switch (cycle) {
      case "weekly":
        return addDaysKey(k, 7 * n);
      case "quarterly":
        return addMonthsKey(k, 3 * n);
      case "semiannual":
        return addMonthsKey(k, 6 * n);
      case "yearly":
        return addMonthsKey(k, 12 * n);
      case "monthly":
        return addMonthsKey(k, n);
      default:
        return k; // unknown cycle: only the known next date
    }
  };
  // Always step from the anchor date so month-end dates don't drift (31 → 30 → 28 …).
  while (current <= to && i < maxOccurrences) {
    if (current >= from) out.push(current);
    if (cycle === "unknown") break;
    i++;
    current = step(nextPayment, i);
  }
  return out;
}

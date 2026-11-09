import "server-only";
import { getCategories, getProfile } from "@/lib/data/core";
import type { CategoryOption } from "@/components/subscriptions/subscription-form";

/** Category options for subscription forms (expense categories only) and an id → icon map. */
export async function subscriptionCategoryData(): Promise<{ options: CategoryOption[]; icons: Record<string, string> }> {
  const categories = await getCategories();
  const expense = categories.filter((c) => c.kind === "expense");
  // Put the most relevant ones first.
  const priority = ["subscriptions", "bills", "housing", "health", "business", "entertainment"];
  const options = [...expense]
    .sort((a, b) => {
      const pa = priority.indexOf(a.id);
      const pb = priority.indexOf(b.id);
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || a.sort_order - b.sort_order;
    })
    .map((c) => ({ id: c.id, name: c.name }));
  return { options, icons: Object.fromEntries(categories.map((c) => [c.id, c.icon])) };
}

export async function baseCurrency(): Promise<string> {
  return (await getProfile())?.base_currency ?? "EUR";
}

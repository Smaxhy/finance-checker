import { redirect } from "next/navigation";

export default function FinancesIndex() {
  redirect("/finances/transactions");
}

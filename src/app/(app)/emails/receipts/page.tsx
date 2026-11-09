import { EmailsView } from "../emails-view";

export const metadata = { title: "Receipts · Emails" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <EmailsView tab="receipts" searchParams={searchParams} />;
}

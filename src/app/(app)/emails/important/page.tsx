import { EmailsView } from "../emails-view";

export const metadata = { title: "Important · Emails" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <EmailsView tab="important" searchParams={searchParams} />;
}

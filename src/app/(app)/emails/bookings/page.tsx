import { EmailsView } from "../emails-view";

export const metadata = { title: "Bookings · Emails" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <EmailsView tab="bookings" searchParams={searchParams} />;
}

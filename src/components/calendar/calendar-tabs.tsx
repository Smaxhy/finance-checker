import { Tabs } from "@/components/ui/misc";

export function CalendarTabs({ active, counts }: { active: string; counts?: Partial<Record<string, number>> }) {
  return (
    <Tabs
      active={active}
      items={[
        { href: "/calendar", label: "Month", count: counts?.["/calendar"] },
        { href: "/calendar/upcoming", label: "Upcoming", count: counts?.["/calendar/upcoming"] },
        { href: "/calendar/events", label: "Events", count: counts?.["/calendar/events"] },
        { href: "/calendar/tasks", label: "Tasks", count: counts?.["/calendar/tasks"] },
      ]}
    />
  );
}

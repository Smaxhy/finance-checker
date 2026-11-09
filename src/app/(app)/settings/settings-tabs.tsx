import { Tabs } from "@/components/ui/misc";

export function SettingsTabs({ active }: { active: string }) {
  return (
    <div className="mb-6">
      <Tabs
        active={active}
        items={[
          { href: "/settings/accounts", label: "Connected Accounts" },
          { href: "/settings/privacy", label: "Privacy & Security" },
          { href: "/settings/preferences", label: "Preferences" },
        ]}
      />
    </div>
  );
}

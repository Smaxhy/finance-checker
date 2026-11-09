import { Bell, FlaskConical, Tags, UserRound } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCategories, getProfile, hasDemoData, must, notificationPrefs } from "@/lib/data/core";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { CategoryManager, NotificationPrefsForm, ProfileForm } from "@/components/settings/preferences-forms";
import { ClearDemoButton, LoadDemoButton } from "@/components/demo-controls";
import { SettingsTabs } from "../settings-tabs";

export const metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const { supabase } = await requireUser();
  const [profile, categories, rulesRes, demo] = await Promise.all([getProfile(), getCategories(), supabase.from("category_rules").select("id, pattern, category_id").order("created_at"), hasDemoData(supabase)]);
  const rules = must(rulesRes, "rules") as { id: string; pattern: string; category_id: string }[];

  const title = (Icon: typeof Bell, text: string) => (
    <span className="flex items-center gap-2">
      <Icon className="size-4 text-muted" /> {text}
    </span>
  );

  return (
    <div>
      <PageHeader title="Settings" description="Make the command centre work the way you do." />
      <SettingsTabs active="/settings/preferences" />
      <div className="space-y-4">
        <Card>
          <CardHeader title={title(UserRound, "Profile")} />
          <CardBody>
            <ProfileForm name={profile?.display_name ?? ""} locale={profile?.locale ?? "en-BE"} currency={profile?.base_currency ?? "EUR"} />
          </CardBody>
        </Card>
        <Card id="notifications" className="scroll-mt-20">
          <CardHeader title={title(Bell, "Notifications")} description="Choose what deserves your attention." />
          <CardBody>
            <NotificationPrefsForm prefs={notificationPrefs(profile)} threshold={profile?.large_purchase_threshold ?? 150} />
          </CardBody>
        </Card>
        <Card id="categories" className="scroll-mt-20">
          <CardHeader title={title(Tags, "Categories & rules")} description="Create your own categories and rules; rules apply to future imports and syncs too." />
          <CardBody>
            <CategoryManager categories={categories} rules={rules} />
          </CardBody>
        </Card>
        <Card id="demo" className="scroll-mt-20">
          <CardHeader title={title(FlaskConical, "Demo data")} description="Sample Belgian data for exploring the app. Everything generated is marked DEMO and is kept separate from synced data." />
          <CardBody className="flex flex-wrap items-center gap-3">
            {demo ? <ClearDemoButton /> : <LoadDemoButton />}
            <span className="text-[12.5px] text-muted">{demo ? "Demo data is currently loaded." : "No demo data loaded."}</span>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

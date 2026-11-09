"use client";
import Link from "next/link";
import { LogOut, Moon, Plug, Settings, Shield, Sun } from "lucide-react";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/actions/auth";
import { useTheme } from "./theme";

export function UserMenu({ user, collapsed }: { user: { email: string | null; name: string | null }; collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-2",
            collapsed && "w-auto justify-center",
          )}
          aria-label="Account menu"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-secondary ring-1 ring-border">
            {initials(user.name ?? user.email)}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">{user.name ?? "Account"}</span>
              <span className="block truncate text-[11.5px] text-muted">{user.email}</span>
            </span>
          )}
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" side="top" className="w-56">
        <DropdownLabel>{user.email}</DropdownLabel>
        <DropdownItem asChild>
          <Link href="/settings/accounts">
            <Plug /> Connected accounts
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href="/settings/privacy">
            <Shield /> Privacy & security
          </Link>
        </DropdownItem>
        <DropdownItem asChild>
          <Link href="/settings/preferences">
            <Settings /> Preferences
          </Link>
        </DropdownItem>
        <DropdownItem onSelect={() => setTheme(theme === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon /> : <Sun />} {theme === "light" ? "Dark mode" : "Light mode"}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => void signOut()} className="text-danger data-[highlighted]:text-danger">
          <LogOut /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

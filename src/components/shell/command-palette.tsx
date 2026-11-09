"use client";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Bell, Bot, Mail, Plus, Search, Upload } from "lucide-react";
import { NAV } from "./nav";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const go = (href: string) => {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  };

  const itemClass =
    "flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-secondary data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:text-muted";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="card fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden p-0 data-[state=open]:animate-pop">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search pages and actions</Dialog.Description>
          <Command label="Command palette" loop>
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="size-4 text-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages, actions, emails, transactions…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
              />
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-[13px] text-muted">No results.</Command.Empty>
              {query.trim().length > 1 && (
                <Command.Group heading="Search" className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                  <Command.Item value={`search-tx ${query}`} onSelect={() => go(`/finances/transactions?q=${encodeURIComponent(query)}`)} className={itemClass}>
                    <Search /> Transactions matching “{query}”
                  </Command.Item>
                  <Command.Item value={`search-mail ${query}`} onSelect={() => go(`/emails?q=${encodeURIComponent(query)}`)} className={itemClass}>
                    <Mail /> Emails matching “{query}”
                  </Command.Item>
                  <Command.Item value={`ask ${query}`} onSelect={() => go(`/insights/assistant?q=${encodeURIComponent(query)}`)} className={itemClass}>
                    <Bot /> Ask the assistant: “{query}”
                  </Command.Item>
                </Command.Group>
              )}
              <Command.Group heading="Actions" className="mb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                <Command.Item onSelect={() => go("/finances/transactions?new=1")} className={itemClass}>
                  <Plus /> Add a transaction
                </Command.Item>
                <Command.Item onSelect={() => go("/finances/transactions?import=1")} className={itemClass}>
                  <Upload /> Import bank CSV
                </Command.Item>
                <Command.Item onSelect={() => go("/subscriptions?new=1")} className={itemClass}>
                  <Plus /> Add a subscription
                </Command.Item>
                <Command.Item onSelect={() => go("/calendar?new=event")} className={itemClass}>
                  <Plus /> Create an event
                </Command.Item>
                <Command.Item onSelect={() => go("/calendar/tasks?new=1")} className={itemClass}>
                  <Plus /> Create a task or reminder
                </Command.Item>
                <Command.Item onSelect={() => go("/notifications")} className={itemClass}>
                  <Bell /> Open notifications
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:text-muted">
                {NAV.flatMap((item) => [item, ...(item.children ?? []).map((c) => ({ ...c, label: `${item.label} › ${c.label}` }))]).map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item key={item.href + item.label} value={item.label} onSelect={() => go(item.href)} className={itemClass}>
                      <Icon />
                      <span className="flex-1">{item.label}</span>
                      <ArrowRight className="opacity-0 group-data-[selected=true]:opacity-100" />
                    </Command.Item>
                  );
                })}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

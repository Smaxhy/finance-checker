"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dropdown = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

export function DropdownContent({ children, className, align = "end", ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn("card z-50 min-w-48 p-1 data-[state=open]:animate-pop", className)}
        {...props}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-secondary outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <Menu.Label className="px-2 py-1.5 text-[11.5px] font-medium text-muted">{children}</Menu.Label>;
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

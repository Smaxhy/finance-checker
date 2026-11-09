import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Bot,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  FileBarChart,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Mail,
  MailWarning,
  Package,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Repeat,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Wallet,
  XCircle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  {
    label: "Finances",
    href: "/finances",
    icon: Wallet,
    children: [
      { label: "Transactions", href: "/finances/transactions", icon: ArrowLeftRight },
      { label: "Spending Analytics", href: "/finances/analytics", icon: BarChart3 },
      { label: "Income", href: "/finances/income", icon: CircleDollarSign },
      { label: "Budgets", href: "/finances/budgets", icon: PiggyBank },
    ],
  },
  {
    label: "Subscriptions",
    href: "/subscriptions",
    icon: Repeat,
    children: [
      { label: "Active", href: "/subscriptions/active", icon: CheckCircle2 },
      { label: "Trials", href: "/subscriptions/trials", icon: Timer },
      { label: "Cancelled", href: "/subscriptions/cancelled", icon: XCircle },
      { label: "Upcoming Renewals", href: "/subscriptions/renewals", icon: CalendarClock },
    ],
  },
  {
    label: "Emails",
    href: "/emails",
    icon: Mail,
    children: [
      { label: "Important", href: "/emails/important", icon: MailWarning },
      { label: "Receipts", href: "/emails/receipts", icon: Receipt },
      { label: "Purchases", href: "/emails/purchases", icon: Package },
      { label: "Bookings", href: "/emails/bookings", icon: Plane },
    ],
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    children: [
      { label: "Upcoming", href: "/calendar/upcoming", icon: CalendarRange },
      { label: "Events", href: "/calendar/events", icon: CalendarDays },
      { label: "Tasks", href: "/calendar/tasks", icon: ListTodo },
    ],
  },
  {
    label: "Insights",
    href: "/insights",
    icon: Sparkles,
    children: [
      { label: "AI Assistant", href: "/insights/assistant", icon: Bot },
      { label: "Spending Patterns", href: "/insights/patterns", icon: FlaskConical },
      { label: "Reports", href: "/insights/reports", icon: FileBarChart },
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    children: [
      { label: "Connected Accounts", href: "/settings/accounts", icon: Plug },
      { label: "Privacy & Security", href: "/settings/privacy", icon: Shield },
      { label: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
    ],
  },
];

export const EXTRA_ROUTES: NavItem[] = [
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "All emails", href: "/emails", icon: Inbox },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function findTrail(pathname: string): NavItem[] {
  for (const item of NAV) {
    if (item.children) {
      const child = item.children.find((c) => isActive(pathname, c.href));
      if (child) return [item, child];
    }
    if (isActive(pathname, item.href)) return [item];
  }
  const extra = EXTRA_ROUTES.find((r) => isActive(pathname, r.href));
  return extra ? [extra] : [];
}

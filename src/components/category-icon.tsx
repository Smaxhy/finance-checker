import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Circle,
  CircleDashed,
  Clapperboard,
  HeartPulse,
  House,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Tag,
  TramFront,
  Undo2,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "shopping-basket": ShoppingBasket,
  utensils: Utensils,
  "shopping-bag": ShoppingBag,
  clapperboard: Clapperboard,
  "tram-front": TramFront,
  plane: Plane,
  repeat: Repeat,
  house: House,
  receipt: Receipt,
  briefcase: Briefcase,
  "heart-pulse": HeartPulse,
  banknote: Banknote,
  "circle-dashed": CircleDashed,
  wallet: Wallet,
  "piggy-bank": PiggyBank,
  "undo-2": Undo2,
  "arrow-left-right": ArrowLeftRight,
  tag: Tag,
  circle: Circle,
};

export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

export function CategoryIcon({ icon, className, boxed = true }: { icon?: string | null; className?: string; boxed?: boolean }) {
  const Icon = (icon && ICONS[icon]) || Tag;
  if (!boxed) return <Icon className={cn("size-4 text-muted", className)} />;
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-secondary", className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

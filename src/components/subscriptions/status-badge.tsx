import { Badge } from "@/components/ui/badge";
import type { Subscription, SubscriptionStatus } from "@/lib/types";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/subscriptions/helpers";

export function StatusBadge({ status, dismissed }: { status: SubscriptionStatus; dismissed?: boolean }) {
  if (dismissed) return <Badge tone="outline">Dismissed</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function SourceLabel({ s }: { s: Pick<Subscription, "detection_source" | "detection_confidence"> }) {
  return (
    <span className="text-[12px] whitespace-nowrap text-muted">
      {SOURCE_LABEL[s.detection_source]}
      {s.detection_confidence && s.detection_source !== "manual" ? ` · ${Math.round(s.detection_confidence * 100)}%` : ""}
    </span>
  );
}

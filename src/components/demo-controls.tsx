"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearDemoData, loadDemoData } from "@/app/actions/demo";

export function LoadDemoButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await loadDemoData();
          if (res.ok) {
            toast.success("Demo data loaded", { description: res.message });
            router.refresh();
          } else toast.error(res.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
      {pending ? "Generating sample data…" : "Load demo data"}
    </Button>
  );
}

export function ClearDemoButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await clearDemoData();
          if (res.ok) {
            toast.success("Demo data removed");
            router.refresh();
          } else toast.error(res.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      Remove all demo data
    </Button>
  );
}

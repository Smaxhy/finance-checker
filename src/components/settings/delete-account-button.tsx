"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteAccount } from "@/app/actions/finance";

/** Removes an imported/manual account and its transactions. */
export function DeleteAccountButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!window.confirm(`Delete "${name}" and all of its transactions?`)) return;
          const res = await deleteAccount(id);
          if (res.ok) {
            toast.success("Account deleted");
            router.refresh();
          } else toast.error(res.message);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}

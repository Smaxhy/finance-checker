"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AskBox() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const go = () => router.push(q.trim() ? `/insights/assistant?q=${encodeURIComponent(q.trim())}` : "/insights/assistant");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="card flex items-center gap-2 p-2 transition-colors focus-within:border-accent/60"
    >
      <Sparkles className="ml-2 size-4 text-accent-text" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask anything - e.g. “How much did I spend on Amazon this year?”"
        aria-label="Ask the assistant"
        className="h-9 flex-1 bg-transparent px-1 text-[13.5px] outline-none placeholder:text-muted"
      />
      <Button type="submit" variant="primary" size="icon" aria-label="Ask">
        <ArrowUp />
      </Button>
    </form>
  );
}

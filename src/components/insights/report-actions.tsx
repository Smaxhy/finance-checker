"use client";
import { Download, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

export function ReportActions({ from, to }: { from: string; to: string }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      <a href={`/api/reports/transactions?from=${from}&to=${to}`} className={buttonClass("secondary", "md")} download>
        <Download /> Export CSV
      </a>
      <Button variant="secondary" onClick={() => window.print()}>
        <Printer /> Print
      </Button>
    </div>
  );
}

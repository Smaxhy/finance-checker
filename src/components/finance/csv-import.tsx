"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { importCsv, previewCsvImport, type CsvPreview } from "@/app/actions/finance";
import type { CsvField, CsvMapping } from "@/lib/finance/csv";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const FIELDS: { key: CsvField; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount (signed)" },
  { key: "debit", label: "Debit / money out" },
  { key: "credit", label: "Credit / money in" },
  { key: "description", label: "Description" },
  { key: "counterparty", label: "Counterparty name" },
  { key: "counterpartyAccount", label: "Counterparty IBAN" },
  { key: "currency", label: "Currency" },
  { key: "account", label: "Your account (IBAN)" },
];

export function CsvImportButton() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(params.get("import") === "1");
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({});
  const [accountName, setAccountName] = useState("");
  const [pending, start] = useTransition();

  const reset = () => {
    setText(null);
    setPreview(null);
    setMapping({});
    setFileName("");
  };
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) {
      reset();
      if (params.get("import")) {
        const next = new URLSearchParams(params.toString());
        next.delete("import");
        router.replace(`${pathname}?${next}`, { scroll: false });
      }
    }
  };

  const analyse = (content: string, m?: CsvMapping) =>
    start(async () => {
      const res = await previewCsvImport(content, m);
      if (!res.ok || !res.data) return void toast.error(res.ok ? "Could not read the file" : res.message);
      setPreview(res.data);
      setMapping(res.data.mapping);
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return void toast.error("File is larger than 5 MB");
    const buf = await file.arrayBuffer();
    // Belgian bank exports are often Windows-1252 rather than UTF-8.
    let content = new TextDecoder("utf-8").decode(buf);
    if (content.includes("�")) content = new TextDecoder("windows-1252").decode(buf);
    setText(content);
    setFileName(file.name);
    setAccountName((n) => n || file.name.replace(/\.(csv|txt)$/i, "").slice(0, 60));
    analyse(content);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload /> Import CSV
      </Button>
      <DialogContent
        wide
        title="Import a bank export"
        description="Upload the CSV export from KBC, BNP Paribas Fortis, Belfius, ING, Argenta or any other bank. Columns are detected automatically; re-importing the same file never creates duplicates."
      >
        {!text ? (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-2/40 px-6 py-10 text-center transition-colors hover:bg-surface-2">
            <FileUp className="size-6 text-muted" />
            <span className="mt-2 text-[13px] font-medium">Choose a .csv file</span>
            <span className="mt-1 text-[12px] text-muted">Processed on your server - the file itself is not stored.</span>
            <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        ) : !preview ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Reading {fileName}…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span className="font-medium text-fg">{fileName}</span>
              <span>{preview.validRows} of {preview.totalRows} rows readable</span>
              {preview.dateRange && (
                <span>
                  {formatDate(preview.dateRange.from)} – {formatDate(preview.dateRange.to)}
                </span>
              )}
              {preview.detectedAccount && <span>Account {preview.detectedAccount}</span>}
              <button className="ml-auto text-accent-text hover:underline" onClick={reset}>
                Choose another file
              </button>
            </div>

            <div>
              <p className="mb-2 text-[12.5px] font-medium text-secondary">Column mapping</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <Select
                      value={mapping[f.key] === undefined ? "" : String(mapping[f.key])}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value === "") delete next[f.key];
                        else next[f.key] = Number(e.target.value);
                        setMapping(next);
                        analyse(text, next);
                      }}
                    >
                      <option value="">—</option>
                      {preview.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>

            {preview.errors.length > 0 && (
              <ul className="rounded-lg bg-warning-soft px-3 py-2 text-[12px] text-warning">
                {preview.errors.map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            )}

            {preview.sample.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r, i) => (
                      <tr key={i}>
                        <td className="text-[12.5px] whitespace-nowrap text-muted">{formatDate(r.date, "short")}</td>
                        <td className="max-w-[340px] truncate text-[12.5px]">{r.counterparty ? `${r.counterparty} · ` : ""}{r.description}</td>
                        <td className={cn("text-right text-[12.5px] tabular", r.amount > 0 && "text-positive")}>{formatMoney(r.amount, "EUR", { sign: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="Account name" className="w-64">
                <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. KBC current account" maxLength={80} />
              </Field>
              <Button
                variant="primary"
                disabled={pending || preview.validRows === 0 || !accountName.trim()}
                onClick={() =>
                  start(async () => {
                    const res = await importCsv({ text, mapping, accountName });
                    if (res.ok && res.data) {
                      toast.success(`Imported ${res.data.imported} transactions`, {
                        description: `${res.data.skipped ? `${res.data.skipped} already imported. ` : ""}${res.data.subscriptions ? `${res.data.subscriptions} recurring payments detected.` : ""}`,
                      });
                      close(false);
                    } else toast.error(res.ok ? "Import failed" : res.message);
                  })
                }
              >
                {pending && <Loader2 className="animate-spin" />} Import {preview.validRows} transactions
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

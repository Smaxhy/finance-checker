import { Fragment, type ReactNode } from "react";

/**
 * Renders the assistant's answers: paragraphs, "- " / "1. " lists, **bold**,
 * _italic_, `code`, section titles and small pipe tables. Builds React nodes
 * only (never raw HTML), so model output can't inject markup.
 */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|(?<![\w*])_[^_\n]+_(?!\w))/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return (
        <strong key={i} className="font-semibold text-fg">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return (
        <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-fg">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2) {
      return (
        <em key={i} className="text-muted">
          {p.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
/** Right-align cells that are amounts, percentages or plain numbers. */
const numeric = (v: string) => /^[−+-]?[€$£]?\s?[\d.,]+\s?(%|[€$£]|[A-Z]{3})?$/.test(v.replace(/\*\*/g, "").trim());

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let table: string[][] | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`} className="leading-relaxed">
          {inline(para.join(" "))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`l${blocks.length}`} className={list.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5 marker:text-muted"}>
          {list.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {inline(item)}
            </li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };
  const flushTable = () => {
    if (table && table.length) {
      const [head, ...body] = table;
      blocks.push(
        <div key={`t${blocks.length}`} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-muted">
                {head.map((c, i) => (
                  <th key={i} className={`px-3 py-1.5 font-medium ${body.length && body.every((r) => numeric(r[i] ?? "")) ? "text-right" : ""}`}>
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {body.map((row, r) => (
                <tr key={r}>
                  {head.map((_, i) => (
                    <td key={i} className={`px-3 py-1.5 ${numeric(row[i] ?? "") ? "text-right tabular" : ""}`}>
                      {inline(row[i] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    table = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•])\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line) ?? /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line);
    if (isTableRow(line)) {
      flushPara();
      flushList();
      if (isTableDivider(line)) continue;
      table = [...(table ?? []), cells(line)];
    } else if (heading) {
      flushAll();
      blocks.push(
        <p key={`h${blocks.length}`} className="pt-1 text-[13px] font-semibold text-fg">
          {heading[1].replace(/\*\*/g, "")}
        </p>,
      );
    } else if (bullet || numbered) {
      flushPara();
      flushTable();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else if (line.trim() === "") {
      flushAll();
    } else {
      flushList();
      flushTable();
      para.push(line);
    }
  }
  flushAll();
  return <div className="space-y-2.5">{blocks}</div>;
}

/**
 * Gmail message payload helpers: header lookup, base64url decoding, MIME part
 * walking and HTML → text conversion. Pure functions (no I/O), unit tested.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
}

export function header(msg: Pick<GmailMessage, "payload">, name: string): string | undefined {
  const lower = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** "Zalando <info@zalando.be>" → { name: "Zalando", email: "info@zalando.be" } */
export function parseFrom(value: string | undefined): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const angle = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim();
    return { name: name || null, email: angle[2].trim().toLowerCase() };
  }
  const bare = value.trim();
  if (/^[^\s@]+@[^\s@]+$/.test(bare)) return { name: null, email: bare.toLowerCase() };
  return { name: bare || null, email: null };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ucirc: "û",
  ugrave: "ù",
  icirc: "î",
  iuml: "ï",
  euml: "ë",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  laquo: "«",
  raquo: "»",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "…",
  middot: "·",
  bull: "•",
  rarr: "→",
  larr: "←",
  harr: "↔",
  times: "×",
  deg: "°",
  shy: "",
  zwnj: "",
  zwj: "",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section|td|th)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walks the MIME tree; prefers text/plain, falls back to text/html converted to text. */
export function extractBodyText(payload: GmailMessagePart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailMessagePart) => {
    if (part.filename) return; // attachments
    const type = (part.mimeType ?? "").toLowerCase();
    if (part.body?.data) {
      if (type === "text/plain") plain.push(decodeBase64Url(part.body.data));
      else if (type === "text/html") html.push(decodeBase64Url(part.body.data));
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  const text = plain.join("\n").trim();
  // Some senders put a stub ("view this email in your browser") in text/plain.
  if (text.length >= 80 || html.length === 0) return text.replace(/\r\n/g, "\n");
  return htmlToText(html.join("\n"));
}

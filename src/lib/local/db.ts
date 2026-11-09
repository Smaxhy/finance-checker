/**
 * In-browser database for the GitHub Pages edition.
 *
 * It implements the subset of the supabase-js query builder this app uses
 * (select / insert / upsert / update / delete, PostgREST-style filters, or()
 * strings, ordering, ranges, counts, single rows) plus the SQL functions from
 * the migrations, over in-memory tables persisted to IndexedDB. Everything
 * stays on the device; nothing is sent anywhere.
 */
import { FOREIGN_KEYS, SYSTEM_CATEGORIES, TABLES, withDefaults, type Row } from "./schema";

export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_CHANGE_EVENT = "local-data-changed";

type Filter = (row: Row) => boolean;
interface DbError {
  message: string;
  code?: string;
}
interface Result<T = unknown> {
  data: T;
  error: DbError | null;
  count: number | null;
  status: number;
  statusText: string;
}

// ------------------------------------------------------------------ storage

const store = new Map<string, Row[]>();
let auditSeq = 0;
let readyPromise: Promise<void> | null = null;
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const DB_NAME = "command-centre";
const STORE_NAME = "tables";

function idb(): IDBFactory | null {
  return typeof indexedDB === "undefined" ? null : indexedDB;
}

let dbHandle: Promise<IDBDatabase | null> | null = null;

/** One shared IndexedDB connection (re-opened if the browser closes it). */
function openDb(): Promise<IDBDatabase | null> {
  const factory = idb();
  if (!factory) return Promise.resolve(null);
  if (!dbHandle) {
    dbHandle = new Promise((resolve) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => (dbHandle = null);
        db.onversionchange = () => {
          db.close();
          dbHandle = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbHandle = null;
        resolve(null);
      };
    });
  }
  return dbHandle;
}

async function loadAll() {
  const db = await openDb();
  if (db) {
    await Promise.all(
      Object.keys(TABLES).map(
        (table) =>
          new Promise<void>((resolve) => {
            const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(table);
            req.onsuccess = () => {
              if (Array.isArray(req.result)) store.set(table, req.result as Row[]);
              resolve();
            };
            req.onerror = () => resolve();
          }),
      ),
    );
  }
  for (const t of Object.keys(TABLES)) if (!store.has(t)) store.set(t, []);
  auditSeq = Math.max(0, ...store.get("audit_log")!.map((r) => Number(r.id) || 0));
  // System categories and the single local profile always exist.
  const cats = store.get("categories")!;
  for (const c of SYSTEM_CATEGORIES) if (!cats.some((x) => x.id === c.id)) cats.push({ ...c });
  if (!store.get("profiles")!.some((p) => p.id === LOCAL_USER_ID)) {
    store.get("profiles")!.push(withDefaults("profiles", { id: LOCAL_USER_ID }));
    dirty.add("profiles");
  }
}

/** Resolves once tables are loaded from IndexedDB. Safe to call repeatedly. */
export function ready(): Promise<void> {
  if (!readyPromise) readyPromise = loadAll();
  return readyPromise;
}

async function flush() {
  saveTimer = null;
  if (dirty.size === 0) return;
  const tables = [...dirty];
  dirty.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    for (const t of tables) tx.objectStore(STORE_NAME).put(store.get(t) ?? [], t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function markDirty(table: string) {
  dirty.add(table);
  if (typeof window === "undefined") return; // tests: in-memory only
  if (!saveTimer) saveTimer = setTimeout(flush, 0);
}

export function flushNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  return flush();
}

/** Everything in the store (for the JSON export). */
export async function exportAll(): Promise<Record<string, Row[]>> {
  await ready();
  return Object.fromEntries([...store.entries()].filter(([t]) => t !== "connection_secrets").map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
}

/** Deletes every row (system categories and an empty profile are recreated). */
export async function wipeAll(): Promise<void> {
  await ready();
  for (const t of Object.keys(TABLES)) {
    store.set(t, []);
    dirty.add(t);
  }
  readyPromise = null;
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  store.clear();
  dirty.clear();
  await ready();
  await flushNow();
}

/** Test helper: start from an empty in-memory store. */
export function __resetForTests() {
  store.clear();
  dirty.clear();
  readyPromise = null;
}

function table(name: string): Row[] {
  const rows = store.get(name);
  if (!rows) throw new Error(`Unknown table "${name}"`);
  return rows;
}

// --------------------------------------------------------------- semantics

function cmp(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const na = typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" && !isNaN(Number(a)) && typeof b === "number" ? Number(a) : NaN;
  const nb = typeof b === "number" ? b : typeof b === "string" && b.trim() !== "" && !isNaN(Number(b)) && typeof a === "number" ? Number(b) : NaN;
  if (!isNaN(na) && !isNaN(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

function parseLiteral(v: string): unknown {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function likeToRegex(pattern: string, insensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, insensitive ? "is" : "s");
}

function opFilter(column: string, op: string, value: unknown): Filter {
  switch (op) {
    case "eq":
      return (r) => cmp(r[column], value) === 0;
    case "neq":
      return (r) => {
        const c = cmp(r[column], value);
        return c !== null && c !== 0;
      };
    case "gt":
      return (r) => (cmp(r[column], value) ?? -2) > 0;
    case "gte":
      return (r) => (cmp(r[column], value) ?? -2) >= 0;
    case "lt":
      return (r) => (cmp(r[column], value) ?? 2) < 0;
    case "lte":
      return (r) => (cmp(r[column], value) ?? 2) <= 0;
    case "is":
      return (r) => (value === null ? r[column] === null || r[column] === undefined : r[column] === value);
    case "in": {
      const list = (value as unknown[]).map((v) => String(v));
      return (r) => r[column] !== null && r[column] !== undefined && list.includes(String(r[column]));
    }
    case "like":
    case "ilike": {
      const re = likeToRegex(String(value), op === "ilike");
      return (r) => r[column] !== null && r[column] !== undefined && re.test(String(r[column]));
    }
    default:
      throw new Error(`Unsupported filter operator "${op}"`);
  }
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** PostgREST or() syntax, e.g. "is_important.eq.true,category.in.(bill,trial)". */
function parseOr(expr: string): Filter {
  const filters = splitTopLevel(expr).map((part) => {
    const first = part.indexOf(".");
    const second = part.indexOf(".", first + 1);
    const column = part.slice(0, first);
    let op = part.slice(first + 1, second);
    let raw = part.slice(second + 1);
    let negate = false;
    if (op === "not") {
      negate = true;
      const third = raw.indexOf(".");
      op = raw.slice(0, third);
      raw = raw.slice(third + 1);
    }
    const value = op === "in" ? raw.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")) : parseLiteral(raw);
    const f = opFilter(column, op, value);
    return negate ? (r: Row) => !f(r) : f;
  });
  return (r) => filters.some((f) => f(r));
}

function project(row: Row, columns: string): Row {
  const cols = columns.trim();
  if (!cols || cols === "*") return { ...row };
  const out: Row = {};
  for (const c of cols.split(",").map((x) => x.trim()).filter(Boolean)) out[c] = row[c] ?? null;
  return out;
}

function ok<T>(data: T, count: number | null = null, status = 200): Result<T> {
  return { data, error: null, count, status, statusText: "OK" };
}
function fail(message: string, code?: string, status = 400): Result<null> {
  return { data: null, error: { message, code }, count: null, status, statusText: "Error" };
}

function sameKey(a: Row, b: Row, cols: string[]) {
  return cols.every((c) => a[c] !== null && a[c] !== undefined && String(a[c]) === String(b[c]));
}

function notifyChange() {
  if (typeof window !== "undefined") queueMicrotask(() => window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT)));
}

function cascadeDelete(tableName: string, deleted: Row[]) {
  if (deleted.length === 0) return;
  const ids = new Set(deleted.map((r) => String(r.id ?? r.connection_id)));
  for (const fk of FOREIGN_KEYS.filter((f) => f.references === tableName)) {
    const rows = table(fk.table);
    const affected = rows.filter((r) => r[fk.column] !== null && r[fk.column] !== undefined && ids.has(String(r[fk.column])));
    if (affected.length === 0) continue;
    if (fk.onDelete === "cascade") {
      store.set(fk.table, rows.filter((r) => !affected.includes(r)));
      cascadeDelete(fk.table, affected);
    } else for (const r of affected) r[fk.column] = null;
    markDirty(fk.table);
  }
}

// ------------------------------------------------------------ query builder

type Action = "select" | "insert" | "upsert" | "update" | "delete";

class Query implements PromiseLike<Result<unknown>> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private columns = "*";
  private returning = false;
  private countMode: string | null = null;
  private headOnly = false;
  private singleMode: "single" | "maybe" | null = null;
  private action: Action = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;

  constructor(private readonly tableName: string) {}

  select(columns = "*", opts: { count?: string; head?: boolean } = {}) {
    this.columns = columns;
    if (this.action === "select") {
      this.countMode = opts.count ?? null;
      this.headOnly = Boolean(opts.head);
    } else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.action = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.action = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts.onConflict ? opts.onConflict.split(",").map((c) => c.trim()) : null;
    this.ignoreDuplicates = Boolean(opts.ignoreDuplicates);
    return this;
  }
  update(patch: Row, opts: { count?: string } = {}) {
    this.action = "update";
    this.patch = patch;
    this.countMode = opts.count ?? null;
    return this;
  }
  delete(opts: { count?: string } = {}) {
    this.action = "delete";
    this.countMode = opts.count ?? null;
    return this;
  }

  eq(c: string, v: unknown) {
    this.filters.push(opFilter(c, "eq", v));
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push(opFilter(c, "neq", v));
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push(opFilter(c, "gt", v));
    return this;
  }
  gte(c: string, v: unknown) {
    this.filters.push(opFilter(c, "gte", v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push(opFilter(c, "lt", v));
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push(opFilter(c, "lte", v));
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filters.push(opFilter(c, "in", v));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push(opFilter(c, "is", v));
    return this;
  }
  like(c: string, v: string) {
    this.filters.push(opFilter(c, "like", v));
    return this;
  }
  ilike(c: string, v: string) {
    this.filters.push(opFilter(c, "ilike", v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    const f = opFilter(c, op, v);
    this.filters.push((r) => !f(r));
    return this;
  }
  or(expr: string) {
    this.filters.push(parseOr(expr));
    return this;
  }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  order(column: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const ascending = opts.ascending ?? true;
    this.orders.push({ column, ascending, nullsFirst: opts.nullsFirst ?? !ascending });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  abortSignal() {
    return this;
  }

  then<A = Result<unknown>, B = never>(onfulfilled?: ((value: Result<unknown>) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return ready()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private matches(): Row[] {
    return table(this.tableName).filter((r) => this.filters.every((f) => f(r)));
  }

  private sorted(rows: Row[]): Row[] {
    if (this.orders.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orders) {
        const av = a[o.column];
        const bv = b[o.column];
        const an = av === null || av === undefined;
        const bn = bv === null || bv === undefined;
        if (an && bn) continue;
        if (an || bn) return (an ? -1 : 1) * (o.nullsFirst ? 1 : -1);
        const c = cmp(av, bv) ?? 0;
        if (c !== 0) return o.ascending ? c : -c;
      }
      return 0;
    });
  }

  private shape(rows: Row[], count: number | null): Result<unknown> {
    const projected = rows.map((r) => project(r, this.columns));
    if (this.singleMode === "single") {
      if (projected.length !== 1) return fail(projected.length === 0 ? "JSON object requested, no rows returned" : "JSON object requested, multiple rows returned", "PGRST116", 406);
      return ok(projected[0], count);
    }
    if (this.singleMode === "maybe") {
      if (projected.length > 1) return fail("JSON object requested, multiple rows returned", "PGRST116", 406);
      return ok(projected[0] ?? null, count);
    }
    return ok(projected, count);
  }

  private uniqueViolation(row: Row, existing: Row[], skip?: Row): string[] | null {
    for (const key of TABLES[this.tableName].unique) {
      if (existing.some((e) => e !== skip && sameKey(e, row, key))) return key;
    }
    return null;
  }

  private prepare(row: Row): Row {
    const full = withDefaults(this.tableName, row);
    if (this.tableName === "audit_log" && full.id === undefined) full.id = ++auditSeq;
    return full;
  }

  private execute(): Result<unknown> {
    try {
      const rows = table(this.tableName);
      switch (this.action) {
        case "select": {
          const matched = this.sorted(this.matches());
          const count = this.countMode ? matched.length : null;
          if (this.headOnly) return ok(null, count);
          let page = matched;
          if (this.rangeFrom !== null) page = page.slice(this.rangeFrom, (this.rangeTo ?? page.length) + 1);
          if (this.limitN !== null) page = page.slice(0, this.limitN);
          return this.shape(page, count);
        }
        case "insert": {
          const prepared = this.payload.map((r) => this.prepare(r));
          for (let i = 0; i < prepared.length; i++) {
            const clash = this.uniqueViolation(prepared[i], [...rows, ...prepared.slice(0, i)]);
            if (clash) return fail(`duplicate key value violates unique constraint (${clash.join(", ")})`, "23505", 409);
          }
          rows.push(...prepared);
          markDirty(this.tableName);
          notifyChange();
          return this.returning ? this.shape(prepared, null) : ok(null, null, 201);
        }
        case "upsert": {
          const keys = this.onConflict ?? TABLES[this.tableName].unique[0];
          const affected: Row[] = [];
          for (const input of this.payload) {
            const existing = rows.find((r) => sameKey(r, input, keys));
            if (existing) {
              if (this.ignoreDuplicates) continue;
              for (const [k, v] of Object.entries(input)) if (v !== undefined) existing[k] = v;
              if (TABLES[this.tableName].touchUpdatedAt) existing.updated_at = new Date().toISOString();
              affected.push(existing);
            } else {
              const full = this.prepare(input);
              const clash = this.uniqueViolation(full, rows);
              if (clash) return fail(`duplicate key value violates unique constraint (${clash.join(", ")})`, "23505", 409);
              rows.push(full);
              affected.push(full);
            }
          }
          if (affected.length) {
            markDirty(this.tableName);
            notifyChange();
          }
          return this.returning ? this.shape(affected, null) : ok(null, null, 201);
        }
        case "update": {
          const matched = this.matches();
          for (const r of matched) {
            for (const [k, v] of Object.entries(this.patch)) if (v !== undefined) r[k] = v;
            if (TABLES[this.tableName].touchUpdatedAt && this.patch.updated_at === undefined) r.updated_at = new Date().toISOString();
          }
          if (matched.length) {
            markDirty(this.tableName);
            notifyChange();
          }
          return this.returning ? this.shape(matched, this.countMode ? matched.length : null) : ok(null, this.countMode ? matched.length : null, 204);
        }
        case "delete": {
          const matched = this.matches();
          if (matched.length) {
            store.set(this.tableName, rows.filter((r) => !matched.includes(r)));
            cascadeDelete(this.tableName, matched);
            markDirty(this.tableName);
            notifyChange();
          }
          return this.returning ? this.shape(matched, this.countMode ? matched.length : null) : ok(null, this.countMode ? matched.length : null, 204);
        }
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
}

// --------------------------------------------------------- SQL functions

function trunc(date: string, grain: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (grain === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  if (grain === "week") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }
  return date.slice(0, 10);
}

const SPEND_KINDS = new Set(["expense", "withdrawal", "fee", "refund"]);

function userTx(userId: unknown, from: string, to: string): Row[] {
  const uid = (userId as string) ?? LOCAL_USER_ID;
  return table("transactions").filter((t) => t.user_id === uid && String(t.booked_at) >= from && String(t.booked_at) <= to);
}

function rpc(name: string, args: Record<string, unknown>): Result<unknown> {
  switch (name) {
    case "spending_by_period": {
      const groups = new Map<string, { spent: number; income: number; refunds: number; tx_count: number }>();
      for (const t of userTx(args.p_user_id, String(args.p_from), String(args.p_to))) {
        if (t.kind === "transfer") continue;
        const key = trunc(String(t.booked_at), String(args.p_grain ?? "day"));
        const g = groups.get(key) ?? { spent: 0, income: 0, refunds: 0, tx_count: 0 };
        const a = Number(t.amount);
        if (t.kind === "expense" || t.kind === "withdrawal" || t.kind === "fee") g.spent += -a;
        if (t.kind === "refund") {
          g.spent -= a;
          g.refunds += a;
        }
        if (t.kind === "income") g.income += a;
        g.tx_count++;
        groups.set(key, g);
      }
      return ok([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, g]) => ({ period, ...g })));
    }
    case "spending_by_category": {
      const groups = new Map<string, { spent: number; tx_count: number }>();
      for (const t of userTx(args.p_user_id, String(args.p_from), String(args.p_to))) {
        if (!SPEND_KINDS.has(String(t.kind))) continue;
        const key = (t.category_id as string) ?? "other";
        const g = groups.get(key) ?? { spent: 0, tx_count: 0 };
        g.spent += -Number(t.amount);
        g.tx_count++;
        groups.set(key, g);
      }
      return ok([...groups.entries()].filter(([, g]) => g.spent > 0).sort(([, a], [, b]) => b.spent - a.spent).map(([category_id, g]) => ({ category_id, ...g })));
    }
    case "spending_by_merchant": {
      const groups = new Map<string, { merchant: string; spent: number; tx_count: number; last_seen: string }>();
      for (const t of userTx(args.p_user_id, String(args.p_from), String(args.p_to))) {
        if (!SPEND_KINDS.has(String(t.kind))) continue;
        const name = String(t.merchant ?? t.counterparty_name ?? "Unknown");
        const key = String(t.merchant_key ?? name.toLowerCase());
        const g = groups.get(key) ?? { merchant: name, spent: 0, tx_count: 0, last_seen: "" };
        g.spent += -Number(t.amount);
        g.tx_count++;
        if (String(t.booked_at) > g.last_seen) g.last_seen = String(t.booked_at);
        if (name > g.merchant) g.merchant = name;
        groups.set(key, g);
      }
      const limit = Math.max(1, Math.min(Number(args.p_limit ?? 20), 200));
      return ok(
        [...groups.entries()]
          .filter(([, g]) => g.spent > 0)
          .sort(([, a], [, b]) => b.spent - a.spent)
          .slice(0, limit)
          .map(([merchant_key, g]) => ({ merchant: g.merchant, merchant_key, spent: g.spent, tx_count: g.tx_count, last_seen: g.last_seen })),
      );
    }
    case "log_audit": {
      table("audit_log").push({ id: ++auditSeq, user_id: LOCAL_USER_ID, action: String(args.p_action).slice(0, 80), details: args.p_details ?? {}, created_at: new Date().toISOString() });
      markDirty("audit_log");
      return ok(null, null, 204);
    }
    default:
      return fail(`Unknown function ${name}`);
  }
}

// ------------------------------------------------------------------ client

export const localDb = {
  from(tableName: string) {
    return new Query(tableName);
  },
  rpc(name: string, args: Record<string, unknown> = {}) {
    return { then: (ok: (r: Result<unknown>) => unknown, err?: (e: unknown) => unknown) => ready().then(() => rpc(name, args)).then(ok, err) };
  },
  auth: {
    async getUser() {
      return { data: { user: { id: LOCAL_USER_ID, email: null } }, error: null };
    },
    async getClaims() {
      return { data: { claims: { sub: LOCAL_USER_ID } }, error: null };
    },
    async signOut() {
      return { error: null };
    },
  },
};

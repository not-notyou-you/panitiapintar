import "server-only";
// /admin/logs data (LOGGING §8, INTERFACE §4.9). Every read uses the super admin's JWT client, so the
// RLS policies audit_super_read / ai_calls_super_read and security_rate_limit_windows() still decide.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@/lib/log/audit-schema";
import { RATE_LIMITS, type RateLimitBucket } from "@/lib/rate-limit";

export const LOG_TABS = ["audit", "ai", "keamanan"] as const;
export type LogTab = (typeof LOG_TABS)[number];
export const RANGES = { "1": 1, "7": 7, "30": 30 } as const;
const MAX_ROWS = 500;
const MAX_AI_ROWS = 5000;

// searchParams are untrusted (CLAUDE.md rule 5): anything invalid falls back to the default.
const fallback = <T extends z.ZodType>(schema: T, value: z.infer<T>) => schema.catch(value);
export const logFilterSchema = z.object({
  tab: fallback(z.enum(LOG_TABS), "audit"),
  range: fallback(z.enum(["1", "7", "30"]), "7"),
  committee: fallback(z.uuid().optional(), undefined),
  action: fallback(z.enum(AUDIT_ACTIONS).optional(), undefined),
  outcome: fallback(z.enum(["success", "denied", "failure"]).optional(), undefined),
  detail: fallback(z.coerce.number().int().positive().optional(), undefined),
});
export type LogFilter = z.infer<typeof logFilterSchema>;

export function parseLogFilter(sp: Record<string, string | string[] | undefined>): LogFilter {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) || undefined;
  return logFilterSchema.parse({
    tab: one("tab"),
    range: one("range"),
    committee: one("committee"),
    action: one("action"),
    outcome: one("outcome"),
    detail: one("detail"),
  });
}

export const sinceIso = (f: LogFilter, now = Date.now()) =>
  new Date(now - RANGES[f.range] * 86_400_000).toISOString();

export class LogReadError extends Error {
  constructor(readonly code: string) {
    super(`log read failed: ${code}`);
    this.name = "LogReadError";
  }
}

export interface AuditRow {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  committee_id: string | null;
  outcome: "success" | "denied" | "failure";
  metadata: Record<string, unknown>;
  request_id: string | null;
  actorName: string;
}

const AUDIT_COLUMNS =
  "id, occurred_at, actor_id, actor_role, action, target_type, target_id, committee_id, outcome, metadata, request_id";

/** Display names only (never emails). Unknown or deleted users fall back to their role. */
async function withActorNames(
  client: SupabaseClient,
  rows: Omit<AuditRow, "actorName">[],
): Promise<AuditRow[]> {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await client.from("profiles").select("user_id, display_name").in("user_id", ids);
    for (const p of data ?? []) if (p.display_name) names.set(p.user_id as string, p.display_name as string);
  }
  return rows.map((r) => ({
    ...r,
    actorName: r.actor_id
      ? (names.get(r.actor_id) ?? `(${r.actor_role})`)
      : r.actor_role === "system"
        ? "(sistem)"
        : "(anonim)",
  }));
}

export async function fetchAudit(client: SupabaseClient, f: LogFilter): Promise<AuditRow[]> {
  let q = client.from("audit_logs").select(AUDIT_COLUMNS).gte("occurred_at", sinceIso(f));
  if (f.committee) q = q.eq("committee_id", f.committee);
  if (f.action) q = q.eq("action", f.action);
  if (f.outcome) q = q.eq("outcome", f.outcome);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(MAX_ROWS);
  if (error) throw new LogReadError(error.code ?? "unknown");
  return withActorNames(client, (data ?? []) as Omit<AuditRow, "actorName">[]);
}

export interface AiCallRow {
  id: number;
  occurred_at: string;
  request_id: string;
  purpose: string;
  committee_id: string | null;
  model: string;
  fallback_used: boolean;
  attempt: number;
  status: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error_code: string | null;
}

export async function fetchAiCalls(client: SupabaseClient, f: LogFilter): Promise<AiCallRow[]> {
  let q = client
    .from("ai_calls")
    .select(
      "id, occurred_at, request_id, purpose, committee_id, model, fallback_used, attempt, status, latency_ms, input_tokens, output_tokens, error_code",
    )
    .gte("occurred_at", sinceIso(f));
  if (f.committee) q = q.eq("committee_id", f.committee);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(MAX_AI_ROWS);
  if (error) throw new LogReadError(error.code ?? "unknown");
  return (data ?? []) as AiCallRow[];
}

const TZ_OFFSET_MS = 7 * 3_600_000; // WIB, no DST
const wibDay = (iso: string) => new Date(new Date(iso).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

export interface AiStats {
  callsToday: number;
  avgLatencyMs: number | null;
  errorRate: number | null;
  fallbackRate: number | null;
  hourly: { hour: string; calls: number; errors: number }[];
  tokensPerDay: { day: string; input: number; output: number }[];
}

/** Pure: cards, the last-24-hours chart (WIB), and token totals per day. */
export function aiStats(rows: AiCallRow[], now = Date.now()): AiStats {
  const today = wibDay(new Date(now).toISOString());
  const todays = rows.filter((r) => wibDay(r.occurred_at) === today);
  const n = rows.length;
  const avg = n ? Math.round(rows.reduce((s, r) => s + r.latency_ms, 0) / n) : null;

  const hourMs = 3_600_000;
  const endHour = Math.floor(now / hourMs) * hourMs;
  const hourly = Array.from({ length: 24 }, (_, i) => {
    const start = endHour - (23 - i) * hourMs;
    const label = new Date(start + TZ_OFFSET_MS).toISOString().slice(11, 13);
    return { start, hour: label, calls: 0, errors: 0 };
  });
  for (const r of rows) {
    const t = new Date(r.occurred_at).getTime();
    const idx = 23 - Math.floor((endHour - Math.floor(t / hourMs) * hourMs) / hourMs);
    const slot = hourly[idx];
    if (!slot) continue;
    slot.calls += 1;
    if (r.status !== "ok") slot.errors += 1;
  }

  const days = new Map<string, { input: number; output: number }>();
  for (const r of rows) {
    const d = wibDay(r.occurred_at);
    const cur = days.get(d) ?? { input: 0, output: 0 };
    cur.input += r.input_tokens ?? 0;
    cur.output += r.output_tokens ?? 0;
    days.set(d, cur);
  }

  return {
    callsToday: todays.length,
    avgLatencyMs: avg,
    errorRate: n ? rows.filter((r) => r.status !== "ok").length / n : null,
    fallbackRate: n ? rows.filter((r) => r.fallback_used).length / n : null,
    hourly: hourly.map(({ hour, calls, errors }) => ({ hour, calls, errors })),
    tokensPerDay: [...days.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, t]) => ({ day, ...t })),
  };
}

export interface RateLimitEvent {
  bucket: string;
  window: string;
  key: string;
  windowStart: string;
  hits: number;
  limit: number;
}

/** Pure: keeps only windows whose hits exceeded the configured max for that bucket/window. */
export function exceededWindows(
  rows: { bucket: string; window_start: string; hits: number }[],
): RateLimitEvent[] {
  const out: RateLimitEvent[] = [];
  for (const r of rows) {
    const [bucket, window, ...rest] = r.bucket.split(":");
    const conf = RATE_LIMITS[bucket as RateLimitBucket]?.find((w) => w.name === window);
    if (!conf || r.hits <= conf.max) continue;
    // Keys are hashes or ids already; shorten them for display anyway.
    out.push({
      bucket: bucket!,
      window: window!,
      key: rest.join(":").slice(0, 12),
      windowStart: r.window_start,
      hits: r.hits,
      limit: conf.max,
    });
  }
  return out;
}

export interface SecurityData {
  denied: AuditRow[];
  rateLimited: RateLimitEvent[];
}

/** Last 7 days at most (LOGGING §8): access denials, canary leaks, rate-limit windows that overflowed. */
export async function fetchSecurity(client: SupabaseClient, f: LogFilter): Promise<SecurityData> {
  const since = new Date(
    Math.max(new Date(sinceIso(f)).getTime(), Date.now() - 7 * 86_400_000),
  ).toISOString();
  let q = client
    .from("audit_logs")
    .select(AUDIT_COLUMNS)
    .gte("occurred_at", since)
    .or("outcome.eq.denied,action.eq.security.canary_leaked");
  if (f.committee) q = q.eq("committee_id", f.committee);
  const [{ data, error }, rl] = await Promise.all([
    q.order("occurred_at", { ascending: false }).limit(MAX_ROWS),
    client.rpc("security_rate_limit_windows", { p_since: since }),
  ]);
  if (error) throw new LogReadError(error.code ?? "unknown");
  if (rl.error) throw new LogReadError(rl.error.code ?? "unknown");
  return {
    denied: await withActorNames(client, (data ?? []) as Omit<AuditRow, "actorName">[]),
    rateLimited: exceededWindows((rl.data ?? []) as { bucket: string; window_start: string; hits: number }[]),
  };
}

/** RFC 4180 CSV. Cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheets do not run them. */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCsv(client: SupabaseClient, f: LogFilter): Promise<string> {
  if (f.tab === "ai") {
    const rows = await fetchAiCalls(client, f);
    return toCsv(
      [
        "occurred_at",
        "request_id",
        "purpose",
        "committee_id",
        "model",
        "attempt",
        "fallback_used",
        "status",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "error_code",
      ],
      rows.map((r) => [
        r.occurred_at,
        r.request_id,
        r.purpose,
        r.committee_id,
        r.model,
        r.attempt,
        r.fallback_used,
        r.status,
        r.latency_ms,
        r.input_tokens,
        r.output_tokens,
        r.error_code,
      ]),
    );
  }
  const rows = f.tab === "keamanan" ? (await fetchSecurity(client, f)).denied : await fetchAudit(client, f);
  return toCsv(
    [
      "occurred_at",
      "actor",
      "actor_role",
      "action",
      "target_type",
      "target_id",
      "committee_id",
      "outcome",
      "request_id",
      "metadata",
    ],
    rows.map((r) => [
      r.occurred_at,
      r.actorName,
      r.actor_role,
      r.action,
      r.target_type,
      r.target_id,
      r.committee_id,
      r.outcome,
      r.request_id,
      JSON.stringify(r.metadata),
    ]),
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccessDenied } from "@/components/internal/admin/AccessDenied";
import { AdminShell } from "@/components/internal/admin/AdminShell";
import { CopyButton } from "@/components/internal/ui/CopyButton";
import { ErrorState } from "@/components/internal/ui/ErrorState";
import { Window } from "@/components/internal/ui/Window";
import {
  aiStats,
  fetchAiCalls,
  fetchAudit,
  fetchSecurity,
  LogReadError,
  parseLogFilter,
  type AiStats,
  type AuditRow,
  type LogFilter,
} from "@/lib/admin/logs";
import { pageSuperAdmin } from "@/lib/auth/page";
import { AUDIT_ACTIONS } from "@/lib/log/audit-schema";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Log" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TAB_LABEL = { audit: "Audit", ai: "AI", keamanan: "Keamanan" } as const;
const OUTCOME_LABEL = { success: "SUCCESS", denied: "DENIED", failure: "FAILURE" } as const;

const fmt = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});
const when = (iso: string) => fmt.format(new Date(iso)).replace(",", "");

function href(f: LogFilter, patch: Partial<LogFilter>): string {
  const merged = { ...f, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged))
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  return `?${qs.toString()}`;
}

function exportHref(f: LogFilter): string {
  const qs = new URLSearchParams();
  for (const k of ["tab", "range", "committee", "action", "outcome"] as const)
    if (f[k]) qs.set(k, String(f[k]));
  return `/api/admin/logs/export?${qs.toString()}`;
}

// INTERFACE §4.9 / LOGGING §8. Super admin only (page guard + RLS on every table read).
export default async function LogsPage({ searchParams }: Props) {
  const access = await pageSuperAdmin("/admin/logs");
  if (!access.ok) {
    return (
      <AdminShell>
        <AccessDenied requestId={access.requestId} />
      </AdminShell>
    );
  }
  const { client } = access.value;
  const f = parseLogFilter(await searchParams);
  const { data: committees } = await client.from("committees").select("id, name").order("name");
  const names = new Map((committees ?? []).map((c) => [c.id as string, c.name as string]));

  let body: ReactNode;
  try {
    if (f.tab === "audit") body = <AuditTable rows={await fetchAudit(client, f)} f={f} names={names} />;
    else if (f.tab === "ai") body = <AiPanel stats={aiStats(await fetchAiCalls(client, f))} />;
    else {
      const sec = await fetchSecurity(client, f);
      body = (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h2 className="font-pixel m-0 text-sm uppercase">Akses ditolak &amp; kanari</h2>
            <AuditTable rows={sec.denied} f={f} names={names} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="font-pixel m-0 text-sm uppercase">Batas permintaan terlampaui</h2>
            <p className="text-mut m-0 text-xs">
              Jendela rate limit disimpan 2 hari; kunci berupa hash/ID, bukan IP.
            </p>
            {sec.rateLimited.length === 0 ? (
              <p className="text-mut m-0 text-xs">Tidak ada.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Mulai jendela</th>
                    <th>Bucket</th>
                    <th>Kunci</th>
                    <th>Hit / batas</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rateLimited.map((r) => (
                    <tr key={`${r.bucket}:${r.window}:${r.key}:${r.windowStart}`}>
                      <td>{when(r.windowStart)}</td>
                      <td>
                        {r.bucket}:{r.window}
                      </td>
                      <td>
                        <code>{r.key}…</code>
                      </td>
                      <td>
                        <span className="badge badge-failed">
                          {r.hits} / {r.limit}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      );
    }
  } catch (err) {
    if (!(err instanceof LogReadError)) throw err;
    body = <ErrorState message="Log tidak dapat dimuat. Coba lagi nanti." requestId={access.requestId} />;
  }

  return (
    <AdminShell superAdmin>
      <Window title="Log">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <nav className="tabs" aria-label="Jenis log">
              {(Object.keys(TAB_LABEL) as (keyof typeof TAB_LABEL)[]).map((t) => (
                <Link
                  key={t}
                  href={href(f, { tab: t, detail: undefined })}
                  className="tab"
                  aria-current={f.tab === t ? "page" : undefined}
                >
                  {TAB_LABEL[t]}
                </Link>
              ))}
            </nav>
            <form method="get" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value={f.tab} />
              <label className="label">
                Rentang
                <select name="range" defaultValue={f.range} className="field">
                  <option value="1">24 jam</option>
                  <option value="7">7 hari</option>
                  <option value="30">30 hari</option>
                </select>
              </label>
              <label className="label">
                Acara
                <select name="committee" defaultValue={f.committee ?? ""} className="field">
                  <option value="">Semua</option>
                  {(committees ?? []).map((c) => (
                    <option key={c.id as string} value={c.id as string}>
                      {c.name as string}
                    </option>
                  ))}
                </select>
              </label>
              {f.tab === "audit" ? (
                <>
                  <label className="label">
                    Aksi
                    <select name="action" defaultValue={f.action ?? ""} className="field">
                      <option value="">Semua</option>
                      {AUDIT_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="label">
                    Hasil
                    <select name="outcome" defaultValue={f.outcome ?? ""} className="field">
                      <option value="">Semua</option>
                      <option value="success">Success</option>
                      <option value="denied">Denied</option>
                      <option value="failure">Failure</option>
                    </select>
                  </label>
                </>
              ) : null}
              <button type="submit" className="btn btn-ghost">
                Terapkan
              </button>
            </form>
          </div>
          {body}
          <div className="flex justify-end">
            <a href={exportHref(f)} className="btn no-underline" download>
              Ekspor CSV
            </a>
          </div>
        </div>
      </Window>
    </AdminShell>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditRow["outcome"] }) {
  return (
    <span className={`badge ${outcome === "success" ? "badge-outline" : "badge-failed"}`}>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function AuditTable({ rows, f, names }: { rows: AuditRow[]; f: LogFilter; names: Map<string, string> }) {
  if (rows.length === 0) return <p className="text-mut m-0 text-xs">Belum ada catatan untuk filter ini.</p>;
  const selected = f.detail ? rows.find((r) => r.id === f.detail) : undefined;
  return (
    <div className={selected ? "grid gap-4 lg:grid-cols-[1fr_320px]" : ""}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Aktor</th>
              <th>Aksi</th>
              <th>Acara</th>
              <th>Hasil</th>
              <th>Request</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} aria-selected={selected?.id === r.id ? true : undefined}>
                <td className="whitespace-nowrap">{when(r.occurred_at)}</td>
                <td>{r.actorName}</td>
                <td>
                  <Link href={href(f, { detail: r.id })} scroll={false}>
                    {r.action}
                  </Link>
                </td>
                <td>{r.committee_id ? (names.get(r.committee_id) ?? "-") : "-"}</td>
                <td>
                  <OutcomeBadge outcome={r.outcome} />
                </td>
                <td>
                  <code className="text-[11px]">{r.request_id ? `${r.request_id.slice(0, 12)}…` : "-"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <aside className="win p-3" aria-label="Detail catatan">
          <div className="flex items-center justify-between gap-2">
            <strong className="font-pixel text-sm">{selected.action}</strong>
            <Link href={href(f, { detail: undefined })} scroll={false} aria-label="Tutup detail">
              x
            </Link>
          </div>
          <dl className="m-0 mt-2 grid grid-cols-[90px_1fr] gap-1 text-xs">
            <dt>Waktu</dt>
            <dd className="m-0">{when(selected.occurred_at)}</dd>
            <dt>Aktor</dt>
            <dd className="m-0">
              {selected.actorName} ({selected.actor_role})
            </dd>
            <dt>Target</dt>
            <dd className="m-0 break-all">
              {selected.target_type} {selected.target_id ?? ""}
            </dd>
            <dt>Hasil</dt>
            <dd className="m-0">
              <OutcomeBadge outcome={selected.outcome} />
            </dd>
            <dt>Request</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2 break-all">
              <code>{selected.request_id ?? "-"}</code>
              {selected.request_id ? <CopyButton value={selected.request_id} /> : null}
            </dd>
          </dl>
          <p className="font-pixel m-0 mt-3 text-xs uppercase">metadata</p>
          <pre className="pane m-0 mt-1">{JSON.stringify(selected.metadata, null, 2)}</pre>
        </aside>
      ) : null}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);

function AiPanel({ stats }: { stats: AiStats }) {
  const max = Math.max(1, ...stats.hourly.map((h) => h.calls));
  const W = 24 * 20;
  const H = 120;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Panggilan hari ini" value={String(stats.callsToday)} />
        <StatCard
          label="Rata-rata latensi"
          value={stats.avgLatencyMs === null ? "-" : `${stats.avgLatencyMs} ms`}
        />
        <StatCard label="Error / fallback" value={`${pct(stats.errorRate)} / ${pct(stats.fallbackRate)}`} />
      </div>
      <figure className="m-0 flex flex-col gap-2">
        <figcaption className="font-pixel text-sm uppercase">
          Panggilan per jam (24 jam terakhir, WIB)
        </figcaption>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H + 18}`}
            className="h-auto w-full min-w-[480px]"
            role="img"
            aria-label={`Grafik batang panggilan AI per jam, maksimum ${max} panggilan`}
          >
            <line x1="0" y1={H} x2={W} y2={H} stroke="var(--line)" strokeWidth="2" />
            {stats.hourly.map((h, i) => {
              const bh = Math.round((h.calls / max) * (H - 8));
              return (
                <g key={i}>
                  <rect x={i * 20 + 3} y={H - bh} width="14" height={bh} fill="var(--acc)">
                    <title>{`${h.hour}.00: ${h.calls} panggilan, ${h.errors} gagal`}</title>
                  </rect>
                  {i % 3 === 0 ? (
                    <text x={i * 20 + 10} y={H + 14} textAnchor="middle" fontSize="10" fill="var(--mut)">
                      {h.hour}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </figure>
      <section className="flex flex-col gap-2">
        <h2 className="font-pixel m-0 text-sm uppercase">Token per hari</h2>
        {stats.tokensPerDay.length === 0 ? (
          <p className="text-mut m-0 text-xs">Belum ada panggilan.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th className="text-right">Input</th>
                <th className="text-right">Output</th>
              </tr>
            </thead>
            <tbody>
              {stats.tokensPerDay.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td className="text-right">{d.input.toLocaleString("id-ID")}</td>
                  <td className="text-right">{d.output.toLocaleString("id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--card-hi)] p-3">
      <span className="text-mut text-xs">{label}</span>
      <span className="font-pixel text-2xl">{value}</span>
    </div>
  );
}

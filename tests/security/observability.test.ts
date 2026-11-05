// ROADMAP 4.1–4.3: /admin/logs data paths, chat log isolation, retention cron. SEC-03, SEC-12, SEC-13.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { fetchAudit, fetchSecurity, parseLogFilter } from "@/lib/admin/logs";
import { handleLogExport } from "@/lib/api/admin-logs";
import { handleRetention } from "@/lib/api/system";
import { anon, dbAvailable, must, requestId, service } from "../helpers/db";
import { ctxFor, setupActors, uploadDeps, type Actors } from "../helpers/phase2";

const SECRET = "test-cron-secret-0123456789";

describe.skipIf(!dbAvailable)("observability", () => {
  let a: Actors;
  let rid: string;
  beforeAll(async () => {
    a = await setupActors("ob");
    rid = requestId();
    must(
      await service()
        .from("audit_logs")
        .insert({
          actor_id: a.admin.id,
          actor_role: "admin",
          action: "document.approve",
          target_type: "document",
          target_id: randomUUID(),
          committee_id: a.A.id,
          outcome: "success",
          metadata: { edited: false },
          request_id: rid,
        }),
    );
    must(
      await service()
        .from("chat_logs")
        .insert([
          {
            committee_id: a.A.id,
            mode: "public",
            question_redacted: "pertanyaan A tak terjawab",
            answered: false,
            request_id: rid,
          },
          {
            committee_id: a.B.id,
            mode: "public",
            question_redacted: "pertanyaan B tak terjawab",
            answered: false,
            request_id: rid,
          },
        ]),
    );
    // Over the chat_public per-minute max (10).
    must(
      await service()
        .from("rate_limits")
        .insert({
          bucket: `chat_public:min:ob${randomUUID().slice(0, 8)}`,
          window_start: new Date().toISOString(),
          hits: 15,
        }),
    );
  });

  describe("CSV export is super admin only", () => {
    const call = (c: SupabaseClient) =>
      handleLogExport(new URLSearchParams("tab=audit&range=1"), uploadDeps(c));
    it.each([
      ["anon", 401],
      ["member", 403],
      ["admin", 403],
      ["otherAdmin", 403],
    ] as const)("as %s → %i", async (actor, status) => {
      const client = actor === "anon" ? anon() : a[actor].client;
      expect((await call(client)).status).toBe(status);
    });
    it("as super admin → CSV with the approve row and its requestId", async () => {
      const res = await call(a.superAdmin.client);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      expect(res.headers.get("cache-control")).toContain("no-store");
      const text = await res.text();
      expect(text).toContain("document.approve");
      expect(text).toContain(rid);
      expect(text).not.toContain("@contoh.test");
    });
  });

  it("audit_logs and ai_calls are invisible to committee admins through RLS", async () => {
    expect(must(await a.admin.client.from("audit_logs").select("id").eq("request_id", rid))).toEqual([]);
    expect(must(await a.admin.client.from("ai_calls").select("id").limit(1))).toEqual([]);
  });

  it("fetchAudit filters by action/outcome/committee and shows display names, not emails", async () => {
    const f = parseLogFilter({
      range: "1",
      committee: a.A.id,
      action: "document.approve",
      outcome: "success",
    });
    const rows = await fetchAudit(a.superAdmin.client, f);
    const row = rows.find((r) => r.request_id === rid);
    expect(row).toBeDefined();
    expect(row!.actorName).not.toContain("@");
    expect(rows.every((r) => r.committee_id === a.A.id && r.outcome === "success")).toBe(true);
  });

  it("security_rate_limit_windows: denied for non super admins, overflowing windows for super admin", async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    for (const c of [a.admin.client, anon()]) {
      const { error } = await c.rpc("security_rate_limit_windows", { p_since: since });
      expect(error).not.toBeNull();
    }
    const sec = await fetchSecurity(a.superAdmin.client, parseLogFilter({ tab: "keamanan", range: "1" }));
    expect(sec.rateLimited.some((r) => r.bucket === "chat_public" && r.hits === 15 && r.limit === 10)).toBe(
      true,
    );
  });

  it("chat log: admin sees unanswered questions of own committee only", async () => {
    const own = must(
      await a.admin.client.from("chat_logs").select("question_redacted").eq("request_id", rid),
    ) as {
      question_redacted: string;
    }[];
    expect(own.map((r) => r.question_redacted)).toEqual(["pertanyaan A tak terjawab"]);
    expect(must(await a.member.client.from("chat_logs").select("id").eq("request_id", rid))).toEqual([]);
  });

  describe("GET /api/cron/retention", () => {
    const run = (auth: string | null) => {
      const { ctx, lines } = ctxFor(service());
      const headers: Record<string, string> = auth ? { authorization: auth } : {};
      return {
        lines,
        res: handleRetention(new Request("http://localhost/api/cron/retention", { headers }), {
          log: ctx.log,
          requestId: ctx.requestId,
          secret: SECRET,
          svc: service(),
        }),
        requestId: ctx.requestId,
      };
    };

    it.each([null, "Bearer wrong", SECRET])("rejects %s with 401 and purges nothing", async (auth) => {
      const r = run(auth);
      expect((await r.res).status).toBe(401);
      expect(r.lines.join("\n")).not.toContain("retention.purge.completed");
    });

    it("with the secret: purges, logs retention.purge.completed and audits system.retention_purge", async () => {
      const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const stale = `chat_public:min:obstale${randomUUID().slice(0, 6)}`;
      must(await service().from("rate_limits").insert({ bucket: stale, window_start: old, hits: 1 }));
      const r = run(`Bearer ${SECRET}`);
      const res = await r.res;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { purged: Record<string, number> };
      expect(body.purged.rate_limits).toBeGreaterThanOrEqual(1);
      expect(r.lines.some((l) => l.includes('"event":"retention.purge.completed"'))).toBe(true);
      expect(must(await service().from("rate_limits").select("bucket").eq("bucket", stale))).toEqual([]);
      const audit = must(
        await service()
          .from("audit_logs")
          .select("action, outcome, actor_role")
          .eq("request_id", r.requestId),
      );
      expect(audit).toEqual([{ action: "system.retention_purge", outcome: "success", actor_role: "system" }]);
    });

    it("purge_expired_logs cannot be called by users", async () => {
      const { error } = await a.superAdmin.client.rpc("purge_expired_logs", {
        p_chat_days: 30,
        p_ai_days: 90,
        p_audit_days: 180,
      });
      expect(error).not.toBeNull();
    });
  });
});

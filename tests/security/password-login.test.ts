// Email + password login (SEC-07 rate limit, SEC-12 no raw email/password in logs, no enumeration),
// self-service password change, and member invites that create an account with a one-time password.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { changePassword, LOGIN_FAILED, signInWithPassword, type LoginDeps } from "@/lib/actions/auth";
import { serviceFindOrInvite, tempPassword } from "@/lib/actions/members";
import { anon, dbAvailable, must, service } from "../helpers/db";
import { ctxFor } from "../helpers/phase2";

const allow: LoginDeps = { ipHash: "test", rateLimit: async () => ({ ok: true }) };

describe("tempPassword", () => {
  it("is 16 chars without look-alike characters and differs each call", () => {
    const a = tempPassword();
    expect(a).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{16}$/);
    expect(tempPassword()).not.toBe(a);
  });
});

describe.skipIf(!dbAvailable)("password login", () => {
  const password = `pw-${randomUUID()}`;
  let email: string;
  let userId: string;

  beforeAll(async () => {
    email = `pwl-${randomUUID().slice(0, 8)}@contoh.test`;
    const { user } = must(await service().auth.admin.createUser({ email, password, email_confirm: true }));
    userId = user!.id;
  });

  it("correct password signs in, audits auth.login, logs userId only", async () => {
    const { ctx, lines } = ctxFor(anon());
    const r = await signInWithPassword({ email, password, next: "/admin" }, ctx, allow);
    expect(r).toMatchObject({ ok: true, data: { next: "/admin" } });
    expect((await ctx.client.auth.getUser()).data.user?.id).toBe(userId);
    const log = lines.join("\n");
    expect(log).toContain('"event":"auth.login.succeeded"');
    expect(log).not.toContain(email);
    expect(log).not.toContain(password);
  });

  it("wrong password and unknown email get the same message (no enumeration)", async () => {
    for (const input of [
      { email, password: "salah-sekali" },
      { email: `tidak-ada-${randomUUID().slice(0, 8)}@contoh.test`, password: "apa-saja" },
    ]) {
      const { ctx, lines } = ctxFor(anon());
      const r = await signInWithPassword(input, ctx, allow);
      expect(r).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED", message: LOGIN_FAILED } });
      expect(lines.join("\n")).not.toContain(input.password);
    }
  });

  it("open redirect in next is neutralised", async () => {
    const { ctx } = ctxFor(anon());
    const r = await signInWithPassword({ email, password, next: "//evil.example" }, ctx, allow);
    expect(r.ok && r.data.next.startsWith("/")).toBe(true);
    expect(r.ok && r.data.next.startsWith("//")).toBe(false);
  });

  it("rate limit blocks before Supabase is asked", async () => {
    const { ctx } = ctxFor(anon());
    const r = await signInWithPassword({ email, password }, ctx, {
      ipHash: "t",
      rateLimit: async () => ({ ok: false, retryAfterSeconds: 60, limit: 5, window: "hour" }),
    });
    expect(r).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
  });

  it("change password: needs the current one, then the new one works", async () => {
    const client = anon();
    must(await client.auth.signInWithPassword({ email, password }));
    const bad = await changePassword(
      { currentPassword: "keliru-123", newPassword: "baru-sekali-123" },
      ctxFor(client).ctx,
      allow,
    );
    expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    const fresh = `baru-${randomUUID()}`;
    const { ctx, lines } = ctxFor(client);
    const ok = await changePassword({ currentPassword: password, newPassword: fresh }, ctx, allow);
    expect(ok.ok).toBe(true);
    expect(lines.join("\n")).not.toContain(fresh);
    expect((await anon().auth.signInWithPassword({ email, password: fresh })).error).toBeNull();
    expect((await anon().auth.signInWithPassword({ email, password })).error).not.toBeNull();
  });

  it("change password requires a session", async () => {
    const r = await changePassword(
      { currentPassword: "x", newPassword: "yyyyyyyy" },
      ctxFor(anon()).ctx,
      allow,
    );
    expect(r).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("invite creates a confirmed account whose temporary password signs in; existing users get none", async () => {
    const find = serviceFindOrInvite(service());
    const newEmail = `pwi-${randomUUID().slice(0, 8)}@contoh.test`;
    const created = await find(newEmail);
    expect(created.invited).toBe(true);
    expect(created.tempPassword).toHaveLength(16);
    const s = await anon().auth.signInWithPassword({ email: newEmail, password: created.tempPassword! });
    expect(s.error).toBeNull();
    const again = await find(newEmail);
    expect(again).toEqual({ userId: created.userId, invited: false });
  });
});

import type { Metadata } from "next";
import { LoginForm } from "@/components/internal/admin/LoginForm";
import { PageHeader } from "@/components/internal/ui/PageHeader";
import { Window } from "@/components/internal/ui/Window";
import { env } from "@/lib/env";
import { emailSchema, safeNextPath } from "@/lib/validation/admin";

// Seed accounts (supabase/seed.sql, all fictional @contoh.test). Listed only outside production so
// testers know how to sign in; the magic link arrives in the local Mailpit inbox.
const TEST_ACCOUNTS = [
  { email: "superadmin@contoh.test", role: "Super admin", note: "semua acara + log" },
  { email: "admin.festek@contoh.test", role: "Admin", note: "Festival Teknologi Fiktif" },
  { email: "admin.lomba@contoh.test", role: "Admin", note: "Lomba Desain Poster Fiktif" },
  { email: "admin.seminar@contoh.test", role: "Admin", note: "Seminar Karier Fiktif" },
  { email: "anggota.festek@contoh.test", role: "Anggota", note: "Festival Teknologi Fiktif" },
] as const;
const MAILPIT_URL = "http://127.0.0.1:54324";

export const metadata: Metadata = { title: "PanitiaPintar · Masuk" };

type Props = { searchParams: Promise<{ next?: string; error?: string; email?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const showTestAccounts = env().APP_ENV !== "production";
  const prefill = showTestAccounts ? emailSchema.safeParse(sp.email ?? "") : null;
  const initialEmail =
    prefill?.success && TEST_ACCOUNTS.some((a) => a.email === prefill.data) ? prefill.data : "";
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-5">
      <PageHeader subtitle="Masuk panitia" />
      <Window title="Masuk">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-xs">
            Masukkan email yang didaftarkan admin kepanitiaan. Kami kirim tautan masuk sekali pakai.
          </p>
          {sp.error ? (
            <p role="alert" className="pii m-0">
              Tautan masuk tidak valid atau kedaluwarsa. Minta tautan baru.
            </p>
          ) : null}
          <LoginForm key={initialEmail} next={safeNextPath(sp.next)} initialEmail={initialEmail} />
        </div>
      </Window>
      {showTestAccounts ? (
        <section aria-labelledby="test-accounts" className="test-accounts flex flex-col gap-3 p-4">
          <h2 id="test-accounts" className="m-0 text-sm">
            Akun uji (hanya di lingkungan lokal)
          </h2>
          <p className="m-0 text-xs leading-relaxed">
            Pilih akun untuk mengisi email, klik <strong>Kirim tautan masuk</strong>, lalu buka email tautan
            masuknya di{" "}
            <a href={MAILPIT_URL} target="_blank" rel="noreferrer">
              Mailpit ({MAILPIT_URL.replace("http://", "")})
            </a>
            .
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
            {TEST_ACCOUNTS.map((a) => {
              const qs = new URLSearchParams({
                email: a.email,
                ...(sp.next ? { next: safeNextPath(sp.next) } : {}),
              });
              return (
                <li key={a.email}>
                  <a href={`/login?${qs.toString()}`} className="flex flex-wrap gap-x-2 py-1">
                    <span className="font-semibold">{a.email}</span>
                    <span className="text-mut">
                      {a.role} · {a.note}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

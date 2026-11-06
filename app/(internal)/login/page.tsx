import type { Metadata } from "next";
import { LoginForm } from "@/components/internal/admin/LoginForm";
import { PageHeader } from "@/components/internal/ui/PageHeader";
import { Window } from "@/components/internal/ui/Window";
import { TEST_ACCOUNTS, TEST_PASSWORD } from "@/lib/auth/test-accounts";
import { env } from "@/lib/env";
import { emailSchema, safeNextPath } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "PanitiaPintar · Masuk" };

type Props = { searchParams: Promise<{ next?: string; email?: string }> };

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
            Masuk dengan email dan kata sandi yang diberikan admin kepanitiaan.
          </p>
          <LoginForm
            key={initialEmail}
            next={safeNextPath(sp.next)}
            initialEmail={initialEmail}
            initialPassword={initialEmail ? TEST_PASSWORD : ""}
          />
        </div>
      </Window>
      {showTestAccounts ? (
        <section aria-labelledby="test-accounts" className="test-accounts flex flex-col gap-3 p-4">
          <h2 id="test-accounts" className="m-0 text-sm">
            Akun uji (hanya di lingkungan lokal)
          </h2>
          <p className="m-0 text-xs leading-relaxed">
            Semua akun memakai kata sandi <code>{TEST_PASSWORD}</code>. Klik salah satu akun untuk mengisi
            form, lalu klik <strong>Masuk</strong>.
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

import type { Metadata } from "next";
import { LoginForm } from "@/components/internal/admin/LoginForm";
import { PageHeader } from "@/components/internal/ui/PageHeader";
import { Window } from "@/components/internal/ui/Window";
import { safeNextPath } from "@/lib/validation/admin";

export const metadata: Metadata = { title: "PanitiaPintar · Masuk" };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
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
          <LoginForm next={safeNextPath(sp.next)} />
        </div>
      </Window>
    </main>
  );
}

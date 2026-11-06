import type { Metadata } from "next";
import { AdminShell } from "@/components/internal/admin/AdminShell";
import { ChangePasswordForm } from "@/components/internal/admin/ChangePasswordForm";
import { Window } from "@/components/internal/ui/Window";
import { pageUser } from "@/lib/auth/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Akun" };

export default async function AccountPage() {
  const access = await pageUser("/panitia/akun");
  if (!access.ok) return null;
  return (
    <AdminShell superAdmin={access.value.isSuperAdmin}>
      <Window title="Ganti kata sandi">
        <div className="flex max-w-[420px] flex-col gap-3">
          <p className="m-0 text-xs">
            Baru diundang admin? Ganti kata sandi sementaramu di sini. Minimal 8 karakter.
          </p>
          <ChangePasswordForm />
        </div>
      </Window>
    </AdminShell>
  );
}

import type { Metadata } from "next";
import { AccessDenied } from "@/components/internal/admin/AccessDenied";
import { AdminShell } from "@/components/internal/admin/AdminShell";
import { CommitteeForm } from "@/components/internal/admin/CommitteeForm";
import { Window } from "@/components/internal/ui/Window";
import { pageSuperAdmin } from "@/lib/auth/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PanitiaPintar · Kepanitiaan baru" };

export default async function NewCommitteePage() {
  const access = await pageSuperAdmin("/admin/new");
  return (
    <AdminShell superAdmin={access.ok}>
      {access.ok ? (
        <Window title="Kepanitiaan baru">
          <CommitteeForm />
        </Window>
      ) : (
        <AccessDenied requestId={access.requestId} />
      )}
    </AdminShell>
  );
}

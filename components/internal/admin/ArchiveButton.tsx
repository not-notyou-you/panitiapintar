"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { archiveCommitteeAction } from "@/app/(internal)/admin/actions";
import { Button } from "@/components/internal/ui/Button";

export function ArchiveButton({ committeeId, name }: { committeeId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Arsipkan "${name}"? Chat publik acara ini akan ditutup.`)) return;
        start(async () => {
          const r = await archiveCommitteeAction({ committeeId });
          if (!r.ok) window.alert(`${r.error.message} (kode ${r.error.requestId})`);
          router.refresh();
        });
      }}
    >
      Arsipkan
    </Button>
  );
}

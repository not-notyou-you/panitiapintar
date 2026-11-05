import Link from "next/link";
import { Window } from "@/components/ui/Window";

/** INTERFACE §6 "Akses ditolak". */
export function AccessDenied({ requestId }: { requestId?: string }) {
  return (
    <Window title="Akses ditolak">
      <div className="flex flex-col items-start gap-3">
        <p className="m-0">Kamu bukan anggota kepanitiaan ini.</p>
        {requestId ? (
          <p className="text-mut m-0 text-[11px]">
            Kode permintaan: <code className="select-all">{requestId}</code>
          </p>
        ) : null}
        <Link href="/panitia" className="btn btn-ghost no-underline">
          Kembali
        </Link>
      </div>
    </Window>
  );
}

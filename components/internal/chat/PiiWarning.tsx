import type { PiiCounts, PiiType } from "@/lib/privacy";

const NAMES: Record<PiiType, string> = {
  phone: "nomor HP",
  email: "alamat email",
  nik: "NIK",
  nim: "NIM",
  account: "nomor rekening",
  npwp: "NPWP",
};

export function describePii(found: PiiCounts): string {
  const names = (Object.keys(found) as PiiType[]).map((t) => NAMES[t]);
  if (names.length <= 1) return names[0] ?? "data pribadi";
  return `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`;
}

/** Names the kind of data found, never the value (INTERFACE §5 PiiWarning, §6). */
export function PiiWarning({
  found,
  onRemove,
  onSendAnyway,
}: {
  found: PiiCounts;
  onRemove: () => void;
  onSendAnyway: () => void;
}) {
  return (
    <div className="pii flex flex-col gap-2" role="alert" data-testid="pii-warning">
      <p className="m-0">Pesanmu sepertinya berisi {describePii(found)}. Hapus dulu?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-danger" onClick={onRemove}>
          Hapus
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSendAnyway}>
          Kirim tetap
        </button>
      </div>
    </div>
  );
}

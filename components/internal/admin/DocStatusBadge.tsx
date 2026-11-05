// INTERFACE §4.6. Text always present, never colour alone (§7).
const STATUS: Record<string, { label: string; cls: string }> = {
  uploaded: { label: "Diunggah", cls: "badge-outline" },
  refining: { label: "Sedang dirapikan", cls: "badge-outline" },
  refine_failed: { label: "Gagal", cls: "badge-failed" },
  needs_review: { label: "Perlu ditinjau", cls: "badge-review" },
  approved: { label: "Disetujui", cls: "" },
  rejected: { label: "Ditolak", cls: "badge-failed" },
  archived: { label: "Diarsipkan", cls: "badge-outline" },
};

export function DocStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "" };
  return (
    <span className={`badge ${s.cls}`}>
      {status === "refining" ? <span className="status-dot mr-1 align-middle" aria-hidden="true" /> : null}
      {s.label}
    </span>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  return visibility === "public" ? (
    <span className="badge badge-public">Publik</span>
  ) : (
    <span className="badge badge-internal">Internal</span>
  );
}

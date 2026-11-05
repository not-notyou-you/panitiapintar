import { ErrorWindow } from "@/components/internal/ui/ErrorWindow";
import { currentRequestId } from "@/lib/http/request-id.server";

// notFound() inside /panitia or /admin renders here, in the internal area's style.
export default async function InternalNotFound() {
  return (
    <ErrorWindow
      title="Tidak ditemukan"
      message="Halaman tidak ditemukan atau sudah tidak tersedia."
      requestId={await currentRequestId()}
    />
  );
}

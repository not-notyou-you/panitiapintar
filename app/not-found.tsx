import { ErrorWindow } from "@/components/ui/ErrorWindow";
import { currentRequestId } from "@/lib/http/request-id.server";

export default async function NotFound() {
  return (
    <ErrorWindow
      title="Tidak ditemukan"
      message="Halaman tidak ditemukan atau sudah tidak tersedia."
      requestId={await currentRequestId()}
    />
  );
}

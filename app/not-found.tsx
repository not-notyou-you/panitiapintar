import { ErrorWindow } from "@/components/public/ui/ErrorWindow";
import "./(public)/public.css";
import { currentRequestId } from "@/lib/http/request-id.server";

export default async function NotFound() {
  // Unmatched URLs render outside any route group, so this page opts into the public area itself.
  return (
    <div data-area="public">
      <ErrorWindow
        title="Tidak ditemukan"
        message="Halaman tidak ditemukan atau sudah tidak tersedia."
        requestId={await currentRequestId()}
      />
    </div>
  );
}

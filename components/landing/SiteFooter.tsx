import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-8 sm:grid-cols-3 sm:px-7">
        <div className="flex flex-col gap-2">
          <span className="font-pixel text-base uppercase">PanitiaPintar</span>
          <p className="text-mut m-0 text-xs leading-relaxed">
            Chatbot tanya jawab acara kampus yang menjawab dari dokumen resmi panitia.
          </p>
        </div>
        <nav aria-label="Tautan footer" className="flex flex-col gap-1 text-xs">
          <a href="#acara">Acara aktif</a>
          <a href="#cara-kerja">Cara kerja</a>
          <a href="#privasi">Privasi dan data</a>
          <Link href="/login">Masuk panitia</Link>
        </nav>
        <p className="text-mut m-0 text-xs leading-relaxed">
          Jawaban dibuat oleh AI dan bisa keliru. Untuk hal penting (pembayaran, sertifikat, perubahan
          jadwal), selalu konfirmasi ke narahubung resmi acara. Proyek mata kuliah AI706, Universitas
          Multimedia Nusantara.
        </p>
      </div>
    </footer>
  );
}

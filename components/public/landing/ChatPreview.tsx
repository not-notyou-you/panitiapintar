/** Static illustration of a conversation (not interactive, not real data). */
export function ChatPreview() {
  return (
    <figure className="win m-0" aria-label="Contoh percakapan dengan chatbot acara">
      <div className="win-title" aria-hidden="true">
        <span className="diamond" />
        <span className="truncate">Contoh percakapan</span>
        <span className="win-x">x</span>
      </div>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="msg msg-user">Jam berapa registrasi dibuka?</div>
        <div className="msg msg-bot">
          <p>Registrasi dibuka pukul 08.00 WIB di Lobi Gedung C, dekat Gerbang Utama.</p>
          <span className="src">
            <span className="src-label">SUMBER</span>Rundown Publik
          </span>
        </div>
        <div className="msg msg-user">Berapa anggaran panitia?</div>
        <div className="msg msg-bot">
          <p>Informasi ini belum tersedia di dokumen panitia. Hubungi narahubung resmi acara.</p>
        </div>
      </div>
      <figcaption className="text-mut mt-3 text-[11px]">
        Ilustrasi. Jawaban selalu dari dokumen publik acara, lengkap dengan sumbernya.
      </figcaption>
    </figure>
  );
}

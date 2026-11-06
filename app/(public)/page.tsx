import type { Metadata } from "next";
import Link from "next/link";
import { ChatPreview } from "@/components/public/landing/ChatPreview";
import { SiteFooter } from "@/components/public/landing/SiteFooter";
import { SiteHeader } from "@/components/public/landing/SiteHeader";
import { EmptyState } from "@/components/public/ui/EmptyState";
import { ErrorState } from "@/components/public/ui/ErrorState";
import { listActiveCommittees, type PublicCommitteeRow } from "@/lib/context/public";
import { formatDate } from "@/lib/format";
import { currentRequestId } from "@/lib/http/request-id.server";
import { logger } from "@/lib/log/logger";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "PanitiaPintar · Tanya acara kampus",
  description:
    "Tanya jadwal, lokasi, tiket, dan aturan acara kampus. Dijawab AI dari dokumen resmi panitia, tanpa login.",
};

/** Whole days from today (WIB) to a YYYY-MM-DD date; null when unknown. */
function daysUntil(date: string | null, now = Date.now()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function whenLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  if (days > 1) return `${days} hari lagi`;
  return null; // past events still answer questions, no countdown
}

const STEPS = [
  {
    title: "Buka halaman acara",
    body: "Pindai QR yang dipasang panitia di lokasi atau poster, atau pilih acaranya dari daftar di halaman ini.",
  },
  {
    title: "Ketik pertanyaanmu",
    body: "Tanyakan jadwal, lokasi, harga tiket, dress code, atau aturan lomba, dengan bahasa sehari-hari.",
  },
  {
    title: "Dapat jawaban + sumber",
    body: "Jawaban diambil dari dokumen resmi dan menyebut dokumen sumbernya. Kalau informasinya belum ada, kamu diarahkan ke narahubung.",
  },
];

const PRIVACY = [
  {
    title: "Hanya dokumen publik",
    body: "Chatbot hanya membaca dokumen yang ditandai Publik dan sudah disetujui admin. Dokumen internal panitia tidak pernah dimuat.",
  },
  {
    title: "Data pribadi disensor",
    body: "Nomor HP, email, NIK, NIM, dan nomor rekening disensor otomatis sebelum pertanyaan dikirim ke AI. Sebaiknya jangan diketik sama sekali.",
  },
  {
    title: "Tanpa akun",
    body: "Pengunjung tidak perlu login. Riwayat percakapan hanya ada di browsermu dan hilang saat halaman ditutup.",
  },
  {
    title: "Jujur soal AI",
    body: "Jawaban dibuat AI (Gemini) dan bisa keliru. Pertanyaan yang sudah disensor disimpan paling lama 30 hari setelah acara untuk memperbaiki dokumen.",
  },
];

const FOR_COMMITTEE = [
  "Unggah PDF, DOCX, TXT, atau MD; AI merapikannya, lalu admin meninjau sebelum dipakai.",
  "Atur tiap dokumen Publik atau Internal; perubahan tercatat di audit log.",
  "QR code per acara untuk dipasang di lokasi.",
  "Tanya dokumen internal, buat draf rundown dan checklist persiapan.",
];

const PREVIEW_COUNT = 6;

type Props = { searchParams: Promise<{ semua?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const showAll = (await searchParams).semua === "1";
  let committees: PublicCommitteeRow[] | null = null;
  try {
    committees = await listActiveCommittees();
  } catch (err) {
    logger.error(
      {
        event: "http.request.failed",
        route: "/",
        error: { code: err instanceof Error ? err.name : "unknown" },
      },
      "home load failed",
    );
  }
  const requestId = committees === null ? await currentRequestId() : null;

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1180px] items-center gap-10 px-4 pt-10 pb-14 sm:px-7 md:grid-cols-[minmax(0,1fr)_400px] md:pt-16">
          <div className="flex flex-col items-start gap-5">
            <span className="font-display text-acc text-xs uppercase">
              Tanpa login · gratis · langsung dari HP
            </span>
            <h1 className="font-display m-0 text-3xl leading-tight sm:text-4xl md:text-5xl">
              Tanya acara kampus, dijawab dari dokumen resmi panitia
            </h1>
            <p className="text-mut m-0 max-w-xl text-sm leading-relaxed sm:text-base">
              Jadwal, lokasi, tiket, dress code, aturan lomba: tanyakan langsung tanpa menunggu admin membalas
              DM. Chatbot hanya menjawab dari dokumen yang sudah disetujui panitia.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#acara" className="btn inline-flex items-center no-underline">
                Lihat acara aktif
              </a>
              <a href="#cara-kerja" className="btn btn-ghost inline-flex items-center no-underline">
                Cara kerjanya
              </a>
            </div>
            {committees && committees.length > 0 ? (
              <p className="text-mut m-0 flex items-center gap-2 text-xs">
                <span className="status-dot" aria-hidden="true" />
                {committees.length} acara bisa ditanyakan sekarang
              </p>
            ) : null}
          </div>
          <ChatPreview />
        </section>

        {/* Events */}
        <section id="acara" className="band scroll-mt-20">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-4 py-12 sm:px-7">
            <SectionTitle kicker="Pilih acara" title="Acara aktif" />
            {committees === null ? (
              <ErrorState message="Daftar acara tidak dapat dimuat. Coba lagi nanti." requestId={requestId} />
            ) : committees.length === 0 ? (
              <EmptyState title="Belum ada acara aktif">
                Acara yang sedang berjalan akan tampil di sini.
              </EmptyState>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {(showAll ? committees : committees.slice(0, PREVIEW_COUNT)).map((c) => {
                    const when = whenLabel(daysUntil(c.event_date));
                    return (
                      <li key={c.id} className="flex">
                        <Link href={`/e/${c.slug}`} className="event-card">
                          <span className="event-card-top">
                            <span className="diamond" aria-hidden="true" />
                            <span>{when ?? "Chat dibuka"}</span>
                          </span>
                          <span className="flex flex-1 flex-col gap-3 p-4">
                            <span className="font-display text-lg leading-snug">{c.name}</span>
                            <span className="text-mut flex flex-col gap-1 text-xs">
                              {c.event_date ? <span>Tanggal: {formatDate(c.event_date)}</span> : null}
                              {c.location ? <span>Lokasi: {c.location}</span> : null}
                            </span>
                            <span className="event-card-cta mt-auto">Tanya sekarang ▶</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {committees.length > PREVIEW_COUNT ? (
                  <a
                    href={showAll ? "/#acara" : "/?semua=1#acara"}
                    className="btn btn-ghost inline-flex items-center self-center no-underline"
                  >
                    {showAll ? "Tampilkan lebih sedikit" : `Lihat semua ${committees.length} acara`}
                  </a>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* How it works */}
        <section id="cara-kerja" className="scroll-mt-20">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-14 sm:px-7">
            <SectionTitle kicker="3 langkah" title="Cara kerja" />
            <ol className="m-0 grid list-none gap-8 p-0 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-3">
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="font-display m-0 text-base">{s.title}</h3>
                  <p className="text-mut m-0 text-sm leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-mut">Contoh pertanyaan:</span>
              {[
                "Di mana lokasinya?",
                "Berapa harga tiket mahasiswa?",
                "Boleh bawa makanan?",
                "Kapan batas kumpul karya?",
              ].map((q) => (
                <span key={q} className="example-q">
                  {q}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section id="privasi" className="band scroll-mt-20">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-14 sm:px-7">
            <SectionTitle kicker="Privasi dan data" title="Aman untuk ditanya" />
            <ul className="m-0 grid list-none gap-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
              {PRIVACY.map((p) => (
                <li key={p.title} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <span className="diamond text-acc" style={{ width: 12, height: 12 }} aria-hidden="true" />
                    <h3 className="font-display m-0 text-sm">{p.title}</h3>
                  </span>
                  <p className="text-mut m-0 text-sm leading-relaxed">{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* For committees */}
        <section id="panitia" className="scroll-mt-20">
          <div className="mx-auto grid max-w-[1180px] items-start gap-8 px-4 py-14 sm:px-7 md:grid-cols-2">
            <div className="flex flex-col items-start gap-4">
              <SectionTitle kicker="Untuk panitia" title="Satu tempat untuk dokumen acara" />
              <p className="text-mut m-0 text-sm leading-relaxed">
                Kurangi pertanyaan berulang di DM. Akun panitia dibuat lewat undangan admin kepanitiaan.
              </p>
              <Link href="/login" className="btn inline-flex items-center no-underline">
                Masuk panitia
              </Link>
            </div>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {FOR_COMMITTEE.map((f) => (
                <li key={f} className="flex gap-3 text-sm leading-relaxed">
                  <span className="flag-box mt-1 flex-none bg-[var(--acc)]" aria-hidden="true" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-display text-acc text-xs uppercase">{kicker}</span>
      <h2 className="font-display m-0 text-2xl sm:text-3xl">{title}</h2>
    </div>
  );
}

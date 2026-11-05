import Link from "next/link";

/** Public site navigation. Anchor links collapse on phones; "Masuk panitia" always stays visible. */
export function SiteHeader() {
  return (
    <header className="site-nav">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-7">
        <Link
          href="/"
          className="text-tx flex items-center gap-3 no-underline"
          aria-label="PanitiaPintar, beranda"
        >
          <span className="border-line bg-acc grid h-10 w-10 place-items-center border-4" aria-hidden="true">
            <span className="diamond" style={{ width: 12, height: 12 }} />
          </span>
          <span className="font-pixel text-lg tracking-wide uppercase">PanitiaPintar</span>
        </Link>
        <nav aria-label="Navigasi utama" className="flex items-center gap-1">
          <a href="#acara" className="nav-link hidden md:inline-flex">
            Acara
          </a>
          <a href="#cara-kerja" className="nav-link hidden md:inline-flex">
            Cara kerja
          </a>
          <a href="#privasi" className="nav-link hidden md:inline-flex">
            Privasi
          </a>
          <Link href="/login" className="btn btn-ghost ml-2 inline-flex items-center whitespace-nowrap no-underline">
            Masuk panitia
          </Link>
        </nav>
      </div>
    </header>
  );
}

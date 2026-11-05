import Link from "next/link";

export function PageHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex items-center gap-3">
      <Link href="/" className="text-tx flex items-center gap-3 no-underline" aria-label="PanitiaPintar, beranda">
        <span className="border-line bg-acc grid h-11 w-11 place-items-center border-4" aria-hidden="true">
          <span className="diamond text-on-acc" style={{ width: 14, height: 14 }} />
        </span>
        <span>
          <span className="font-pixel block text-xl tracking-wide uppercase">PanitiaPintar</span>
          {subtitle ? <span className="text-mut block text-xs">{subtitle}</span> : null}
        </span>
      </Link>
    </header>
  );
}

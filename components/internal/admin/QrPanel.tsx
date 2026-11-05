"use client";

import { useState } from "react";
import { Button } from "@/components/internal/ui/Button";

/** INTERFACE §4.8. The image comes from GET /api/qr/[slug] (admin-only), never from a third party. */
export function QrPanel({ slug, url }: { slug: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const base = `/api/qr/${encodeURIComponent(slug)}`;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- same-origin dynamic PNG, not an optimizable asset */}
      <img src={`${base}?format=png&size=512`} alt={`QR code menuju ${url}`} width={220} height={220} />
      <div className="flex flex-col gap-3">
        <code className="select-all break-all">{url}</code>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Tersalin" : "Salin link"}
          </Button>
          <a className="btn no-underline" href={`${base}?format=png&size=1024`} download>
            Unduh PNG 1024
          </a>
          <a className="btn no-underline" href={`${base}?format=svg`} download>
            Unduh SVG
          </a>
        </div>
        <p className="text-mut m-0 text-xs">Tempel di poster, standee, atau caption IG.</p>
      </div>
    </div>
  );
}

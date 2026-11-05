import type { Metadata } from "next";
import { IBM_Plex_Mono, Pixelify_Sans } from "next/font/google";
import { currentRequestId } from "@/lib/http/request-id.server";
import "./globals.css";

const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "PanitiaPintar",
  description: "Chatbot berbasis dokumen untuk kepanitiaan acara kampus",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Exposed so client error boundaries can show the same requestId the server logged (INTERFACE §4.10).
  const requestId = await currentRequestId();
  return (
    <html lang="id" className={`${pixelify.variable} ${plexMono.variable}`}>
      <head>{requestId ? <meta name="request-id" content={requestId} /> : null}</head>
      <body>{children}</body>
    </html>
  );
}

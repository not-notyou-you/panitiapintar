import type { Metadata } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { currentRequestId } from "@/lib/http/request-id.server";
import "./base.css";

// Readable sans for all UI text; mono only for codes such as requestId.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "PanitiaPintar",
  description: "Chatbot berbasis dokumen untuk kepanitiaan acara kampus",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Exposed so client error boundaries can show the same requestId the server logged (INTERFACE §4.10).
  const requestId = await currentRequestId();
  return (
    <html lang="id" className={`${jakarta.variable} ${plexMono.variable}`}>
      <head>{requestId ? <meta name="request-id" content={requestId} /> : null}</head>
      <body>{children}</body>
    </html>
  );
}

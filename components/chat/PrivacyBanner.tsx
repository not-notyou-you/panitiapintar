// Not dismissible in public mode (INTERFACE §4.1, §8).
export function PrivacyBanner() {
  return (
    <p className="notice m-0" role="note">
      Jangan ketik data pribadi. Dijawab oleh AI (Gemini) dari dokumen resmi panitia.
    </p>
  );
}

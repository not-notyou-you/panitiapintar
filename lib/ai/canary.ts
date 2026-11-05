// SEC-02: internal seed documents carry CANARY-INT-xxxx. Tolerates spacing/case tricks a model might use.
const CANARY = /CANARY[\s_-]*INT[\s_-]*([A-Z0-9]{4})/i;

export function findCanary(text: string): string | null {
  const m = text.match(CANARY);
  return m?.[1] ? `CANARY-INT-${m[1].toUpperCase()}` : null;
}

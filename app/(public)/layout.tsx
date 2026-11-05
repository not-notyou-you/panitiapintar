import type { ReactNode } from "react";
import "./public.css";

// Public area (/, /e/[slug]). Owned by the public-site team: styles live in ./public.css and
// components in components/public. data-area scopes every rule so the internal area is unaffected.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div data-area="public">{children}</div>;
}

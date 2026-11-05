import type { ReactNode } from "react";
import "./internal.css";

// Internal area (/login, /panitia, /admin). Owned by the internal-tools team: styles live in
// ./internal.css and components in components/internal. data-area scopes every rule.
export default function InternalLayout({ children }: { children: ReactNode }) {
  return <div data-area="internal">{children}</div>;
}

import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <span className="diamond text-acc" style={{ width: 16, height: 16 }} aria-hidden="true" />
      <p className="font-pixel m-0 text-base uppercase">{title}</p>
      {children ? <div className="text-mut text-xs">{children}</div> : null}
    </div>
  );
}

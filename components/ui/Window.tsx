import type { ReactNode } from "react";

interface WindowProps {
  title: string;
  children: ReactNode;
  className?: string;
  /** id for aria-labelledby; defaults to a slug of the title. */
  titleId?: string;
}

/** Retro window: navy title bar + decorative "x" (INTERFACE §2, §5 Window). */
export function Window({ title, children, className = "", titleId }: WindowProps) {
  const id = titleId ?? `win-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={`win ${className}`} aria-labelledby={id}>
      <div id={id} className="win-title">
        <span className="diamond" aria-hidden="true" />
        <span className="truncate">{title}</span>
        <span className="win-x" aria-hidden="true">
          x
        </span>
      </div>
      {children}
    </section>
  );
}

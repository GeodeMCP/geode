import type { ReactNode } from "react";

/** Decorative faint topographic contour SVG rendered behind each column header. */
function TopoLines() {
  return (
    <svg className="topo" viewBox="0 0 400 48" preserveAspectRatio="none" fill="none" stroke="rgba(155,188,176,.13)" strokeWidth={1} aria-hidden="true">
      <path d="M0 38 C70 26 130 44 200 32 S330 22 400 36" />
      <path d="M0 30 C70 18 130 36 200 24 S330 14 400 28" />
      <path d="M0 22 C70 10 130 28 200 16 S330 6 400 20" />
      <path d="M0 14 C70 2 130 20 200 8 S330 -2 400 12" />
      <path d="M0 46 C70 34 130 52 200 40 S330 30 400 44" />
    </svg>
  );
}

/** Uniform column header used by all three Vault-home columns. */
export function ColHead({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="colhead">
      <TopoLines />
      <span className="colhead-title">{title}</span>
      {note && <span className="colhead-note">{note}</span>}
      <span style={{ flex: 1 }} />
      {children && <span className="colhead-actions">{children}</span>}
    </div>
  );
}

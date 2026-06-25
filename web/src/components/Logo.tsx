// Canonical Geode gem mark — identical to the marketing site (GeodeMCP/site #gem symbol).
/** Renders the Geode gem-mark SVG logo at the given pixel size. */
export function GemMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 4 23 4 20.5 13 11.5 13Z" fill="#86ECCB" />
      <path d="M9 4 11.5 13 3 13Z" fill="#4DD7AC" />
      <path d="M23 4 29 13 20.5 13Z" fill="#3DCBA0" />
      <path d="M3 13 11.5 13 16 30Z" fill="#2FB89A" />
      <path d="M11.5 13 20.5 13 16 30Z" fill="#2C93B8" />
      <path d="M20.5 13 29 13 16 30Z" fill="#4C7DF4" />
      <path d="M9 4 16 4 13 7.2 10.4 7.2Z" fill="#ffffff" opacity=".22" />
    </svg>
  );
}

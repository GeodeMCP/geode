export function TopBar() {
  const items = ["Vault", "Capabilities", "Integrations", "Secrets", "Artifacts"];
  return (
    <div className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,9 12,22" fill="#3FCFA1"/><polygon points="12,2 2,9 12,22" fill="#86ECCB"/><polygon points="2,9 12,22 22,9" fill="#4C7DF4" opacity=".85"/></svg>
        <span className="name">Geode</span>
        <span className="ws">personal-vault</span>
      </div>
      <nav>{items.map((it, i) => <a key={it} className={i === 0 ? "active" : ""}>{it}</a>)}</nav>
      <div className="tb-right"><span className="chip live"><span className="pulse" />live</span><span className="avatar" /></div>
    </div>
  );
}

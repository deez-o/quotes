export default function Loading() {
  return (
    <div className="page" aria-busy="true">
      <div style={{ height: 36, width: 240, background: "var(--line)", borderRadius: 8 }} />
      <div style={{ height: 16, width: 420, maxWidth: "100%", background: "var(--line-soft)", borderRadius: 6 }} />
      <div className="card" style={{ height: 180 }} />
    </div>
  );
}

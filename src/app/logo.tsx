/** quoteout logo: the road "q" mark and the lowercase wordmark ("quote" + "out" in hi-vis orange). */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <defs><clipPath id="qo-c"><rect width="512" height="512" rx="112" /></clipPath></defs>
      <g clipPath="url(#qo-c)">
        <rect width="512" height="512" fill="#FF6A13" />
        <g transform="translate(30 10)">
          <circle cx="226" cy="222" r="104" fill="none" stroke="#16181B" strokeWidth="68" />
          <rect x="296" y="118" width="68" height="420" fill="#16181B" />
          <g fill="#F5F3EE"><rect x="325" y="352" width="10" height="34" rx="2" /><rect x="325" y="414" width="10" height="34" rx="2" /><rect x="325" y="476" width="10" height="34" rx="2" /></g>
        </g>
      </g>
    </svg>
  );
}

export function Logo({ size = 28, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.32 }} aria-label="quoteout">
      <Mark size={size} />
      <span aria-hidden="true" style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: size * 0.82, letterSpacing: "-0.02em", lineHeight: 1 }}>
        <span style={{ color: dark ? "#F5F3EE" : "var(--ink)" }}>quote</span><span style={{ color: "#FF6A13" }}>out</span>
      </span>
    </span>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/site", label: "Site quotes" },
  { href: "/new", label: "Send in an RFQ" },
  { href: "/queue", label: "RFQ queue" },
  { href: "/setup", label: "Setup" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname.startsWith(l.href) || (l.href === "/setup" && (pathname.startsWith("/teach") || pathname.startsWith("/costs"))) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}

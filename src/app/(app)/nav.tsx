"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/quotes", label: "Quotes" },
  { href: "/site/new", label: "New site quote" },
  { href: "/setup", label: "Setup" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/quotes" ? pathname.startsWith("/quotes") || pathname === "/new" || (pathname.startsWith("/site/") && !pathname.startsWith("/site/new")) : pathname.startsWith(l.href)) || (l.href === "/setup" && (pathname.startsWith("/teach") || pathname.startsWith("/costs"))) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}

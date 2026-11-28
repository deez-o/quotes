"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/start", label: "New Quote" },
  { href: "/quotes", label: "Quotes" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/setup", label: "Setup" },
  { href: "/help", label: "Help" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={(l.href === "/quotes" ? pathname.startsWith("/quotes") || (pathname.startsWith("/site/") && !pathname.startsWith("/site/new")) : l.href === "/start" ? pathname === "/start" || pathname === "/new" || pathname.startsWith("/site/new") : pathname.startsWith(l.href)) || (l.href === "/setup" && (pathname.startsWith("/teach") || pathname.startsWith("/costs"))) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}

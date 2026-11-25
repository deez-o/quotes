"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/queue", label: "RFQ queue" },
  { href: "/teach", label: "Teach QUOTES" },
  { href: "/settings", label: "Settings" },
  { href: "/setup", label: "Setup" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname.startsWith(l.href) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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

/** The menu: down the side on a computer; on a phone, a top bar with a Menu button that opens the full list. */
export function NavShell({ brand, children }: { brand: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(pathname);
  if (at !== pathname) { setAt(pathname); setOpen(false); } // close after moving to another page
  return (
    <nav className="nav" aria-label="Main" data-open={open ? "true" : undefined}>
      <div className="nav-top">
        <div className="brand">{brand}</div>
        <button type="button" className="nav-toggle" aria-expanded={open} aria-controls="nav-body" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <div className="nav-body" id="nav-body">{children}</div>
    </nav>
  );
}

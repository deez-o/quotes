import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findByToken } from "@/lib/quote/accept";
import { loadBrand } from "@/lib/sheet/store";

/** The company's logo for the top of the quote email, reached through the quote's accept link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const found = await findByToken(admin, token);
  if (!found) return new NextResponse(null, { status: 404 });
  const brand = await loadBrand(admin, found.tenantId);
  if (!brand.logo) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(brand.logo.bytes), {
    headers: { "Content-Type": brand.logo.ext === "png" ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex" },
  });
}

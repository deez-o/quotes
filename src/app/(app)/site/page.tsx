import { redirect } from "next/navigation";

/** All quotes now live on the Quotes page. */
export default function SiteQuotesPage() {
  redirect("/quotes?show=site");
}

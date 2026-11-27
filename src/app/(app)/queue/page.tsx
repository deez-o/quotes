import { redirect } from "next/navigation";

/** RFQs now live on the Quotes page with everything else. */
export default function QueuePage() {
  redirect("/quotes?show=rfq");
}

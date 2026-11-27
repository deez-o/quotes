import { redirect } from "next/navigation";

/** Settings now live on the Setup page. */
export default function SettingsPage() {
  redirect("/setup");
}

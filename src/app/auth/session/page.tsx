"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Where email sign-in links land. Supabase puts the session in the link itself
 * (after the #), so this works even when the link opens in a different browser
 * or device from the one where the email was requested.
 */
export default function SessionPage() {
  const [message, setMessage] = useState("Signing you in...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const errorText = params.get("error_description");

    // Remove tokens from the address bar straight away.
    window.history.replaceState(null, "", window.location.pathname);

    if (!accessToken || !refreshToken) {
      window.location.replace(
        `/login?error=${encodeURIComponent(errorText ?? "That sign-in link has expired or was already used. Please request a new one.")}`,
      );
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setMessage("Sign-in failed.");
          window.location.replace(`/login?error=${encodeURIComponent(error.message)}`);
        } else {
          window.location.replace("/queue");
        }
      });
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <p>{message}</p>
    </main>
  );
}

import { signOut } from "@/app/actions";

export default function NoAccessPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ fontSize: 24 }}>You&apos;re signed in, but not set up yet</h1>
        <p>Your account isn&apos;t linked to a company. Ask your Quotr admin to invite you.</p>
        <form action={signOut}>
          <button className="btn" type="submit">Sign out</button>
        </form>
      </div>
    </main>
  );
}

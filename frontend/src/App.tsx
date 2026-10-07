import { useEffect, useState } from "react";

type Health = { status: string; db: boolean; redis: boolean };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>SignBridge</h1>
      <h2>API health</h2>
      {error && <p>Error: {error}</p>}
      {!error && !health && <p>Loading…</p>}
      {health && (
        <ul>
          <li>status: {health.status}</li>
          <li>db: {String(health.db)}</li>
          <li>redis: {String(health.redis)}</li>
        </ul>
      )}
    </main>
  );
}

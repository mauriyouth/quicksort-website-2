import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
type Report = { total_micro: number; unattributed_micro: number; fetchedAt: string; rows: { value: string; name: string; calls: number; charged_micro: number }[] };
const usd = (micro: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 6 }).format(micro / 1_000_000);
export default function ResearchUsage() {
  const { session } = useSession();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError(""); setReport(null);
    void (async () => {
      try {
        const token = await session?.getToken();
        if (!token) throw new Error("Sign in to view research usage.");
        const response = await fetch("/api/research-usage", { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Research usage is unavailable.");
        if (!controller.signal.aborted) setReport(body);
      } catch (problem) {
        if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "Research usage is unavailable.");
      } finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [session, refresh]);
  return <section className="panel" style={{ padding: 24 }}>
    <h2>Research usage</h2>
    <p>QuickSort pays for research. Admins are not charged individually.</p>
    <p>Last 30 days · USD · Treg organization ledger. AI model costs are separate.</p>
    <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Loading…" : "Refresh usage"}</button>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <h3>Total research spend: {usd(report.total_micro)}</h3>
      {report.unattributed_micro > 0 && <p role="status">{usd(report.unattributed_micro)} has no admin attribution. This can include usage before tracking was enabled or calls from other products in this Treg organization.</p>}
      {report.rows.length ? <table style={{ width: "100%", textAlign: "left", marginTop: 16 }}><thead><tr><th>Admin</th><th>Calls</th><th>Research cost</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.value}><td>{row.name}</td><td>{row.calls}</td><td>{usd(row.charged_micro)}</td></tr>)}</tbody></table> : <p>No attributed usage in this period.</p>}
      <p>Updated {new Date(report.fetchedAt).toLocaleString()}</p>
    </>}
  </section>;
}

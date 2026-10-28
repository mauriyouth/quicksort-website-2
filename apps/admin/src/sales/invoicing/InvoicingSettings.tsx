import { useCallback, useEffect, useMemo, useState } from "react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import { storedPricingLines } from "../pricing-lines";
import { errorText, type InvoicingApi } from "./api";
import { previousMonth } from "./format";
import type { ClientLink, InvoicingSettings as Settings, PaymentAccount, ProductLink, ProviderClient, ProviderProduct } from "./types";

type RegieProject = { id: string; title: string; client_id: string; intermediary_client_id: string | null; status: string; lines: string[] };

// invoicing_product_links is not in the generated Database types yet; read it untyped.
const untyped = () => db() as unknown as { from: (t: string) => { select: (c: string) => PromiseLike<{ data: unknown; error: unknown }> } };

/**
 * Invoicing → Settings: the Qonto connection (secret and staging token are
 * write-only), then the two mapping tables drafts depend on — which Qonto
 * client each billed client is, and which Qonto service each régie pricing
 * line bills as.
 */
export function InvoicingSettings({ api, focus, onSaved }: { api: InvoicingApi; focus?: string | null; onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [stagingToken, setStagingToken] = useState("");
  const [staging, setStaging] = useState(false);
  const [iban, setIban] = useState("");
  const [dueDays, setDueDays] = useState("30");
  const [startMonth, setStartMonth] = useState(previousMonth());
  const [accounts, setAccounts] = useState<PaymentAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState("");

  const [qontoClients, setQontoClients] = useState<ProviderClient[] | null>(null);
  const [clientLinks, setClientLinks] = useState<ClientLink[]>([]);
  const [products, setProducts] = useState<ProviderProduct[] | null>(null);
  const [productLinks, setProductLinks] = useState<ProductLink[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<RegieProject[]>([]);
  const [linksError, setLinksError] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSettings = useCallback(async () => {
    const s = await api.get<Settings>({ resource: "settings" });
    setSettings(s);
    setLogin(s.login);
    setStaging(s.staging);
    setIban(s.iban);
    setDueDays(String(s.dueDays));
    setStartMonth(s.startMonth ?? previousMonth());
    return s;
  }, [api]);

  const loadRemote = useCallback(async (s: Settings) => {
    setAccountsError("");
    setLinksError("");
    if (!s.hasSecret) { setAccounts(null); setQontoClients(null); setProducts(null); return; }
    const [acc, cl, pr] = await Promise.allSettled([
      api.get<{ accounts: PaymentAccount[] }>({ resource: "payment-accounts" }),
      api.get<{ clients: ProviderClient[]; links: ClientLink[] }>({ resource: "provider-clients" }),
      api.get<{ products: ProviderProduct[] }>({ resource: "provider-products" }),
    ]);
    if (acc.status === "fulfilled") setAccounts(acc.value.accounts); else { setAccounts(null); setAccountsError(errorText(acc.reason)); }
    if (cl.status === "fulfilled") { setQontoClients(cl.value.clients); setClientLinks(cl.value.links); }
    else { setQontoClients(null); setLinksError(errorText(cl.reason)); }
    if (pr.status === "fulfilled") setProducts(pr.value.products);
    else { setProducts(null); setLinksError(errorText(pr.reason)); }
  }, [api]);

  const loadLocal = useCallback(async () => {
    const [cl, pj, ext, links] = await Promise.all([
      db().from("sales_clients").select("id,name").order("name"),
      db().from("sales_projects").select("id,title,client_id,intermediary_client_id,status,tjm_profiles").eq("pricing_model", "regie").order("title"),
      db().from("sales_project_extensions").select("project_id,tjm_profiles"),
      untyped().from("invoicing_product_links").select("*"),
    ]);
    const failed = [cl.error, pj.error, ext.error, links.error].find(Boolean);
    if (failed) throw new Error(errorMessage(failed));
    setClients(cl.data ?? []);
    setProductLinks((links.data as ProductLink[] | null) ?? []);
    setProjects((pj.data ?? []).map((p) => {
      const names = new Set(storedPricingLines(p.tjm_profiles).map((l) => l.name));
      for (const x of ext.data ?? []) if (x.project_id === p.id) for (const l of storedPricingLines(x.tjm_profiles)) names.add(l.name);
      return { id: p.id, title: p.title, client_id: p.client_id, intermediary_client_id: p.intermediary_client_id, status: p.status, lines: [...names] };
    }));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await loadSettings();
        await Promise.all([loadRemote(s), loadLocal()]);
      } catch (e) { setError(errorText(e, "Could not load invoicing settings.")); }
    })();
  }, [loadSettings, loadRemote, loadLocal]);

  useEffect(() => {
    if (!focus) return;
    const t = window.setTimeout(() => document.getElementById(focus)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(t);
  }, [focus, projects.length, clients.length]);

  const due = Number(dueDays);
  const formValid = Number.isInteger(due) && due >= 1 && due <= 120 && /^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) && login.trim().length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !formValid) return;
    setBusy("settings"); setError(""); setMessage("");
    try {
      await api.post("save_settings", {
        login: login.trim(), iban: iban.trim(), staging, dueDays: due, startMonth,
        ...(secret.trim() ? { secret: secret.trim() } : {}),
        ...(stagingToken.trim() ? { stagingToken: stagingToken.trim() } : {}),
      });
      setSecret(""); setStagingToken("");
      const s = await loadSettings();
      await loadRemote(s);
      setMessage(secret.trim() ? "Qonto connected and settings saved." : "Invoicing settings saved.");
      onSaved();
    } catch (err) { setError(errorText(err, "Could not save invoicing settings.")); }
    finally { setBusy(null); }
  }

  async function linkClient(clientId: string, providerClientId: string) {
    if (busy) return;
    setBusy(`client:${clientId}`); setError(""); setMessage("");
    try {
      const qc = qontoClients?.find((c) => c.id === providerClientId);
      await api.post("link_client", { clientId, providerClientId: providerClientId || null, providerClientName: qc?.name ?? "" });
      const r = await api.get<{ clients: ProviderClient[]; links: ClientLink[] }>({ resource: "provider-clients" });
      setQontoClients(r.clients); setClientLinks(r.links);
      setMessage(providerClientId ? "Client linked to Qonto." : "Client link removed.");
      onSaved();
    } catch (err) { setError(errorText(err, "Could not save the client link.")); }
    finally { setBusy(null); }
  }

  async function linkProduct(projectId: string, pricingLine: string, productId: string) {
    if (busy) return;
    setBusy(`product:${projectId}:${pricingLine}`); setError(""); setMessage("");
    try {
      const p = products?.find((x) => x.id === productId) ?? null;
      await api.post("link_product", { projectId, pricingLine, product: p });
      const links = await untyped().from("invoicing_product_links").select("*");
      if (links.error) throw new Error(errorMessage(links.error));
      setProductLinks((links.data as ProductLink[] | null) ?? []);
      setMessage(p ? "Pricing line linked to a Qonto service." : "Service link removed.");
      onSaved();
    } catch (err) { setError(errorText(err, "Could not save the service link.")); }
    finally { setBusy(null); }
  }

  // Clients billed on régie projects (directly or as the intermediary), plus any already linked.
  const billedClients = useMemo(() => {
    const ids = new Set<string>(clientLinks.map((l) => l.client_id));
    for (const p of projects) ids.add(p.intermediary_client_id ?? p.client_id);
    return clients.filter((c) => ids.has(c.id));
  }, [clients, projects, clientLinks]);
  const connected = !!settings?.hasSecret;
  const locked = busy !== null;

  return (
    <div className="inv-settings">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      <form className="pj-card" onSubmit={save} aria-label="Qonto connection">
        <div className="pj-card-head">
          <div>
            <h2 className="pj-card-title">Qonto connection</h2>
            <p className="pj-card-desc">API credentials from Qonto → Settings → Integrations. The secret key is stored encrypted and never shown again.</p>
          </div>
          <span className={`inv-status ${connected ? "inv-status--validated" : "inv-status--draft"}`}>{settings ? (connected ? "Connected" : "Not connected") : "Checking…"}</span>
        </div>
        <div className="pj-grid pj-grid-2">
          <label className="pj-field">
            <span className="pj-label">Login</span>
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" placeholder="organisation-slug-1234" disabled={locked} />
          </label>
          <label className="pj-field">
            <span className="pj-label">Secret key</span>
            <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
              placeholder={connected ? "Saved — type a new key to replace it" : "Paste the secret key"} disabled={locked} />
          </label>
          <label className="pj-field">
            <span className="pj-label">Main account (IBAN)</span>
            {accounts && accounts.length > 0 ? (
              <select value={iban} onChange={(e) => setIban(e.target.value)} disabled={locked}>
                <option value="">Choose an account</option>
                {!accounts.some((a) => a.iban === iban) && iban && <option value={iban}>{iban}</option>}
                {accounts.map((a) => <option key={a.iban} value={a.iban}>{a.name} · {a.iban}</option>)}
              </select>
            ) : (
              <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="FR76…" disabled={locked} />
            )}
            <span className="pj-field-help">{accountsError || (connected ? "Payments are expected on this account." : "Accounts are listed once Qonto is connected.")}</span>
          </label>
          <label className="pj-field">
            <span className="pj-label">Payment terms (days)</span>
            <input type="number" min={1} max={120} value={dueDays} onChange={(e) => setDueDays(e.target.value)} disabled={locked} />
          </label>
          <label className="pj-field">
            <span className="pj-label">Invoice CRA from</span>
            <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={locked} />
            <span className="pj-field-help">Months before this one never show up in To invoice.</span>
          </label>
          <div className="pj-field">
            <span className="pj-label">Environment</span>
            <label className="inv-check">
              <input type="checkbox" checked={staging} onChange={(e) => setStaging(e.target.checked)} disabled={locked} />
              Use the Qonto sandbox
            </label>
          </div>
          {staging && (
            <label className="pj-field">
              <span className="pj-label">Sandbox staging token</span>
              <input type="password" value={stagingToken} onChange={(e) => setStagingToken(e.target.value)} autoComplete="new-password"
                placeholder={connected ? "Saved — type a new token to replace it" : "Paste the staging token"} disabled={locked} />
            </label>
          )}
        </div>
        <div className="inv-form-foot">
          <button type="submit" className="pj-btn pj-btn-primary" disabled={locked || !formValid}>
            {busy === "settings" ? (secret.trim() ? "Checking with Qonto…" : "Saving…") : "Save settings"}
          </button>
        </div>
      </form>

      <section className="pj-card" id="inv-client-links" aria-label="Client links">
        <div className="pj-card-head">
          <div>
            <h2 className="pj-card-title">Clients</h2>
            <p className="pj-card-desc">Each billed client (or intermediary) must match a client in Qonto. Its invoice emails come from Qonto.</p>
          </div>
        </div>
        {!connected ? (
          <p className="inv-muted">Connect Qonto to link clients.</p>
        ) : !qontoClients ? (
          <p className="inv-muted">{linksError || "Loading Qonto clients…"}</p>
        ) : billedClients.length === 0 ? (
          <p className="inv-muted">No client is billed on a régie project yet.</p>
        ) : (
          <div className="inv-map">
            {billedClients.map((c) => {
              const link = clientLinks.find((l) => l.client_id === c.id);
              const missing = link && !qontoClients.some((q) => q.id === link.provider_client_id);
              return (
                <label className={`inv-map-row${focus === `client-${c.id}` ? " inv-focus" : ""}`} key={c.id} id={`client-${c.id}`}>
                  <span className="inv-map-name">{c.name}</span>
                  <select value={link?.provider_client_id ?? ""} disabled={locked} onChange={(e) => void linkClient(c.id, e.target.value)}>
                    <option value="">Not linked</option>
                    {missing && <option value={link.provider_client_id}>{link.provider_client_name || link.provider_client_id} (not found in Qonto)</option>}
                    {qontoClients.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}{q.emails.length ? ` · ${q.emails[0]}` : " · no invoice email"}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="pj-card" id="inv-product-links" aria-label="Service links">
        <div className="pj-card-head">
          <div>
            <h2 className="pj-card-title">Services</h2>
            <p className="pj-card-desc">Each pricing line of a régie project bills as a Qonto service (title, description and VAT come from it).</p>
          </div>
        </div>
        {!connected ? (
          <p className="inv-muted">Connect Qonto to link services.</p>
        ) : !products ? (
          <p className="inv-muted">{linksError || "Loading Qonto services…"}</p>
        ) : projects.length === 0 ? (
          <p className="inv-muted">No régie project yet.</p>
        ) : (
          <div className="inv-map">
            {projects.map((p) => (
              <div className={`inv-map-group${focus === `project-${p.id}` ? " inv-focus" : ""}`} key={p.id} id={`project-${p.id}`}>
                <span className="inv-map-group-title">{p.title}</span>
                {p.lines.length === 0 && <span className="inv-muted">No pricing line on this project.</span>}
                {p.lines.map((name) => {
                  const link = productLinks.find((l) => l.project_id === p.id && l.pricing_line === name);
                  const missing = link && !products.some((x) => x.id === link.provider_product_id);
                  return (
                    <label className="inv-map-row" key={name || "unnamed"}>
                      <span className="inv-map-name">{name || "Unnamed line"}</span>
                      {name ? (
                        <select value={link?.provider_product_id ?? ""} disabled={locked} onChange={(e) => void linkProduct(p.id, name, e.target.value)}>
                          <option value="">Not linked</option>
                          {missing && <option value={link.provider_product_id}>{link.title} (not found in Qonto)</option>}
                          {products.map((x) => (
                            <option key={x.id} value={x.id}>{x.title} · VAT {Math.round(Number(x.vatRate) * 1000) / 10} %</option>
                          ))}
                        </select>
                      ) : (
                        <span className="inv-muted">Name this pricing line on the project to link it.</span>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

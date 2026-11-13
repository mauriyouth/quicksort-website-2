import { useCallback, useEffect, useMemo, useState } from "react";
import { db, errorMessage } from "@quicksort/hr-db";
import { cn } from "cn";
import { Button, Field, FieldLabel, Input, NativeSelect, NativeSelectOption, Switch } from "@quicksort-sas/ui";
import { PageAlerts } from "../../ui";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "../../settings-ui";
import { storedPricingLines } from "../pricing-lines";
import { errorText, type InvoicingApi } from "./api";
import { previousMonth } from "./format";
import { ServicePicker } from "./ServicePicker";
import "../sales.css"; // ServicePicker (client-picker styles)
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

  const row = "grid scroll-mt-24 gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-center md:gap-8";
  const focused = "-mx-3 rounded-md bg-muted px-3 first:pt-3 last:pb-3";

  return (
    <div className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />

      <form onSubmit={save} aria-label="Qonto connection">
        <SettingsCard
          title="Qonto connection"
          description="API credentials from Qonto → Settings → Integrations. The secret key is stored encrypted and never shown again."
          action={<ConnectionBadge tone={connected ? "ok" : "neutral"}>{settings ? (connected ? "Connected" : "Not connected") : "Checking…"}</ConnectionBadge>}
          footer={
            <>
              <Hint>Saving with a new secret key checks it with Qonto first.</Hint>
              <Button type="submit" variant="pivot" disabled={locked || !formValid}>
                {busy === "settings" ? (secret.trim() ? "Checking with Qonto…" : "Saving…") : "Save settings"}
              </Button>
            </>
          }
        >
          <SettingsRow label="Login">
            <Input aria-label="Login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" placeholder="organisation-slug-1234" disabled={locked} />
          </SettingsRow>
          <SettingsRow label="Secret key">
            <Input aria-label="Secret key" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
              placeholder={connected ? "Saved. Type a new key to replace it" : "Paste the secret key"} disabled={locked} />
          </SettingsRow>
          <SettingsRow label="Main account (IBAN)" hint={<span className={accountsError ? "text-destructive" : undefined}>{accountsError || (connected ? "Payments are expected on this account." : "Accounts are listed once Qonto is connected.")}</span>}>
            {accounts && accounts.length > 0 ? (
              <NativeSelect aria-label="Main account (IBAN)" className="w-full" value={iban} onChange={(e) => setIban(e.target.value)} disabled={locked}>
                <NativeSelectOption value="">Choose an account</NativeSelectOption>
                {!accounts.some((a) => a.iban === iban) && iban && <NativeSelectOption value={iban}>{iban}</NativeSelectOption>}
                {accounts.map((a) => <NativeSelectOption key={a.iban} value={a.iban}>{a.name} · {a.iban}</NativeSelectOption>)}
              </NativeSelect>
            ) : (
              <Input aria-label="Main account (IBAN)" className="num" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="FR76…" disabled={locked} />
            )}
          </SettingsRow>
          <SettingsRow label="Payment terms (days)">
            <Input aria-label="Payment terms (days)" className="num w-28" type="number" min={1} max={120} value={dueDays} onChange={(e) => setDueDays(e.target.value)} disabled={locked} />
          </SettingsRow>
          <SettingsRow label="Invoice CRA from" hint="Months before this one never show up in To invoice.">
            <Input aria-label="Invoice CRA from" className="w-48" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={locked} />
          </SettingsRow>
          <SettingsRow label="Environment">
            <label className="flex w-fit items-center gap-2.5 text-sm">
              <Switch checked={staging} onCheckedChange={(v) => setStaging(v === true)} disabled={locked} />
              Use the Qonto sandbox
            </label>
            {staging && (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="inv-staging-token">Sandbox staging token</FieldLabel>
                <Input id="inv-staging-token" type="password" value={stagingToken} onChange={(e) => setStagingToken(e.target.value)} autoComplete="new-password"
                  placeholder={connected ? "Saved. Type a new token to replace it" : "Paste the staging token"} disabled={locked} />
              </Field>
            )}
          </SettingsRow>
        </SettingsCard>
      </form>

      <div id="inv-client-links">
        <SettingsCard title="Clients" description="Each billed client (or intermediary) must match a client in Qonto. Its invoice emails come from Qonto.">
          {!connected ? (
            <Hint>Connect Qonto to link clients.</Hint>
          ) : !qontoClients ? (
            <Hint>{linksError || "Loading Qonto clients…"}</Hint>
          ) : billedClients.length === 0 ? (
            <Hint>No client is billed on a régie project yet.</Hint>
          ) : (
            billedClients.map((c) => {
              const link = clientLinks.find((l) => l.client_id === c.id);
              const missing = link && !qontoClients.some((q) => q.id === link.provider_client_id);
              return (
                <div className={cn(row, focus === `client-${c.id}` && focused)} key={c.id} id={`client-${c.id}`}>
                  <label htmlFor={`inv-client-${c.id}`} className="text-sm font-medium">{c.name}</label>
                  <NativeSelect id={`inv-client-${c.id}`} className="w-full" value={link?.provider_client_id ?? ""} disabled={locked} onChange={(e) => void linkClient(c.id, e.target.value)}>
                    <NativeSelectOption value="">Not linked</NativeSelectOption>
                    {missing && <NativeSelectOption value={link.provider_client_id}>{link.provider_client_name || link.provider_client_id} (not found in Qonto)</NativeSelectOption>}
                    {qontoClients.map((q) => (
                      <NativeSelectOption key={q.id} value={q.id}>{q.name}{q.emails.length ? ` · ${q.emails[0]}` : " · no invoice email"}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              );
            })
          )}
        </SettingsCard>
      </div>

      <div id="inv-product-links">
        <SettingsCard title="Services" description="Each pricing line of a régie project bills as a Qonto service (title, description and VAT come from it).">
          {!connected ? (
            <Hint>Connect Qonto to link services.</Hint>
          ) : !products ? (
            <Hint>{linksError || "Loading Qonto services…"}</Hint>
          ) : projects.length === 0 ? (
            <Hint>No régie project yet.</Hint>
          ) : (
            projects.map((p) => (
              <div className={cn("flex scroll-mt-24 flex-col gap-2 py-4 first:pt-0 last:pb-0", focus === `project-${p.id}` && focused)} key={p.id} id={`project-${p.id}`}>
                <span className="text-sm font-medium">{p.title}</span>
                {p.lines.length === 0 && <Hint>No pricing line on this project.</Hint>}
                {p.lines.map((name) => {
                  const link = productLinks.find((l) => l.project_id === p.id && l.pricing_line === name);
                  return (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-center md:gap-8" key={name || "unnamed"}>
                      <span className="text-sm text-muted-foreground">{name || "Unnamed line"}</span>
                      {name ? (
                        <ServicePicker
                          products={products}
                          value={link?.provider_product_id ?? ""}
                          missingLabel={link?.title}
                          disabled={locked}
                          onChange={(id) => void linkProduct(p.id, name, id)}
                        />
                      ) : (
                        <Hint>Name this pricing line on the project to link it.</Hint>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

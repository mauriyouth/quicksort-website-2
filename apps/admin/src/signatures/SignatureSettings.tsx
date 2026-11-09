import { useEffect, useState, type FormEvent } from "react";
import type { DocumentTypeRecord } from "@quicksort/hr-db";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quicksort-sas/ui";
import { loadDocumentTypes } from "../documents/client";
import { ConnectionBadge, Hint, SettingsCard, SettingsRow } from "../settings-ui";
import { PageAlerts } from "../ui";
import { postSignatures, SIGNER_LABELS, type SignatureSettings as Settings, type SignatureTemplate, type SignerKind } from "./client";

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Settings → Signatures (admins): the Youtrust connection (environment,
 * write-only API key and webhook secret, Quicksort's signatory, the webhook
 * URL to paste into Youtrust) and the Google Doc templates that contracts are
 * filled from. Templates are read through the Google Drive service account,
 * so each Doc must be shared with it.
 */
export function SignatureSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<SignatureTemplate[]>([]);
  const [types, setTypes] = useState<DocumentTypeRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    postSignatures<Settings>({ action: "get-settings" }).then(setSettings, (e) => setError(errorText(e, "Could not load the signature settings.")));
    postSignatures<{ templates: SignatureTemplate[] }>({ action: "list-templates" }).then(
      (r) => setTemplates(r.templates),
      (e) => setError(errorText(e, "Could not load the templates.")),
    );
    loadDocumentTypes().then((all) => setTypes(all.filter((t) => t.owner_kinds.includes("person"))), () => setTypes([]));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageAlerts error={error} />
      <YoutrustCard settings={settings} onSaved={(next) => setSettings((current) => ({ ...current, ...next }))} />
      <TemplatesCard
        templates={templates}
        types={types}
        serviceAccountEmail={settings?.serviceAccountEmail || ""}
        onSaved={(saved) =>
          setTemplates((current) =>
            [...current.filter((t) => t.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
          )
        }
      />
    </div>
  );
}

function YoutrustCard({ settings, onSaved }: { settings: Settings | null; onSaved: (next: Settings) => void }) {
  const [staging, setStaging] = useState(true);
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryEmail, setSignatoryEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings) return;
    setStaging(settings.staging);
    setSignatoryName(settings.signatoryName);
    setSignatoryEmail(settings.signatoryEmail);
  }, [settings]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await postSignatures<Settings>({
        action: "save-settings",
        staging,
        signatoryName: signatoryName.trim(),
        signatoryEmail: signatoryEmail.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
      });
      setApiKey("");
      setWebhookSecret("");
      onSaved(next);
      setMessage("Youtrust settings saved.");
    } catch (e) {
      setError(errorText(e, "Could not save the Youtrust settings."));
    } finally {
      setBusy(false);
    }
  }

  const ready = !!settings?.hasApiKey && !!settings.hasWebhookSecret && !!settings.signatoryEmail;
  const savedHint = (saved: boolean | undefined) => (saved ? "Saved" : "Not set");
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <PageAlerts error={error} message={message} />
      <SettingsCard
        title="Youtrust"
        description="Contracts are sent for e-signature through Youtrust. The API key and webhook secret are stored encrypted and never shown again."
        action={
          <ConnectionBadge tone={!settings ? "neutral" : ready ? "ok" : "neutral"}>
            {!settings ? "Checking…" : ready ? "Configured" : "Not configured"}
          </ConnectionBadge>
        }
        footer={
          <>
            <Hint role="status">
              {settings ? (settings.staging ? "Requests go to the Youtrust sandbox." : "Requests go to Youtrust production.") : "Loading…"}
            </Hint>
            <Button type="submit" variant="pivot" disabled={busy || !settings}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <SettingsRow label="Environment" hint="Use the sandbox until the contracts are ready.">
          <NativeSelect aria-label="Environment" value={staging ? "sandbox" : "production"} onChange={(e) => setStaging(e.target.value === "sandbox")}>
            <NativeSelectOption value="sandbox">Sandbox</NativeSelectOption>
            <NativeSelectOption value="production">Production</NativeSelectOption>
          </NativeSelect>
        </SettingsRow>
        <SettingsRow label="API key" hint={savedHint(settings?.hasApiKey)}>
          <Input
            type="password"
            aria-label="API key"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasApiKey ? "Saved. Paste a new key to replace it" : "Paste the Youtrust API key"}
          />
        </SettingsRow>
        <SettingsRow label="Webhook secret" hint={savedHint(settings?.hasWebhookSecret)}>
          <Input
            type="password"
            aria-label="Webhook secret"
            autoComplete="off"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={settings?.hasWebhookSecret ? "Saved. Paste a new secret to replace it" : "Paste the webhook secret from Youtrust"}
          />
        </SettingsRow>
        <SettingsRow label="Quicksort signatory" hint="Signs after the person, on every template that needs Quicksort.">
          <Input aria-label="Signatory name" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="Full name" />
          <Input type="email" aria-label="Signatory email" value={signatoryEmail} onChange={(e) => setSignatoryEmail(e.target.value)} placeholder="name@quicksort.fr" />
        </SettingsRow>
        <SettingsRow label="Webhook URL" hint="Paste it in Youtrust, with the secret above.">
          <div className="flex gap-2">
            <Input aria-label="Webhook URL" readOnly className="font-mono text-xs md:text-xs" value={settings?.webhookUrl || ""} onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              disabled={!settings?.webhookUrl}
              onClick={() => void navigator.clipboard?.writeText(settings?.webhookUrl || "")}
            >
              Copy
            </Button>
          </div>
        </SettingsRow>
      </SettingsCard>
    </form>
  );
}

type Draft = { id?: string; name: string; googleDocUrl: string; signers: SignerKind; typeCode: string; active: boolean };
const blank: Draft = { name: "", googleDocUrl: "", signers: "person_and_quicksort", typeCode: "", active: true };

function TemplatesCard({
  templates,
  types,
  serviceAccountEmail,
  onSaved,
}: {
  templates: SignatureTemplate[];
  types: DocumentTypeRecord[];
  serviceAccountEmail: string;
  onSaved: (template: SignatureTemplate) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const typeLabel = (code: string) => types.find((t) => t.code === code)?.label || code;
  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setFields(null);
    try {
      const result = await postSignatures<{ template: SignatureTemplate; fields: string[] }>({
        action: "save-template",
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        googleDocUrl: draft.googleDocUrl.trim(),
        signers: draft.signers,
        typeCode: draft.typeCode,
        active: draft.active,
      });
      onSaved(result.template);
      setDraft({ ...draft, id: result.template.id });
      setFields(result.fields);
    } catch (e) {
      setError(errorText(e, "Could not save the template."));
    } finally {
      setBusy(false);
    }
  }

  function edit(next: Draft | null) {
    setDraft(next);
    setFields(null);
    setError("");
  }

  return (
    <SettingsCard
      title="Templates"
      description={
        <Hint className="text-sm">
          Google Docs with <strong>{"{{field}}"}</strong> placeholders. Values known from the person's record are filled in; the others are asked when sending.
        </Hint>
      }
      action={
        !draft && (
          <Button variant="outline" size="sm" onClick={() => edit(blank)}>
            Add template
          </Button>
        )
      }
    >
      <SettingsRow label="Service account" hint="Share each template Doc with this address">
        {serviceAccountEmail ? <span className="font-mono text-xs break-all">{serviceAccountEmail}</span> : <Hint>Connect Google Drive in Settings → Google Drive contracts first.</Hint>}
      </SettingsRow>
      <div className="py-5 first:pt-0 last:pb-0">
        {templates.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Signers</TableHead>
                <TableHead>Document type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{SIGNER_LABELS[t.signers]}</TableCell>
                  <TableCell>{typeLabel(t.type_code)}</TableCell>
                  <TableCell>
                    <Badge variant={t.active ? "success" : "secondary"}>{t.active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Edit ${t.name}`}
                      onClick={() =>
                        edit({
                          id: t.id,
                          name: t.name,
                          googleDocUrl: `https://docs.google.com/document/d/${t.google_doc_id}/edit`,
                          signers: t.signers,
                          typeCode: t.type_code,
                          active: t.active,
                        })
                      }
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Hint>No templates yet.</Hint>
        )}
      </div>
      {draft && (
        <form onSubmit={save} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0" aria-label={draft.id ? "Edit template" : "New template"}>
          <div className="text-sm font-medium">{draft.id ? `Edit ${draft.name || "template"}` : "New template"}</div>
          <PageAlerts error={error} />
          <div className="flex flex-col divide-y divide-border">
            <SettingsRow label="Name">
              <Input aria-label="Template name" required value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Contrat CDI" />
            </SettingsRow>
            <SettingsRow label="Google Doc link">
              <Input
                aria-label="Google Doc link"
                required
                value={draft.googleDocUrl}
                onChange={(e) => set({ googleDocUrl: e.target.value })}
                placeholder="https://docs.google.com/document/d/…"
              />
            </SettingsRow>
            <SettingsRow label="Signers">
              <NativeSelect aria-label="Signers" value={draft.signers} onChange={(e) => set({ signers: e.target.value as SignerKind })}>
                {(Object.keys(SIGNER_LABELS) as SignerKind[]).map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {SIGNER_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </SettingsRow>
            <SettingsRow label="Document type" hint="The signed copy is filed under this type.">
              <NativeSelect aria-label="Document type" required value={draft.typeCode} onChange={(e) => set({ typeCode: e.target.value })}>
                <NativeSelectOption value="">Choose a type</NativeSelectOption>
                {types.map((t) => (
                  <NativeSelectOption key={t.code} value={t.code}>
                    {t.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </SettingsRow>
            <SettingsRow label="Active" hint="Inactive templates can't be sent.">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={draft.active} onCheckedChange={(checked) => set({ active: checked === true })} aria-label="Active" />
                Offer this template when sending
              </label>
            </SettingsRow>
          </div>
          {fields && (
            <Hint role="status">
              {fields.length ? (
                <>
                  Saved. Fields found: <strong>{fields.join(", ")}</strong>
                </>
              ) : (
                "Saved. No {{field}} placeholders were found in this Doc."
              )}
            </Hint>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => edit(null)}>
              Close
            </Button>
            <Button type="submit" variant="pivot" disabled={busy || !draft.name.trim() || !draft.googleDocUrl.trim() || !draft.typeCode}>
              {busy ? "Saving…" : "Save template"}
            </Button>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}

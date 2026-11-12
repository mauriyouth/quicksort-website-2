import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { db, errorMessage, getSessionToken } from "@quicksort/hr-db";
import { formatDate } from "@quicksort/hr-ui";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quicksort-sas/ui";
import { z } from "zod";
import { EmptyState, PageAlerts, PageHeading } from "../ui";

/** Matches the API's cap (apps/admin/api/freelancer-invoices.ts). */
const MAX_BYTES = 3 * 1024 * 1024;

const invoiceSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  period_month: z.string().nullable(),
  amount_ttc_cents: z.number().nullable(),
  received_at: z.string(),
  portal_status: z.enum(["received", "to_pay", "paid", "not_accepted"]),
});
type MyInvoice = z.infer<typeof invoiceSchema>;

const STATUS: Record<MyInvoice["portal_status"], { label: string; variant: "secondary" | "warning" | "success" }> = {
  received: { label: "Received", variant: "secondary" },
  to_pay: { label: "To pay", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
  not_accepted: { label: "Not accepted", variant: "secondary" },
};

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** The file as base64, without the data-URL prefix. */
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

async function sendInvoice(file: File) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Only PDF invoices are accepted.");
  if (file.size > MAX_BYTES) throw new Error("The invoice is larger than 3 MB.");
  const token = await getSessionToken();
  if (!token) throw new Error("Sign in again to send an invoice.");
  const response = await fetch("/api/freelancer-invoices", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "portal_upload", fileName: file.name, mimeType: "application/pdf", data: await toBase64(file) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The invoice could not be sent. Try again.");
  }
}

/**
 * A freelancer's own invoices: what they sent (by portal or email) and where
 * each stands. Review notes and CRA mismatches stay on the admin side.
 */
export function MyInvoices({ busy, action }: {
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<MyInvoice[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await db().rpc("my_freelancer_invoices");
    if (result.error) throw result.error;
    setRows(invoiceSchema.array().parse(result.data ?? []));
  }, []);
  useEffect(() => {
    load().then(() => setLoadError(""), (e) => { setRows([]); setLoadError(errorMessage(e)); });
  }, [load]);

  return (
    <>
      <PageHeading
        title="My invoices"
        action={
          <>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void action(async () => { await sendInvoice(file); await load(); }, "Invoice sent. We'll check it against your CRA.");
              }}
            />
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <Upload data-icon="inline-start" aria-hidden="true" />
              Upload an invoice
            </Button>
          </>
        }
      >
        Send your monthly invoice as a PDF of 3 MB at most. Invoices you email us show up here too.
      </PageHeading>
      <PageAlerts error={loadError} />
      {rows === null && <p className="m-0 text-[13px] text-muted-foreground" role="status">Loading your invoices…</p>}
      {rows?.length === 0 && !loadError && (
        <EmptyState title="No invoices yet">Your invoices appear here once you send them.</EmptyState>
      )}
      {!!rows?.length && (
        <Card>
          <CardContent>
            <Table aria-label="My invoices">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead numeric>Amount incl. VAT</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.number || <span className="text-muted-foreground">Being read</span>}</TableCell>
                    <TableCell>{row.period_month ? monthName.format(new Date(`${row.period_month.slice(0, 10)}T00:00:00Z`)) : "—"}</TableCell>
                    <TableCell numeric>{row.amount_ttc_cents == null ? "—" : money.format(row.amount_ttc_cents / 100)}</TableCell>
                    <TableCell>{formatDate(row.received_at)}</TableCell>
                    <TableCell><Badge variant={STATUS[row.portal_status].variant}>{STATUS[row.portal_status].label}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

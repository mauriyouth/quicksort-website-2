import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Search, Upload, X } from "lucide-react";
import { cn } from "cn";
import {
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts, PageHeading, linkButton } from "../ui";
import { errorMessage } from "@quicksort/hr-db";
import { downloadDocument, fetchDocumentFile, previewDocument } from "../documents/client";
import { loadPayroll } from "./client";
import { latestPeriod, payrollMonth, shiftPeriod, type FiledPayslipDoc, type StaffEmployment } from "./month";

/**
 * HR → Payslips: one month of payroll. Everyone employed that month is listed,
 * filed or missing; clicking a payslip previews it alongside. Import lives on its own route.
 */
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function PayslipsMonth() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ staff: StaffEmployment[]; payslips: FiledPayslipDoc[] } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ doc: FiledPayslipDoc; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    loadPayroll().then((d) => live && setData(d), (e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, []);

  const asked = params.get("month") ?? "";
  const period = PERIOD.test(asked) ? asked : (data && latestPeriod(data.payslips)) || thisMonth();
  const setPeriod = (next: string) => { setSelected(null); setParams({ month: next }, { replace: true }); };

  const rows = useMemo(() => (data ? payrollMonth(period, data.staff, data.payslips) : []), [data, period]);
  const shown = rows.filter((r) => !filter.trim() || `${r.name} ${r.matricule}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const filed = rows.filter((r) => r.payslips.length > 0).length;
  const missing = rows.filter((r) => r.employed && r.payslips.length === 0).length;

  const years = useMemo(() => {
    const first = data?.payslips.reduce((min, p) => Math.min(min, Number(p.valid_from.slice(0, 4))), Number(period.slice(0, 4))) ?? Number(period.slice(0, 4));
    const last = Math.max(Number(thisMonth().slice(0, 4)), Number(period.slice(0, 4)));
    return Array.from({ length: last - first + 1 }, (_, i) => last - i);
  }, [data, period]);
  const [year, month] = period.split("-");

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeading
        title="Payslips"
        action={<Link to="/hr/payslips/import" className={linkButton({ variant: "outline" })}><Upload data-icon="inline-start" aria-hidden="true" /> Import</Link>}
      >
        Each month's payroll: who was paid, who is missing, and every payslip at a glance.
      </PageHeading>
      <PageAlerts error={error} />

      <div className="flex flex-wrap items-center gap-3">
        <ButtonGroup aria-label="Payroll month">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))}><ChevronLeft /></Button>
          <NativeSelect aria-label="Month" value={month} onChange={(e) => setPeriod(`${year}-${e.target.value}`)} className="w-36 rounded-none">
            {MONTHS.map((m, i) => <NativeSelectOption key={m} value={String(i + 1).padStart(2, "0")}>{m}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect aria-label="Year" value={year} onChange={(e) => setPeriod(`${e.target.value}-${month}`)} className="w-24 rounded-none">
            {years.map((y) => <NativeSelectOption key={y} value={y}>{y}</NativeSelectOption>)}
          </NativeSelect>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setPeriod(shiftPeriod(period, 1))}><ChevronRight /></Button>
        </ButtonGroup>
        <InputGroup className="w-full sm:ml-auto sm:w-72">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput type="search" placeholder="Filter by name or matricule" aria-label="Filter by name or matricule"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </InputGroup>
      </div>

      {/* Side by side once the page itself is ≥ 48rem wide (the sidebar eats viewport width). */}
      <div className={cn("grid items-start gap-4", selected && "@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")}>
        <Card>
          <CardHeader>
            <CardTitle>{MONTHS[Number(month) - 1]} {year}</CardTitle>
            {data && (
              <CardDescription role="status">
                {rows.filter((r) => r.employed).length} employed · <span className="text-foreground">{filed} filed</span>
                {missing > 0 && <> · <span className="text-destructive">{missing} missing</span></>}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading payslips…</p>}
            {data && shown.length === 0 && (
              <EmptyState title={rows.length ? "Nobody matches this filter" : "Nobody was employed this month"} />
            )}
            {shown.length > 0 && (
              <Table aria-label={`Payslips ${MONTHS[Number(month) - 1]} ${year}`}>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.personId} className={cn(r.payslips.length === 0 && r.employed && "bg-destructive/5")}>
                      <TableCell className="w-full whitespace-normal">
                        <Link to={`/hr/people/${r.personId}/employments`} className="underline-offset-4 hover:underline">{r.name}</Link>
                      </TableCell>
                      <TableCell className="num text-xs text-muted-foreground">{r.matricule && !r.matricule.startsWith("QS-") ? r.matricule : "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {r.payslips.length === 0
                            ? <Badge variant={r.employed ? "destructive" : "secondary"}>Missing</Badge>
                            : r.payslips.map((doc, i) => (
                              <Button key={doc.id} size="xs" variant={selected?.doc.id === doc.id ? "default" : "outline"}
                                aria-pressed={selected?.doc.id === doc.id}
                                onClick={() => setSelected({ doc, name: r.name })}>
                                {r.payslips.length > 1 ? `View (${i + 1})` : "View"}
                              </Button>
                            ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {selected && <PayslipPreview doc={selected.doc} name={selected.name} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function PayslipPreview({ doc, name, onClose }: { doc: FiledPayslipDoc; name: string; onClose: () => void }) {
  const [file, setFile] = useState<{ url: string } | { link: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  // On narrow screens the preview stacks under the list; bring it into view.
  useEffect(() => { panel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [doc.id]);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setLoading(true); setFile(null); setError("");
    fetchDocumentFile(doc)
      .then((result) => {
        if (!live) return;
        if (result instanceof Blob) { objectUrl = URL.createObjectURL(result); setFile({ url: objectUrl }); }
        else setFile({ link: result.link });
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card ref={panel} aria-label={`Preview of ${doc.title} for ${name}`} className="@3xl:sticky @3xl:top-20">
      <CardHeader>
        <CardTitle className="truncate">{name}</CardTitle>
        <CardDescription className="truncate">{doc.title}</CardDescription>
        <CardAction className="flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={() => void downloadDocument(doc).catch((e) => setError(errorMessage(e)))}><Download /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Open in a new tab" onClick={() => void previewDocument(doc).catch((e) => setError(errorMessage(e)))}><ExternalLink /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}><X /></Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading the payslip…</p>}
        <PageAlerts error={error} />
        {file && "url" in file && <iframe title={`${doc.title}, ${name}`} src={file.url} className="h-[75vh] w-full rounded-sm border border-border bg-white @3xl:h-[min(80vh,900px)]" />}
        {file && "link" in file && (
          <p className="text-sm text-muted-foreground">
            This file is too large to preview inline. <a className="underline" href={file.link} target="_blank" rel="noopener noreferrer">Open it</a>.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

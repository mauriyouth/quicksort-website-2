import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Flag,
  GripVertical,
  Plus,
  Sparkle,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  NativeSelect,
  NativeSelectOption,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@quicksort-sas/ui";
import { db, errorMessage } from "@quicksort/hr-db";
import {
  useAdminReferentials,
  sortStatuses,
  LOCKED_KINDS,
  type AdminStatus,
  type AdminType,
  type StatusKind,
} from "./referentials";
import { useLeaveRates, type LeaveKind } from "./cra/balances";
import { useEconomicsSettings } from "./hr/economics";
import { BankError, useBankApi, type BankStatus } from "./ops/business-plan/bank";
import { EmptyState, PageAlerts, PageHeading } from "./ui";

/**
 * Administration → Global settings (BoondManager "paramètres globaux").
 * Editable referentials for the whole interface, organized by domain:
 * Actions / statuses (project & opportunity pipeline states), Needs /
 * projects (deal/project types with their billing mode) and HR data
 * (resource lifecycle statuses). Edits save inline like Boond — every row
 * is a live record with a drag handle, color dot, default marker, label,
 * visibility toggle and delete. Cards are collapsible, show their record
 * count, and the whole configuration can be backed up to JSON. Built on
 * @quicksort-sas/ui; deletes confirm in an AlertDialog.
 */
const KIND_TITLES: Record<StatusKind, { title: string; hint: string }> = {
  project: {
    title: "Project statuses",
    hint: "Free-form — add, reorder, recolor and delete as delivery evolves.",
  },
  opportunity: {
    title: "Opportunity statuses",
    hint: "Pipeline stages — keys are enforced by the deal workflow; relabel, recolor and reorder freely.",
  },
  resource: {
    title: "Resource statuses",
    hint: "People lifecycle — keys are enforced by the HR pipeline; relabel, recolor and reorder freely.",
  },
};

const TYPE_MODES = [
  { key: "regie", label: "Régie" },
  { key: "forfait", label: "Forfait" },
  { key: "recrutement", label: "Recrutement" },
  { key: "produit", label: "Produit" },
];

const SECTIONS = [
  { id: "actions", label: "Actions / statuses" },
  { id: "needs", label: "Needs / projects" },
  { id: "hr", label: "HR data" },
  { id: "leave", label: "Leave accrual" },
  { id: "economics", label: "Unit economics" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const slug = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "status";

export function AdminSettings() {
  const ref = useAdminReferentials();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<SectionId>("actions");
  const [pendingDelete, setPendingDelete] = useState<{ title: string; run: () => void } | null>(null);

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      ref.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Boond-style safeguard: snapshot the whole configuration to JSON so a
   *  bad edit can be restored. */
  const exportBackup = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const payload = {
      tool: "quicksort-admin",
      exported_at: new Date().toISOString(),
      statuses: ref.statuses.length
        ? ref.statuses
        : "tables missing — nothing to back up yet",
      types: ref.types.length ? ref.types : "tables missing — nothing to back up yet",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `global-settings-backup-${stamp}.json`;
    a.click();
    // Revoking in the same tick can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setMessage("Backup downloaded — keep it somewhere safe.");
  };

  const saveStatus = (s: AdminStatus, patch: Partial<AdminStatus>) =>
    run(async () => {
      if (patch.is_default) {
        // The one-default-per-kind partial unique index requires unsetting
        // the previous default first.
        await db()
          .from("admin_statuses")
          .update({ is_default: false })
          .eq("kind", s.kind)
          .eq("is_default", true);
      }
      const r = await db()
        .from("admin_statuses")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("kind", s.kind)
        .eq("key", s.key)
        .select("kind")
        .single();
      if (r.error) throw r.error;
    }, "Status updated.");

  const addStatus = (kind: StatusKind) =>
    run(async () => {
      const taken = new Set(
        ref.statuses.filter((s) => s.kind === kind).map((s) => s.key),
      );
      let key = slug(`etat_${Date.now().toString(36)}`);
      while (taken.has(key)) key = `${key}_2`;
      const r = await db()
        .from("admin_statuses")
        .insert({ kind, key, label: "Nouvel état", position: taken.size })
        .select("kind")
        .single();
      if (r.error) throw r.error;
    }, "Status added — rename it below.");

  const removeStatus = (s: AdminStatus) =>
    run(async () => {
      const r = await db()
        .from("admin_statuses")
        .delete()
        .eq("kind", s.kind)
        .eq("key", s.key)
        .select("kind")
        .single();
      if (r.error) throw r.error;
    }, `“${s.label}” deleted.`);

  const reorderStatuses = (kind: StatusKind, ordered: AdminStatus[]) =>
    run(async () => {
      for (let i = 0; i < ordered.length; i++) {
        const r = await db()
          .from("admin_statuses")
          .update({ position: i })
          .eq("kind", kind)
          .eq("key", ordered[i].key);
        if (r.error) throw r.error;
      }
    }, "Order saved.");

  const moveStatus = (kind: StatusKind, index: number, dir: -1 | 1) => {
    const rows = sortStatuses(ref.statuses.filter((s) => s.kind === kind));
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    void reorderStatuses(kind, next);
  };

  const saveType = (t: AdminType, patch: Partial<AdminType>) =>
    run(async () => {
      const r = await db()
        .from("admin_types")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("key", t.key)
        .select("key")
        .single();
      if (r.error) throw r.error;
    }, "Type updated.");

  const addType = () =>
    run(async () => {
      const taken = new Set(ref.types.map((t) => t.key));
      let key = slug(`type_${Date.now().toString(36)}`);
      while (taken.has(key)) key = `${key}_2`;
      const r = await db()
        .from("admin_types")
        .insert({ key, label: "Nouveau type", mode: "regie", position: taken.size })
        .select("key")
        .single();
      if (r.error) throw r.error;
    }, "Type added — rename it below.");

  const removeType = (t: AdminType) =>
    run(async () => {
      const r = await db()
        .from("admin_types")
        .delete()
        .eq("key", t.key)
        .select("key")
        .single();
      if (r.error) throw r.error;
    }, `“${t.label}” deleted.`);

  const reorderTypes = (ordered: AdminType[]) =>
    run(async () => {
      for (let i = 0; i < ordered.length; i++) {
        const r = await db()
          .from("admin_types")
          .update({ position: i })
          .eq("key", ordered[i].key);
        if (r.error) throw r.error;
      }
    }, "Order saved.");

  const sortedTypes = [...ref.types].sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  );
  const moveType = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= sortedTypes.length) return;
    const next = [...sortedTypes];
    [next[i], next[target]] = [next[target], next[i]];
    void reorderTypes(next);
  };

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeading
        eyebrow="Administration"
        title="Global settings"
        action={
          <Button
            variant="outline"
            onClick={exportBackup}
            title="Back up the configuration to JSON"
            aria-label="Back up the configuration to JSON"
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            Back up
          </Button>
        }
      >
        Customize the referentials used across the interface.
      </PageHeading>

      <Alert variant="warning" role="note">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>
          Modifying global settings is a sensitive operation that affects the
          interface for all users.
        </AlertTitle>
        <AlertDescription>
          <ol className="m-0 list-decimal space-y-0.5 pl-4">
            <li>
              Download a backup of your configuration before any change —{" "}
              <button
                type="button"
                className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
                onClick={exportBackup}
              >
                click here
              </button>
              .
            </li>
            <li>Rename a status or type rather than deleting it while records still use it.</li>
            <li>Check your changes from a user account before rolling them out.</li>
            <li>Hidden statuses stay on existing records but disappear from pickers.</li>
            <li>Download a new backup once your changes are validated.</li>
          </ol>
        </AlertDescription>
      </Alert>

      <PageAlerts error={error} message={message} />
      {ref.missing && (
        <Alert variant="destructive">
          <AlertDescription>
            The settings tables are missing — apply
            supabase/migrations/20261007090000_sales_projects_admin_settings.sql.
            The editors below show built-in defaults until then.
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle>
            <AlertDialogDescription>Existing records keep the key.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                pendingDelete?.run();
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={section} onValueChange={(next) => setSection(next as SectionId)} className="gap-6">
        <TabsList
          variant="line"
          aria-label="Settings sections"
          className="h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border"
        >
          {SECTIONS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="flex-none group-data-horizontal/tabs:after:bottom-0">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="actions" className={COLUMNS}>
          {(["project", "opportunity"] as StatusKind[]).map((kind) => (
            <StatusCard
              key={kind}
              kind={kind}
              rows={sortStatuses(ref.statuses.filter((s) => s.kind === kind))}
              locked={LOCKED_KINDS[kind]}
              busy={busy}
              onSave={saveStatus}
              onAdd={() => void addStatus(kind)}
              onRemove={(s) => setPendingDelete({ title: `Delete status “${s.label}”?`, run: () => void removeStatus(s) })}
              onMove={(i, dir) => moveStatus(kind, i, dir)}
            />
          ))}
        </TabsContent>

        <TabsContent value="needs" className={COLUMNS}>
          <TypeCard
            rows={sortedTypes}
            busy={busy}
            onSave={(t, patch) => void saveType(t, patch)}
            onAdd={() => void addType()}
            onRemove={(t) => setPendingDelete({ title: `Delete type “${t.label}”?`, run: () => void removeType(t) })}
            onMove={moveType}
          />
        </TabsContent>

        <TabsContent value="hr" className={COLUMNS}>
          <StatusCard
            kind="resource"
            rows={sortStatuses(ref.statuses.filter((s) => s.kind === "resource"))}
            locked={LOCKED_KINDS.resource}
            busy={busy}
            onSave={saveStatus}
            onAdd={() => void addStatus("resource")}
            onRemove={(s) => setPendingDelete({ title: `Delete status “${s.label}”?`, run: () => void removeStatus(s) })}
            onMove={(i, dir) => moveStatus("resource", i, dir)}
          />
        </TabsContent>

        <TabsContent value="leave" className={COLUMNS}>
          <LeaveAccrualPanel />
        </TabsContent>

        <TabsContent value="economics" className={COLUMNS}>
          <EconomicsPanel />
          <ClassifierPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Referential cards sit side by side once the page is wide enough for two. */
const COLUMNS = "grid items-start gap-4 @5xl:grid-cols-2";

/** Collapsible referential card, Boond-style: title with the record count
 *  and a chevron; the whole header toggles it. */
function ReferentialCard({
  title,
  count,
  hint,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card size="sm" role="region" aria-label={title}>
      <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CollapsibleTrigger className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
            <CardTitle>
              {title} <span className="num text-sm font-normal text-muted-foreground">({count})</span>
            </CardTitle>
            <ChevronDown
              aria-hidden="true"
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")}
            />
          </CollapsibleTrigger>
          {open && hint && <CardDescription>{hint}</CardDescription>}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="@container flex flex-col gap-1">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/* Row grids. Wide (container ≥ 36rem): one line per record under a column
 * header. Narrow: label on the first line, the toggles and actions wrap onto
 * a second line (their wrapper turns into `display: contents` when wide). */
const STATUS_GRID =
  "grid grid-cols-[1rem_1.5rem_2rem_2rem_minmax(0,1fr)] @xl:grid-cols-[1rem_1.5rem_2.5rem_3rem_minmax(8rem,1fr)_3.5rem_3rem_auto]";
const TYPE_GRID =
  "grid grid-cols-[1rem_1.5rem_minmax(0,1fr)] @xl:grid-cols-[1rem_1.5rem_minmax(8rem,1fr)_9rem_3rem_auto]";
const ROW = "items-center gap-x-2 gap-y-1 rounded-md px-1 py-1 hover:bg-muted/50";
const HEADER = "hidden items-end gap-x-2 border-b border-border px-1 pb-2 text-xs text-muted-foreground @xl:grid";
const TRAILING = "col-span-full flex items-center justify-end gap-1 @xl:contents";

function IconToggle({
  on,
  label,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn("@xl:justify-self-center", on ? "text-foreground [&_svg]:fill-current" : "text-muted-foreground")}
    >
      {children}
    </Button>
  );
}

function RowActions({
  index,
  last,
  busy,
  onMove,
  remove,
}: {
  index: number;
  last: boolean;
  busy: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  remove?: { disabled: boolean; title: string; onClick: () => void };
}) {
  return (
    <span className="inline-flex justify-end gap-0.5">
      <Button variant="ghost" size="icon-sm" disabled={busy || index === 0} title="Move up" aria-label="Move up" onClick={() => onMove(index, -1)}>
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={busy || last} title="Move down" aria-label="Move down" onClick={() => onMove(index, 1)}>
        <ArrowDown />
      </Button>
      {remove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={busy || remove.disabled}
          title={remove.title}
          aria-label="Delete"
          onClick={remove.onClick}
        >
          <Trash2 />
        </Button>
      )}
    </span>
  );
}

function RowIndex({ index, title, suffix = "" }: { index: number; title?: string; suffix?: string }) {
  return (
    <span className="num text-right text-xs text-muted-foreground" title={title}>
      {index}
      {suffix}
    </span>
  );
}

function Grip() {
  return (
    <span className="inline-flex text-muted-foreground/70" title="Reorder with the arrows">
      <GripVertical className="size-4" aria-hidden="true" />
    </span>
  );
}

function StatusCard({
  kind,
  rows,
  locked,
  busy,
  onSave,
  onAdd,
  onRemove,
  onMove,
}: {
  kind: StatusKind;
  rows: AdminStatus[];
  locked: boolean;
  busy: boolean;
  onSave: (s: AdminStatus, patch: Partial<AdminStatus>) => void;
  onAdd: () => void;
  onRemove: (s: AdminStatus) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const meta = KIND_TITLES[kind];
  return (
    <ReferentialCard title={meta.title} count={rows.length} hint={meta.hint}>
      <div className={cn(STATUS_GRID, HEADER)} aria-hidden="true">
        <span />
        <span className="text-right">ID</span>
        <span className="text-center">Color</span>
        <span className="text-center">Default</span>
        <span>Label</span>
        <span className="text-center">Terminal</span>
        <span className="text-center">Visible</span>
        <span />
      </div>
      {!rows.length && <EmptyState title="No statuses yet">Add the first one below.</EmptyState>}
      {rows.map((s, i) => (
        <StatusRow
          key={`${s.kind}:${s.key}`}
          status={s}
          index={i}
          last={i === rows.length - 1}
          locked={locked}
          busy={busy}
          onSave={onSave}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
      {!locked && (
        <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={onAdd} disabled={busy}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add a status
        </Button>
      )}
    </ReferentialCard>
  );
}

function StatusRow({
  status: s,
  index,
  last,
  locked,
  busy,
  onSave,
  onRemove,
  onMove,
}: {
  status: AdminStatus;
  index: number;
  last: boolean;
  locked: boolean;
  busy: boolean;
  onSave: (s: AdminStatus, patch: Partial<AdminStatus>) => void;
  onRemove: (s: AdminStatus) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const [label, setLabel] = useState(s.label);
  const commitLabel = () => {
    if (label.trim() && label.trim() !== s.label)
      onSave(s, { label: label.trim() });
    else setLabel(s.label);
  };
  return (
    <div className={cn(STATUS_GRID, ROW)}>
      <Grip />
      <RowIndex index={index} title={s.key} suffix={locked ? "*" : ""} />
      <label
        className={cn(
          "relative inline-flex size-8 cursor-pointer justify-self-center items-center justify-center rounded-md hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
          busy && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          value={s.color}
          disabled={busy}
          onChange={(e) => onSave(s, { color: e.target.value })}
          aria-label={`Color for ${s.label}`}
        />
        <span
          className="pointer-events-none size-3 rounded-full ring-1 ring-border"
          style={{ background: s.color }}
          aria-hidden="true"
        />
      </label>
      <IconToggle
        on={s.is_default}
        label={s.is_default ? "Default status" : "Make default"}
        disabled={busy}
        onClick={() => !s.is_default && onSave(s, { is_default: true })}
      >
        <Sparkle />
      </IconToggle>
      <Input
        className={cn("h-8", !s.visible && "text-muted-foreground line-through")}
        value={label}
        disabled={busy}
        maxLength={200}
        aria-label="Status label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setLabel(s.label);
        }}
      />
      <div className={TRAILING}>
        <IconToggle
          on={s.is_terminal}
          label={s.is_terminal ? "Terminal status" : "Mark as terminal"}
          disabled={busy || locked}
          onClick={() => onSave(s, { is_terminal: !s.is_terminal })}
        >
          <Flag />
        </IconToggle>
        <IconToggle
          on={s.visible}
          label={s.visible ? "Hide from pickers" : "Show in pickers"}
          disabled={busy}
          onClick={() => onSave(s, { visible: !s.visible })}
        >
          {s.visible ? <Eye className="fill-none!" /> : <EyeOff />}
        </IconToggle>
        <RowActions
          index={index}
          last={last}
          busy={busy}
          onMove={onMove}
          remove={
            locked
              ? undefined
              : {
                  disabled: s.is_default,
                  title: s.is_default ? "The default status cannot be deleted" : "Delete",
                  onClick: () => onRemove(s),
                }
          }
        />
      </div>
    </div>
  );
}

function TypeCard({
  rows,
  busy,
  onSave,
  onAdd,
  onRemove,
  onMove,
}: {
  rows: AdminType[];
  busy: boolean;
  onSave: (t: AdminType, patch: Partial<AdminType>) => void;
  onAdd: () => void;
  onRemove: (t: AdminType) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  return (
    <ReferentialCard
      title="Project & need types"
      count={rows.length}
      hint="The mode drives billing (régie / forfait / recrutement / produit)."
    >
      <div className={cn(TYPE_GRID, HEADER)} aria-hidden="true">
        <span />
        <span className="text-right">ID</span>
        <span>Label</span>
        <span>Mode</span>
        <span className="text-center">Visible</span>
        <span />
      </div>
      {!rows.length && <EmptyState title="No types yet">Add the first one below.</EmptyState>}
      {rows.map((t, i) => (
        <TypeRow
          key={t.key}
          type={t}
          index={i}
          last={i === rows.length - 1}
          busy={busy}
          onSave={onSave}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
      <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={onAdd} disabled={busy}>
        <Plus data-icon="inline-start" aria-hidden="true" />
        Add a type
      </Button>
    </ReferentialCard>
  );
}

function TypeRow({
  type: t,
  index,
  last,
  busy,
  onSave,
  onRemove,
  onMove,
}: {
  type: AdminType;
  index: number;
  last: boolean;
  busy: boolean;
  onSave: (t: AdminType, patch: Partial<AdminType>) => void;
  onRemove: (t: AdminType) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const [label, setLabel] = useState(t.label);
  const commitLabel = () => {
    if (label.trim() && label.trim() !== t.label)
      onSave(t, { label: label.trim() });
    else setLabel(t.label);
  };
  return (
    <div className={cn(TYPE_GRID, ROW)}>
      <Grip />
      <RowIndex index={index} title={t.key} />
      <Input
        className={cn("h-8", !t.visible && "text-muted-foreground line-through")}
        value={label}
        disabled={busy}
        maxLength={200}
        aria-label="Type label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setLabel(t.label);
        }}
      />
      <div className={TRAILING}>
        <NativeSelect
          size="sm"
          className="mr-auto w-36 @xl:mr-0 @xl:w-full"
          value={t.mode}
          disabled={busy}
          aria-label="Mode"
          onChange={(e) => onSave(t, { mode: e.target.value })}
        >
          {TYPE_MODES.map((m) => (
            <NativeSelectOption key={m.key} value={m.key}>
              {m.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <IconToggle
          on={t.visible}
          label={t.visible ? "Hide from pickers" : "Show in pickers"}
          disabled={busy}
          onClick={() => onSave(t, { visible: !t.visible })}
        >
          {t.visible ? <Eye className="fill-none!" /> : <EyeOff />}
        </IconToggle>
        <RowActions
          index={index}
          last={last}
          busy={busy}
          onMove={onMove}
          remove={{ disabled: false, title: "Delete", onClick: () => onRemove(t) }}
        />
      </div>
    </div>
  );
}

/** Accrual rates for paid vacation (CP) and reduced working time (RTT).
 *  Employees accrue these days per calendar month from their start date; a
 *  rate edit reprices every past and future month, so the copy next to the
 *  inputs says exactly that. */
const LEAVE_KIND_LABELS: Record<LeaveKind, { label: string; sub: string }> = {
  cp: { label: "CP (paid vacation)", sub: "Congés payés" },
  rtt: { label: "RTT (reduced working time)", sub: "Jours de réduction du temps de travail" },
};

function LeaveAccrualPanel() {
  const { rates, missing, saving, save } = useLeaveRates();
  return (
    <ReferentialCard
      title="Leave accrual"
      count={rates.length}
      hint="Days accrued per calendar month from each employee's start date, net of the leave already consumed on their CRA. Editing a rate reprices all past and future months — every balance updates immediately."
    >
      {missing && (
        <Alert variant="destructive">
          <AlertDescription>
            The leave_accrual_settings table is missing — apply
            supabase/migrations/20261104090000_leave_accrual_balances.sql. The
            rates below show built-in defaults until then.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col divide-y divide-border">
        {rates.map((rate) => (
          <NumberSettingRow
            key={rate.kind}
            label={LEAVE_KIND_LABELS[rate.kind].label}
            sub={LEAVE_KIND_LABELS[rate.kind].sub}
            ariaLabel={`${LEAVE_KIND_LABELS[rate.kind].label} days per month`}
            unit="days / month"
            step="0.01"
            value={rate.rate}
            busy={saving}
            // Leave rates never accepted a decimal comma; the multipliers below do.
            parse={(value) => Number(value)}
            onSave={(next) => save(rate.kind, next)}
          />
        ))}
      </div>
    </ReferentialCard>
  );
}

/** Salary multipliers: the CJM one prices offers; the two business plan ones
 *  turn gross salaries into employer cost, one per scenario picked on the
 *  Business plan page. */
const ECONOMICS_ROWS = [
  { key: "cjm", label: "CJM multiplier", sub: "Offers: CJM = gross monthly salary × multiplier ÷ 21.7" },
  { key: "optimistic", label: "Business plan — optimistic", sub: "Employer cost = gross × multiplier (real payroll ≈ ×1.4)" },
  { key: "pessimistic", label: "Business plan — pessimistic", sub: "Employer cost = gross × multiplier (CJM-like, ×2)" },
] as const;

function EconomicsPanel() {
  const { values, missing, saving, error, save } = useEconomicsSettings();
  return (
    <ReferentialCard
      title="Unit economics"
      count={ECONOMICS_ROWS.length}
      hint="Multipliers applied to gross monthly salaries. The business plan scenarios are chosen from the dropdown on Operations → Business plan; interns stay at ×1.4 in both."
    >
      {missing && (
        <Alert variant="destructive">
          <AlertDescription>
            Some unit-economics settings are missing — apply
            supabase/migrations/20261206090000_business_plan_charge_multipliers.sql.
            The values below show built-in defaults until then.
          </AlertDescription>
        </Alert>
      )}
      <PageAlerts error={error ?? ""} />
      <div className="flex flex-col divide-y divide-border">
        {ECONOMICS_ROWS.map((row) => (
          <NumberSettingRow
            key={row.key}
            label={row.label}
            sub={row.sub}
            ariaLabel={row.label}
            unit="× gross"
            step="0.05"
            value={values[row.key]}
            busy={saving}
            parse={(value) => Number(value.replace(",", "."))}
            onSave={(next) => save(row.key, next)}
          />
        ))}
      </div>
    </ReferentialCard>
  );
}

function ClassifierPanel() {
  const bank = useBankApi();
  const [classifier, setClassifier] = useState<BankStatus["classifier"] | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = () =>
    bank
      .status()
      .then((status) => {
        setClassifier(status.classifier);
        setModel(status.classifier.model);
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bank]);
  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await bank.saveClassifier(model.trim(), apiKey.trim() || undefined);
      setApiKey("");
      setSaved(true);
      await load();
    } catch (e) {
      setError(
        e instanceof BankError
          ? e.status === 403 ? "Only portal owners can change this key." : e.message
          : errorMessage(e),
      );
    } finally {
      setSaving(false);
    }
  };
  const source = classifier?.source === "settings" ? "saved here" : classifier?.source === "environment" ? "server environment" : "none";
  return (
    <ReferentialCard
      title="Transaction classification (Kimi)"
      count={classifier?.configured ? 1 : 0}
      hint="Expense labels, counterparties and amounts are sent to Moonshot (Kimi) for classification."
    >
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {classifier
          ? classifier.configured
            ? `Configured — key source: ${source}, model: ${classifier.model}.`
            : classifier.source === "invalid"
              ? "Stored key unreadable — save it again."
              : "Not configured — no API key set."
          : "Loading…"}
      </p>
      <PageAlerts error={error ?? ""} message={saved ? "Saved." : ""} />
      <FieldGroup className="mt-2 gap-4">
        <Field>
          <FieldLabel htmlFor="kimi-api-key">API key</FieldLabel>
          <Input
            id="kimi-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={saving}
            aria-label="Moonshot API key"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <FieldDescription>Leave empty to keep the current key.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="kimi-model">Model</FieldLabel>
          <Input
            id="kimi-model"
            className="font-mono"
            value={model}
            disabled={saving}
            aria-label="Kimi model"
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <div>
          <Button onClick={() => void save()} disabled={saving || !model.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </FieldGroup>
    </ReferentialCard>
  );
}

/** One numeric setting: label and explanation on the left, the value with
 *  its unit on the right. Saves on blur or Enter; Escape or an invalid value
 *  restores the stored number. */
function NumberSettingRow({
  label,
  sub,
  ariaLabel,
  unit,
  step,
  value: stored,
  busy,
  parse,
  onSave,
}: {
  label: string;
  sub: string;
  ariaLabel: string;
  unit: string;
  step: string;
  value: number;
  busy: boolean;
  parse: (value: string) => number;
  onSave: (value: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(stored));
  useEffect(() => {
    setValue(String(stored));
  }, [stored]);
  const commit = () => {
    const next = parse(value);
    if (!value.trim() || !Number.isFinite(next) || next <= 0) {
      setValue(String(stored));
      return;
    }
    if (next !== stored) void onSave(next);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
      <InputGroup className="w-44 shrink-0">
        <InputGroupInput
          type="number"
          className="num"
          min={0}
          step={step}
          value={value}
          disabled={busy}
          aria-label={ariaLabel}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setValue(String(stored));
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

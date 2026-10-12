import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Cog,
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
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice, Empty } from "@quicksort/hr-ui";
import {
  useAdminReferentials,
  sortStatuses,
  LOCKED_KINDS,
  type AdminStatus,
  type AdminType,
  type StatusKind,
} from "./referentials";
import "./admin-settings.css";

/**
 * Administration → Global settings (BoondManager "paramètres globaux").
 * Editable referentials for the whole interface, organized by domain:
 * Actions / statuses (project & opportunity pipeline states), Needs /
 * projects (deal/project types with their billing mode) and HR data
 * (resource lifecycle statuses). Edits save inline like Boond — every row
 * is a live record with a drag handle, color dot, default marker, label,
 * visibility toggle and delete. Cards are collapsible, show their record
 * count, and the whole configuration can be backed up to JSON.
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
    URL.revokeObjectURL(url);
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
    <div className="admin-settings">
      <nav className="settings-breadcrumb" aria-label="Breadcrumb">
        Administration <span aria-hidden="true">›</span> <strong>Global settings</strong>
      </nav>

      <header className="admin-settings-head">
        <span className="settings-head-icon" aria-hidden="true">
          <Cog size={22} />
        </span>
        <div className="settings-head-copy">
          <h1>Global settings</h1>
          <p className="muted">Customize the referentials used across the interface.</p>
        </div>
        <button
          className="settings-backup"
          onClick={exportBackup}
          title="Back up the configuration to JSON"
          aria-label="Back up the configuration to JSON"
        >
          <Download size={18} />
        </button>
      </header>

      <div className="admin-warning" role="note">
        <TriangleAlert size={20} aria-hidden="true" />
        <div>
          <strong>
            Modifying global settings is a sensitive operation that affects the
            interface for all users.
          </strong>
          <ol>
            <li>
              Download a backup of your configuration before any change —{" "}
              <button className="settings-warning-link" onClick={exportBackup}>
                click here
              </button>
              .
            </li>
            <li>Rename a status or type rather than deleting it while records still use it.</li>
            <li>Check your changes from a user account before rolling them out.</li>
            <li>Hidden statuses stay on existing records but disappear from pickers.</li>
            <li>Download a new backup once your changes are validated.</li>
          </ol>
        </div>
      </div>

      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {ref.missing && (
        <Notice error>
          The settings tables are missing — apply
          supabase/migrations/20261007090000_sales_projects_admin_settings.sql.
          The editors below show built-in defaults until then.
        </Notice>
      )}

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={section === t.id}
            className={section === t.id ? "active" : ""}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "actions" && (
        <div className="settings-columns">
          {(["project", "opportunity"] as StatusKind[]).map((kind) => (
            <StatusCard
              key={kind}
              kind={kind}
              rows={sortStatuses(ref.statuses.filter((s) => s.kind === kind))}
              locked={LOCKED_KINDS[kind]}
              busy={busy}
              onSave={saveStatus}
              onAdd={() => void addStatus(kind)}
              onRemove={(s) => void removeStatus(s)}
              onMove={(i, dir) => moveStatus(kind, i, dir)}
            />
          ))}
        </div>
      )}

      {section === "needs" && (
        <div className="settings-columns">
          <TypeCard
            rows={sortedTypes}
            busy={busy}
            onSave={(t, patch) => void saveType(t, patch)}
            onAdd={() => void addType()}
            onRemove={(t) => void removeType(t)}
            onMove={moveType}
          />
        </div>
      )}

      {section === "hr" && (
        <div className="settings-columns">
          <StatusCard
            kind="resource"
            rows={sortStatuses(ref.statuses.filter((s) => s.kind === "resource"))}
            locked={LOCKED_KINDS.resource}
            busy={busy}
            onSave={saveStatus}
            onAdd={() => void addStatus("resource")}
            onRemove={(s) => void removeStatus(s)}
            onMove={(i, dir) => moveStatus("resource", i, dir)}
          />
        </div>
      )}
    </div>
  );
}

/** Collapsible referential card, Boond-style: title with the record count
 *  and a chevron; the whole header toggles it. */
function ReferentialCard({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`settings-card ${open ? "" : "is-collapsed"}`}>
      <button
        className="settings-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <h2>
          {title} <span className="settings-count">({count})</span>
        </h2>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && children}
    </section>
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
    <ReferentialCard title={meta.title} count={rows.length}>
      <p className="muted small-text settings-card-hint">{meta.hint}</p>
      <div className="settings-grid settings-grid-status" aria-hidden="true">
        <span />
        <span>ID</span>
        <span>Color</span>
        <span>Default</span>
        <span className="settings-label-col">Label</span>
        <span>Terminal</span>
        <span>Visible</span>
        <span />
      </div>
      {!rows.length && (
        <Empty title="No statuses yet">Add the first one below.</Empty>
      )}
      {rows.map((s, i) => (
        <StatusRow
          key={`${s.kind}:${s.key}`}
          status={s}
          index={i}
          locked={locked}
          busy={busy}
          onSave={onSave}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
      {!locked && (
        <button className="settings-add" onClick={onAdd} disabled={busy}>
          <Plus size={15} />
          Add a status
        </button>
      )}
    </ReferentialCard>
  );
}

function StatusRow({
  status: s,
  index,
  locked,
  busy,
  onSave,
  onRemove,
  onMove,
}: {
  status: AdminStatus;
  index: number;
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
    <div
      className={`settings-grid settings-grid-status settings-row ${s.visible ? "" : "settings-row-hidden"}`}
    >
      <span className="settings-grip" title="Reorder with the arrows">
        <GripVertical size={15} />
      </span>
      <span className="settings-id" title={s.key}>
        {index}
        {locked ? "*" : ""}
      </span>
      <label className="settings-color">
        <input
          type="color"
          value={s.color}
          disabled={busy}
          onChange={(e) => onSave(s, { color: e.target.value })}
          aria-label={`Color for ${s.label}`}
        />
        <span className="status-dot" style={{ background: s.color }} aria-hidden="true" />
      </label>
      <button
        className={`settings-icon ${s.is_default ? "is-on" : ""}`}
        disabled={busy}
        title={s.is_default ? "Default status" : "Make default"}
        aria-pressed={s.is_default}
        onClick={() => !s.is_default && onSave(s, { is_default: true })}
      >
        <Sparkle size={15} />
      </button>
      <input
        className="settings-label"
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
      <button
        className={`settings-icon ${s.is_terminal ? "is-on" : ""}`}
        disabled={busy || locked}
        title={s.is_terminal ? "Terminal status" : "Mark as terminal"}
        aria-pressed={s.is_terminal}
        onClick={() => onSave(s, { is_terminal: !s.is_terminal })}
      >
        <Flag size={15} />
      </button>
      <button
        className={`settings-icon ${s.visible ? "is-on" : ""}`}
        disabled={busy}
        title={s.visible ? "Hide from pickers" : "Show in pickers"}
        aria-pressed={s.visible}
        onClick={() => onSave(s, { visible: !s.visible })}
      >
        {s.visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <span className="settings-row-actions">
        <button
          className="settings-icon"
          disabled={busy || index === 0}
          title="Move up"
          onClick={() => onMove(index, -1)}
        >
          ↑
        </button>
        <button
          className="settings-icon"
          disabled={busy}
          title="Move down"
          onClick={() => onMove(index, 1)}
        >
          ↓
        </button>
        {!locked && (
          <button
            className="settings-icon danger"
            disabled={busy || s.is_default}
            title={s.is_default ? "The default status cannot be deleted" : "Delete"}
            onClick={() => {
              if (confirm(`Delete status “${s.label}”? Existing records keep the key.`))
                onRemove(s);
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </span>
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
    <ReferentialCard title="Project & need types" count={rows.length}>
      <p className="muted small-text settings-card-hint">
        The mode drives billing (régie / forfait / recrutement / produit).
      </p>
      <div className="settings-grid settings-grid-type" aria-hidden="true">
        <span />
        <span>ID</span>
        <span className="settings-label-col">Label</span>
        <span>Mode</span>
        <span>Visible</span>
        <span />
      </div>
      {!rows.length && <Empty title="No types yet">Add the first one below.</Empty>}
      {rows.map((t, i) => (
        <TypeRow
          key={t.key}
          type={t}
          index={i}
          busy={busy}
          onSave={onSave}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
      <button className="settings-add" onClick={onAdd} disabled={busy}>
        <Plus size={15} />
        Add a type
      </button>
    </ReferentialCard>
  );
}

function TypeRow({
  type: t,
  index,
  busy,
  onSave,
  onRemove,
  onMove,
}: {
  type: AdminType;
  index: number;
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
    <div
      className={`settings-grid settings-grid-type settings-row ${t.visible ? "" : "settings-row-hidden"}`}
    >
      <span className="settings-grip" title="Reorder with the arrows">
        <GripVertical size={15} />
      </span>
      <span className="settings-id" title={t.key}>
        {index}
      </span>
      <input
        className="settings-label"
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
      <select
        value={t.mode}
        disabled={busy}
        aria-label="Mode"
        onChange={(e) => onSave(t, { mode: e.target.value })}
      >
        {TYPE_MODES.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        className={`settings-icon ${t.visible ? "is-on" : ""}`}
        disabled={busy}
        title={t.visible ? "Hide from pickers" : "Show in pickers"}
        aria-pressed={t.visible}
        onClick={() => onSave(t, { visible: !t.visible })}
      >
        {t.visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <span className="settings-row-actions">
        <button
          className="settings-icon"
          disabled={busy || index === 0}
          title="Move up"
          onClick={() => onMove(index, -1)}
        >
          ↑
        </button>
        <button
          className="settings-icon"
          disabled={busy}
          title="Move down"
          onClick={() => onMove(index, 1)}
        >
          ↓
        </button>
        <button
          className="settings-icon danger"
          disabled={busy}
          title="Delete"
          onClick={() => {
            if (confirm(`Delete type “${t.label}”? Existing records keep the key.`))
              onRemove(t);
          }}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

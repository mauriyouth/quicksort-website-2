import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { useSession } from "@clerk/react";
import { Loader2, Upload, X } from "lucide-react";
import { db } from "@quicksort/hr-db";
import { MAX_INTAKE_PDF_BYTES, type ParsedProfile } from "../candidate-intake";
import { SOURCES } from "./stages";
import type { Opportunity } from "./data";
import "./intake.css";

/**
 * Intake sheet — one entry point for adding a person to the talent pool,
 * reachable from any pipeline view (the toolbar button or a board column).
 * Drop a resume PDF to have the configured AI model extract the profile, or
 * fill the manual form for every other intake channel. Either way the new
 * record opens straight away so the parsed details can be reviewed.
 */
export function IntakeSheet({
  actorEmail,
  opportunities,
  onRun,
  onError,
  onAdded,
  onClose,
}: {
  actorEmail: string;
  opportunities: Opportunity[];
  onRun: (work: () => Promise<string>, fallback: string) => Promise<void>;
  onError: (message: string) => void;
  onAdded: (candidateId: string) => void;
  onClose: () => void;
}) {
  const { session } = useSession();
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Neutral profile sketch + provenance for the candidate's notes field. */
  function profileNotes(profile: ParsedProfile, provenance: string) {
    const meta = [
      profile.headline ? `Headline: ${profile.headline}` : "",
      profile.currentRole
        ? `Current role: ${profile.currentRole}${profile.company ? ` @ ${profile.company}` : ""}`
        : "",
      profile.location ? `Location: ${profile.location}` : "",
      profile.yearsExperience !== null ? `Experience: ~${profile.yearsExperience} yrs` : "",
      profile.linkedinUrl ? `LinkedIn: ${profile.linkedinUrl}` : "",
    ].filter(Boolean);
    return [
      profile.summary,
      ...meta,
      `AI-parsed from ${provenance} on ${new Date().toLocaleDateString()} — verify the details.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Drop a resume PDF → parse with the configured AI model → create the candidate. */
  async function addFromResume(incoming: File | null | undefined) {
    if (!incoming || intakeBusy) return;
    if (
      !incoming.name.toLowerCase().endsWith(".pdf") ||
      !incoming.size ||
      incoming.size > MAX_INTAKE_PDF_BYTES
    ) {
      onError(`${incoming.name}: choose a non-empty PDF up to 3 MB.`);
      return;
    }
    setIntakeBusy(true);
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Your session expired. Sign in again.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("This PDF could not be read."));
        reader.readAsDataURL(incoming);
      });
      const response = await fetch("/api/parse-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile: { kind: "pdf", data, name: incoming.name } }),
        signal: AbortSignal.timeout(115000),
      });
      const text = await response.text();
      let body: { error?: string; profile?: ParsedProfile } = {};
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(
          response.ok
            ? "The parsing service returned an unexpected response. Retry, or deploy the latest build so /api/parse-candidate is available."
            : `The parsing service is unavailable (HTTP ${response.status}).`,
        );
      }
      if (!response.ok)
        throw new Error(body.error || `Parsing failed (HTTP ${response.status}).`);
      const profile = body.profile as ParsedProfile;
      let newId = "";
      await onRun(async () => {
        const result = await db()
          .from("pipeline_candidates")
          .insert({
            full_name: profile.fullName || incoming.name.replace(/\.pdf$/i, ""),
            email: profile.email,
            phone: profile.phone,
            source: "resume",
            skills: profile.skills.join(", "),
            notes: profileNotes(profile, `resume "${incoming.name}"`),
          })
          .select("id, stage")
          .single();
        if (result.error) throw result.error;
        const event = await db()
          .from("pipeline_events")
          .insert({
            candidate_id: result.data.id,
            from_stage: "",
            to_stage: result.data.stage,
            actor_email: actorEmail,
            rationale: `Intake: AI-parsed from resume "${incoming.name}" (confidence: ${profile.confidence}). Review the parsed details.`,
          });
        if (event.error) throw event.error;
        newId = result.data.id;
        return `Added ${profile.fullName || "the candidate"} from "${incoming.name}" — review the parsed details.`;
      }, "Candidate added.");
      if (newId) {
        onAdded(newId);
        onClose();
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "The resume could not be parsed.");
    } finally {
      setIntakeBusy(false);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void addFromResume(e.dataTransfer.files?.[0]);
  }

  function addCandidate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let newId = "";
    void onRun(async () => {
      const result = await db()
        .from("pipeline_candidates")
        .insert({
          full_name: String(f.get("full_name")).trim(),
          email: String(f.get("email")).trim(),
          phone: String(f.get("phone")).trim(),
          source: String(f.get("source")),
          referrer: String(f.get("referrer")).trim(),
          opportunity_id: String(f.get("opportunity_id")) || null,
          skills: String(f.get("skills")).trim(),
          notes: String(f.get("notes")).trim(),
        })
        .select("id, stage")
        .single();
      if (result.error) throw result.error;
      newId = result.data.id;
      return "Candidate added to the talent pool.";
    }, "Candidate added.").then(() => {
      if (newId) {
        onAdded(newId);
        onClose();
      }
    });
  }

  return (
    <div className="intake-overlay" onClick={onClose}>
      <div
        className="intake-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Add a candidate"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="intake-sheet-head">
          <div>
            <div className="intake-sheet-eyebrow">Talent pool</div>
            <h2>Add a candidate</h2>
          </div>
          <button className="intake-sheet-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div
          className={`intake-drop${dragOver ? " drag-over" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Drop a resume PDF to add a candidate, or browse"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {intakeBusy ? <Loader2 size={22} className="intake-spin" /> : <Upload size={22} />}
          <strong>
            {intakeBusy ? "Adding candidate from resume…" : "Drop a resume PDF to add a candidate"}
          </strong>
          <span className="muted small-text">
            or click to browse · PDF up to 3 MB · the configured AI model extracts
            the contact details, skills and a profile sketch
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              void addFromResume(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="intake-hint">
          The record opens right after the drop so you can review and correct the
          parsed details — the parse is stamped in the audit timeline with its
          confidence.
        </p>

        <div className="intake-divider">
          <span>Or add manually</span>
        </div>

        <form className="form" onSubmit={addCandidate}>
          <div className="form-columns">
            <label>
              Full name
              <input name="full_name" required maxLength={200} />
            </label>
            <label>
              Email
              <input name="email" type="email" maxLength={200} />
            </label>
            <label>
              Phone
              <input name="phone" maxLength={40} />
            </label>
            <label>
              Source
              <select name="source" defaultValue="career_site">
                {SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Referrer (referrals)
              <input name="referrer" maxLength={200} />
            </label>
            <label>
              Opportunity
              <select name="opportunity_id" defaultValue="">
                <option value="">None yet</option>
                {opportunities.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Skills
            <input name="skills" maxLength={2000} placeholder="e.g. Kubernetes, Python, 3 yrs" />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={3} maxLength={5000} />
          </label>
          <div className="actions">
            <button className="btn" disabled={intakeBusy}>
              Add candidate
            </button>
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

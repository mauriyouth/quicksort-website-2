import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { capabilityName, capabilityVerticals, db, type Row } from "@quicksort/candidate-db";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@quicksort-sas/ui";
import { cn } from "cn";
import { EmptyState, StatusBadge } from "../ui";

type Props = {
  userId: string;
  profile: Row<"candidate_profiles"> | null;
  skills: Row<"candidate_skills">[];
  projects: Row<"candidate_projects">[];
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
};

export function CandidateCapabilityProfile({ userId, profile, skills, projects, busy, action }: Props) {
  const [addingSkill, setAddingSkill] = useState(false);
  const [addingProject, setAddingProject] = useState(false);

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void action(async () => {
      const result = await db().from("candidate_profiles").upsert({
        candidate_id: userId,
        headline: String(values.get("headline")).trim(),
        bio: String(values.get("bio")).trim(),
        location: String(values.get("location")).trim(),
        linkedin_url: String(values.get("linkedin_url")).trim(),
        availability: String(values.get("availability")).trim(),
      }, { onConflict: "candidate_id" }).select("candidate_id").single();
      if (result.error) throw result.error;
    }, "Profile submitted for admin review.");
  }

  function addSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void action(async () => {
      const result = await db().from("candidate_skills").insert({
        candidate_id: userId,
        vertical: String(values.get("vertical")),
        name: String(values.get("name")).trim(),
        proficiency: String(values.get("proficiency")),
        years_experience: Number(values.get("years")) || 0,
      });
      if (result.error) throw result.error;
      form.reset();
      setAddingSkill(false);
    }, "Skill submitted for admin review.");
  }

  function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const technologies = String(values.get("technologies")).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
    void action(async () => {
      const result = await db().from("candidate_projects").insert({
        candidate_id: userId,
        vertical: String(values.get("vertical")),
        title: String(values.get("title")).trim(),
        client_name: String(values.get("client_name")).trim(),
        summary: String(values.get("summary")).trim(),
        outcome: String(values.get("outcome")).trim(),
        technologies,
        project_url: String(values.get("project_url")).trim(),
        video_urls: String(values.get("video_urls")).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 10),
      });
      if (result.error) throw result.error;
      form.reset();
      setAddingProject(false);
    }, "Project submitted for admin review.");
  }

  const reviewTitle = profile?.review_status === "approved" ? "Your profile is approved" : profile?.review_status === "in_review" ? "Your updates are in review" : "Build your capability profile";
  return <div className="flex min-w-0 flex-col gap-6">
    <Card>
      <CardHeader>
        <span className="label-mono">Admin review</span>
        <CardTitle role="heading" aria-level={2} className="text-lg">{reviewTitle}</CardTitle>
        <CardDescription>Only admin-approved skills and projects appear in Business capabilities.</CardDescription>
        <CardAction><StatusBadge status={profile?.review_status ?? "draft"} /></CardAction>
      </CardHeader>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Professional profile</CardTitle>
        <CardDescription>Tell the team where you create the most value.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="@container flex flex-col gap-4" key={profile?.updated_at ?? "new"} onSubmit={saveProfile}>
          <div className={COLUMNS}>
            <Labelled label="Professional headline">{(id) => <Input id={id} name="headline" maxLength={200} defaultValue={profile?.headline} placeholder="Senior AI infrastructure engineer" />}</Labelled>
            <Labelled label="Location">{(id) => <Input id={id} name="location" maxLength={200} defaultValue={profile?.location} placeholder="Paris, France" />}</Labelled>
          </div>
          <Labelled label="About your work">{(id) => <Textarea id={id} name="bio" maxLength={3000} defaultValue={profile?.bio} className="min-h-28 resize-y" placeholder="Describe the systems you build, the problems you solve and the environments you know best." />}</Labelled>
          <div className={COLUMNS}>
            <Labelled label="LinkedIn profile">{(id) => <Input id={id} name="linkedin_url" type="url" defaultValue={profile?.linkedin_url} placeholder="https://www.linkedin.com/in/..." />}</Labelled>
            <Labelled label="Availability">{(id) => <Input id={id} name="availability" maxLength={200} defaultValue={profile?.availability} placeholder="Available from November · Paris or remote" />}</Labelled>
          </div>
          <div><Button type="submit" disabled={busy}>Save and submit for review</Button></div>
        </form>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Skills</CardTitle>
        <CardDescription>Map each skill to one QuickSort service vertical.</CardDescription>
        <CardAction><Button variant="outline" size="sm" aria-expanded={addingSkill} onClick={() => setAddingSkill((value) => !value)}><Plus data-icon="inline-start" aria-hidden="true" /> Add skill</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {addingSkill && <form className={INLINE_FORM} onSubmit={addSkill}>
          <div className={COLUMNS}>
            <Labelled label="Vertical">{(id) => <VerticalSelect id={id} />}</Labelled>
            <Labelled label="Skill">{(id) => <Input id={id} name="name" required maxLength={120} placeholder="Kubernetes, RAG evaluation, speech models…" />}</Labelled>
          </div>
          <div className={COLUMNS}>
            <Labelled label="Level">{(id) => <NativeSelect id={id} className="w-full" name="proficiency"><NativeSelectOption>Learning</NativeSelectOption><NativeSelectOption>Experienced</NativeSelectOption><NativeSelectOption>Advanced</NativeSelectOption><NativeSelectOption>Expert</NativeSelectOption></NativeSelect>}</Labelled>
            <Labelled label="Years of experience">{(id) => <Input id={id} name="years" type="number" min="0" max="60" step="0.5" defaultValue="1" />}</Labelled>
          </div>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Add skill</Button><Button type="button" variant="ghost" onClick={() => setAddingSkill(false)}>Cancel</Button></div>
        </form>}
        {!skills.length ? <EmptyState title="No skills added yet">Add the skills that show how you contribute to QuickSort’s four service verticals.</EmptyState> : <ul className={LIST}>{skills.map((skill) => <li key={skill.id} className={ROW}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="label-mono">{capabilityName(skill.vertical)}</span>
            <h3 className="m-0 text-[15px] font-medium">{skill.name}</h3>
            <p className="m-0 text-[13px] text-muted-foreground">{skill.proficiency} · {skill.years_experience} years</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={skill.approved ? "approved" : "in review"} />
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${skill.name}`} disabled={busy} onClick={() => void action(async () => { const result = await db().from("candidate_skills").delete().eq("id", skill.id); if (result.error) throw result.error; }, "Skill removed.")}><Trash2 aria-hidden="true" /></Button>
          </div>
        </li>)}</ul>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Projects</CardTitle>
        <CardDescription>Add the projects you have worked on and describe what you delivered.</CardDescription>
        <CardAction><Button variant="outline" size="sm" aria-expanded={addingProject} onClick={() => setAddingProject((value) => !value)}><Plus data-icon="inline-start" aria-hidden="true" /> Add project</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {addingProject && <form className={INLINE_FORM} onSubmit={addProject}>
          <div className={COLUMNS}>
            <Labelled label="Vertical">{(id) => <VerticalSelect id={id} />}</Labelled>
            <Labelled label="Project title">{(id) => <Input id={id} name="title" required maxLength={200} />}</Labelled>
          </div>
          <Labelled label="Client or organisation (optional)">{(id) => <Input id={id} name="client_name" maxLength={200} />}</Labelled>
          <Labelled label="What you delivered">{(id) => <Textarea id={id} name="summary" required maxLength={3000} className="min-h-24 resize-y" />}</Labelled>
          <Labelled label="Outcome or impact">{(id) => <Textarea id={id} name="outcome" maxLength={1000} className="min-h-24 resize-y" />}</Labelled>
          <div className={COLUMNS}>
            <Labelled label="Technologies" hint="Separate technologies with commas.">{(id, hintId) => <Input id={id} name="technologies" placeholder="Python, Kubernetes, Azure" aria-describedby={hintId} />}</Labelled>
            <Labelled label="Project link (optional)">{(id) => <Input id={id} name="project_url" type="url" placeholder="https://…" />}</Labelled>
          </div>
          <Labelled label="Video links (optional)" hint="Add one video link per line.">{(id, hintId) => <Textarea id={id} name="video_urls" className="min-h-24 resize-y" placeholder={"https://youtube.com/…\nhttps://vimeo.com/…"} aria-describedby={hintId} />}</Labelled>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Add project</Button><Button type="button" variant="ghost" onClick={() => setAddingProject(false)}>Cancel</Button></div>
        </form>}
        {!projects.length ? <EmptyState title="No projects yet">Add the first project you have worked on.</EmptyState> : <ul className={LIST}>{projects.map((project) => <li key={project.id} className={ROW}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="label-mono">{capabilityName(project.vertical)}</span>
            <h3 className="m-0 text-[15px] font-medium">{project.title}</h3>
            <p className="m-0 text-[13px] text-muted-foreground">{project.summary}</p>
            {project.technologies.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{project.technologies.map((technology) => <Badge key={technology} variant="outline">{technology}</Badge>)}</div>}
            {(project.project_url || project.video_urls.length > 0) && <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {project.project_url && <a className={LINK} href={project.project_url} target="_blank" rel="noreferrer">Open project <ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}
              {project.video_urls.map((url, index) => <a className={LINK} href={url} target="_blank" rel="noreferrer" key={url}>Watch video {project.video_urls.length > 1 ? index + 1 : ""}<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>)}
            </div>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={project.approved ? "approved" : "in review"} />
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${project.title}`} disabled={busy} onClick={() => void action(async () => { const result = await db().from("candidate_projects").delete().eq("id", project.id); if (result.error) throw result.error; }, "Project removed.")}><Trash2 aria-hidden="true" /></Button>
          </div>
        </li>)}</ul>}
      </CardContent>
    </Card>
  </div>;
}

const COLUMNS = "grid gap-4 @lg:grid-cols-2";
const INLINE_FORM = "@container flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4";
const LIST = "m-0 flex list-none flex-col divide-y divide-border p-0";
const ROW = "flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0";
const LINK = "inline-flex items-center gap-1 text-[13px] font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

function Labelled({ label, hint, children, className }: { label: string; hint?: string; children: (id: string, hintId?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return <Field className={cn("min-w-0 gap-1.5", className)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {children(id, hintId)}
    {hint && <FieldDescription id={hintId} className="text-xs">{hint}</FieldDescription>}
  </Field>;
}

function VerticalSelect({ id }: { id: string }) {
  return <NativeSelect id={id} className="w-full" name="vertical">{capabilityVerticals.map((vertical) => <NativeSelectOption key={vertical.id} value={vertical.id}>{vertical.name}</NativeSelectOption>)}</NativeSelect>;
}

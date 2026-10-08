import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { capabilityName, capabilityVerticals, db, type Row } from "@quicksort/candidate-db";
import { Empty, Pill } from "@quicksort/candidate-ui";

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
      });
      if (result.error) throw result.error;
      form.reset();
      setAddingProject(false);
    }, "Project submitted for admin review.");
  }

  return <>
    <section className="profile-status-card">
      <div><span className="eyebrow">Admin review</span><h2>{profile?.review_status === "approved" ? "Your profile is approved" : profile?.review_status === "in_review" ? "Your updates are in review" : "Build your capability profile"}</h2><p>Only admin-approved skills and project evidence appear in Business capabilities.</p></div>
      <Pill status={profile?.review_status ?? "draft"}/>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Professional profile</h2><p className="muted">Tell the team where you create the most value.</p></div></div>
      <form className="form" key={profile?.updated_at ?? "new"} onSubmit={saveProfile}>
        <div className="form-columns"><label>Professional headline<input name="headline" maxLength={200} defaultValue={profile?.headline} placeholder="Senior AI infrastructure engineer"/></label><label>Location<input name="location" maxLength={200} defaultValue={profile?.location} placeholder="Paris, France"/></label></div>
        <label>About your work<textarea name="bio" maxLength={3000} defaultValue={profile?.bio} placeholder="Describe the systems you build, the problems you solve and the environments you know best."/></label>
        <div className="form-columns"><label>LinkedIn profile<input name="linkedin_url" type="url" defaultValue={profile?.linkedin_url} placeholder="https://www.linkedin.com/in/..."/></label><label>Availability<input name="availability" maxLength={200} defaultValue={profile?.availability} placeholder="Available from November · Paris or remote"/></label></div>
        <div><button className="btn" disabled={busy}>Save and submit for review</button></div>
      </form>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Skills</h2><p className="muted">Map each skill to one QuickSort service vertical.</p></div><button className="btn secondary small" onClick={() => setAddingSkill((value) => !value)}><Plus size={14}/> Add skill</button></div>
      {addingSkill && <form className="form capability-inline-form" onSubmit={addSkill}>
        <div className="form-columns"><label>Vertical<select name="vertical">{capabilityVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label><label>Skill<input name="name" required maxLength={120} placeholder="Kubernetes, RAG evaluation, speech models…"/></label></div>
        <div className="form-columns"><label>Level<select name="proficiency"><option>Learning</option><option>Experienced</option><option>Advanced</option><option>Expert</option></select></label><label>Years of experience<input name="years" type="number" min="0" max="60" step="0.5" defaultValue="1"/></label></div>
        <div className="actions"><button className="btn" disabled={busy}>Add skill</button><button type="button" className="btn secondary" onClick={() => setAddingSkill(false)}>Cancel</button></div>
      </form>}
      {!skills.length ? <Empty title="No skills added yet">Add the skills that show how you contribute to QuickSort’s four service verticals.</Empty> : <div className="capability-record-list">{skills.map((skill) => <article key={skill.id}><div><span className="record-vertical">{capabilityName(skill.vertical)}</span><h3>{skill.name}</h3><p>{skill.proficiency} · {skill.years_experience} years</p></div><div className="actions"><Pill status={skill.approved ? "approved" : "in review"}/><button className="icon-danger" aria-label={`Remove ${skill.name}`} disabled={busy} onClick={() => void action(async () => { const result = await db().from("candidate_skills").delete().eq("id", skill.id); if (result.error) throw result.error; }, "Skill removed.")}><Trash2 size={15}/></button></div></article>)}</div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Project evidence</h2><p className="muted">Add work that proves your experience. Do not include confidential details.</p></div><button className="btn secondary small" onClick={() => setAddingProject((value) => !value)}><Plus size={14}/> Add project</button></div>
      {addingProject && <form className="form capability-inline-form" onSubmit={addProject}>
        <div className="form-columns"><label>Vertical<select name="vertical">{capabilityVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label><label>Project title<input name="title" required maxLength={200}/></label></div>
        <label>Client or organisation (optional)<input name="client_name" maxLength={200}/></label>
        <label>What you delivered<textarea name="summary" required maxLength={3000}/></label>
        <label>Outcome or impact<textarea name="outcome" maxLength={1000}/></label>
        <div className="form-columns"><label>Technologies<input name="technologies" placeholder="Python, Kubernetes, Azure"/><span className="muted">Separate technologies with commas.</span></label><label>Project link (optional)<input name="project_url" type="url" placeholder="https://…"/></label></div>
        <div className="actions"><button className="btn" disabled={busy}>Add project</button><button type="button" className="btn secondary" onClick={() => setAddingProject(false)}>Cancel</button></div>
      </form>}
      {!projects.length ? <Empty title="No project evidence yet">Add a project to show how you have used your skills in practice.</Empty> : <div className="capability-record-list">{projects.map((project) => <article key={project.id}><div><span className="record-vertical">{capabilityName(project.vertical)}</span><h3>{project.title}</h3><p>{project.summary}</p>{project.technologies.length > 0 && <div className="record-tags">{project.technologies.map((technology) => <span key={technology}>{technology}</span>)}</div>}</div><div className="actions"><Pill status={project.approved ? "approved" : "in review"}/><button className="icon-danger" aria-label={`Remove ${project.title}`} disabled={busy} onClick={() => void action(async () => { const result = await db().from("candidate_projects").delete().eq("id", project.id); if (result.error) throw result.error; }, "Project removed.")}><Trash2 size={15}/></button></div></article>)}</div>}
    </section>
  </>;
}

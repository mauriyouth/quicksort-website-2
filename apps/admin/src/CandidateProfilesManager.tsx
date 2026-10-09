import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { capabilityVerticals, db, type Row } from "@quicksort/candidate-db";
import { Empty, Pill, formatDate } from "@quicksort/candidate-ui";

type Props = {
  people: Row<"profiles">[];
  profiles: Row<"candidate_profiles">[];
  skills: Row<"candidate_skills">[];
  projects: Row<"candidate_projects">[];
  selected: string;
  onSelect: (id: string) => void;
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
};

export function CandidateProfilesManager({ people, profiles, skills, projects, selected, onSelect, busy, action }: Props) {
  const candidate = people.find((person) => person.id === selected) ?? null;
  const profile = profiles.find((item) => item.candidate_id === selected) ?? null;
  const candidateSkills = skills.filter((item) => item.candidate_id === selected);
  const candidateProjects = projects.filter((item) => item.candidate_id === selected);
  const [addSkill, setAddSkill] = useState(false);
  const [addProject, setAddProject] = useState(false);
  useEffect(() => { setAddSkill(false); setAddProject(false); }, [selected]);

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    void action(async () => {
      const identity = await db().from("profiles").update({ full_name: String(values.get("full_name")).trim() }).eq("id", selected).select("id").single();
      if (identity.error) throw identity.error;
      const result = await db().from("candidate_profiles").upsert({
        candidate_id: selected,
        headline: String(values.get("headline")).trim(),
        bio: String(values.get("bio")).trim(),
        location: String(values.get("location")).trim(),
        linkedin_url: String(values.get("linkedin_url")).trim(),
        availability: String(values.get("availability")).trim(),
      }, { onConflict: "candidate_id" }).select("candidate_id").single();
      if (result.error) throw result.error;
    }, "Candidate profile saved. Approve it when it is ready for Business.");
  }

  function saveSkill(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    void action(async () => {
      const payload = { candidate_id: selected, vertical: String(values.get("vertical")), name: String(values.get("name")).trim(), proficiency: String(values.get("proficiency")), years_experience: Number(values.get("years")) || 0 };
      const result = id ? await db().from("candidate_skills").update(payload).eq("id", id) : await db().from("candidate_skills").insert(payload);
      if (result.error) throw result.error;
      if (!id) { form.reset(); setAddSkill(false); }
    }, "Skill saved. Approve the profile to publish it.");
  }

  function saveProject(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      candidate_id: selected,
      vertical: String(values.get("vertical")),
      title: String(values.get("title")).trim(),
      client_name: String(values.get("client_name")).trim(),
      summary: String(values.get("summary")).trim(),
      outcome: String(values.get("outcome")).trim(),
      technologies: String(values.get("technologies")).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20),
      project_url: String(values.get("project_url")).trim(),
      video_urls: String(values.get("video_urls")).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 10),
    };
    void action(async () => {
      const result = id ? await db().from("candidate_projects").update(payload).eq("id", id) : await db().from("candidate_projects").insert(payload);
      if (result.error) throw result.error;
      if (!id) { form.reset(); setAddProject(false); }
    }, "Project saved. Approve the profile to publish it.");
  }

  return <>
    <section className="panel">
      <label className="form">Select a candidate<select value={selected} onChange={(event) => onSelect(event.target.value)}><option value="">Choose a candidate</option>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}</select></label>
    </section>
    {!candidate ? <Empty title="Select a candidate">Open a candidate to review and edit their professional profile, skills and projects.</Empty> : <>
      <section className="profile-status-card admin-review-card">
        <div><span className="eyebrow">Capability publishing</span><h2>{candidate.full_name || candidate.email}</h2><p>{profile?.review_status === "approved" && profile.approved_at ? `Approved ${formatDate(profile.approved_at)}` : "Not published to Business"}</p></div>
        <div className="actions"><Pill status={profile?.review_status ?? "draft"}/><button className="btn lime" disabled={busy} onClick={() => void action(async () => { const result = await db().rpc("approve_candidate_capability_profile", { target_candidate: candidate.id }); if (result.error) throw result.error; }, "Profile, skills and projects approved for Business.")}><CheckCircle2 size={16}/> Approve for Business</button></div>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Profile</h2><p className="muted">Admin edits are authoritative. Approve after checking the complete profile.</p></div></div>
        <form className="form" key={`${candidate.id}-${profile?.updated_at ?? "new"}`} onSubmit={saveProfile}>
          <div className="form-columns"><label>Full name<input name="full_name" required maxLength={200} defaultValue={candidate.full_name}/></label><label>Email<input value={candidate.email} disabled/></label></div>
          <div className="form-columns"><label>Professional headline<input name="headline" maxLength={200} defaultValue={profile?.headline}/></label><label>Location<input name="location" maxLength={200} defaultValue={profile?.location}/></label></div>
          <label>Professional summary<textarea name="bio" maxLength={3000} defaultValue={profile?.bio}/></label>
          <div className="form-columns"><label>LinkedIn<input name="linkedin_url" type="url" defaultValue={profile?.linkedin_url}/></label><label>Availability<input name="availability" maxLength={200} defaultValue={profile?.availability}/></label></div>
          <div><button className="btn" disabled={busy}>Save profile</button></div>
        </form>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Skills</h2><p className="muted">Edit each skill and its QuickSort vertical.</p></div><button className="btn secondary small" onClick={() => setAddSkill((value) => !value)}><Plus size={14}/> Add</button></div>
        {addSkill && <SkillForm onSubmit={(event) => saveSkill(event)} busy={busy}/>} 
        {!candidateSkills.length && !addSkill ? <Empty title="No skills submitted">Add the candidate’s first capability skill.</Empty> : <div className="admin-evidence-list">{candidateSkills.map((skill) => <form className="form evidence-edit-card" key={`${skill.id}-${skill.updated_at}`} onSubmit={(event) => saveSkill(event, skill.id)}><div className="form-columns"><label>Vertical<select name="vertical" defaultValue={skill.vertical}>{capabilityVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label><label>Skill<input name="name" required defaultValue={skill.name}/></label></div><div className="form-columns"><label>Level<select name="proficiency" defaultValue={skill.proficiency}><option>Learning</option><option>Experienced</option><option>Advanced</option><option>Expert</option></select></label><label>Years<input name="years" type="number" min="0" max="60" step="0.5" defaultValue={skill.years_experience}/></label></div><div className="actions"><Pill status={skill.approved ? "approved" : "in review"}/><button className="btn secondary small" disabled={busy}>Save</button><button type="button" className="icon-danger" aria-label={`Delete ${skill.name}`} onClick={() => void action(async () => { const result = await db().from("candidate_skills").delete().eq("id", skill.id); if (result.error) throw result.error; }, "Skill deleted.")}><Trash2 size={15}/></button></div></form>)}</div>}
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Projects</h2><p className="muted">Review what this person delivered before publishing it to Business.</p></div><button className="btn secondary small" onClick={() => setAddProject((value) => !value)}><Plus size={14}/> Add</button></div>
        {addProject && <ProjectForm onSubmit={(event) => saveProject(event)} busy={busy}/>} 
        {!candidateProjects.length && !addProject ? <Empty title="No projects submitted">Add the candidate’s first project.</Empty> : <div className="admin-evidence-list">{candidateProjects.map((project) => <ProjectForm key={`${project.id}-${project.updated_at}`} project={project} busy={busy} onSubmit={(event) => saveProject(event, project.id)} onDelete={() => void action(async () => { const result = await db().from("candidate_projects").delete().eq("id", project.id); if (result.error) throw result.error; }, "Project deleted.")}/>)}</div>}
      </section>
    </>}
  </>;
}

function SkillForm({ onSubmit, busy }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <form className="form evidence-edit-card" onSubmit={onSubmit}><div className="form-columns"><label>Vertical<select name="vertical">{capabilityVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label><label>Skill<input name="name" required maxLength={120}/></label></div><div className="form-columns"><label>Level<select name="proficiency"><option>Learning</option><option>Experienced</option><option>Advanced</option><option>Expert</option></select></label><label>Years<input name="years" type="number" min="0" max="60" step="0.5" defaultValue="1"/></label></div><button className="btn" disabled={busy}>Save skill</button></form>;
}

function ProjectForm({ project, onSubmit, onDelete, busy }: { project?: Row<"candidate_projects">; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDelete?: () => void; busy: boolean }) {
  return <form className="form evidence-edit-card" onSubmit={onSubmit}><div className="form-columns"><label>Vertical<select name="vertical" defaultValue={project?.vertical}>{capabilityVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.name}</option>)}</select></label><label>Project title<input name="title" required maxLength={200} defaultValue={project?.title}/></label></div><label>Client or organisation<input name="client_name" maxLength={200} defaultValue={project?.client_name}/></label><label>What they delivered<textarea name="summary" required maxLength={3000} defaultValue={project?.summary}/></label><label>Outcome or impact<textarea name="outcome" maxLength={1000} defaultValue={project?.outcome}/></label><div className="form-columns"><label>Technologies<input name="technologies" defaultValue={project?.technologies.join(", ")}/></label><label>Project link<input name="project_url" type="url" defaultValue={project?.project_url}/></label></div><label>Video links<textarea name="video_urls" rows={3} defaultValue={project?.video_urls.join("\n")} placeholder="One video link per line"/></label><div className="actions">{project && <Pill status={project.approved ? "approved" : "in review"}/>}<button className="btn secondary small" disabled={busy}>Save project</button>{onDelete && <button type="button" className="icon-danger" aria-label={`Delete ${project?.title}`} onClick={onDelete}><Trash2 size={15}/></button>}</div></form>;
}

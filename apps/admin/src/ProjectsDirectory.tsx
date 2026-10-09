import { useMemo, useState } from "react";
import { ArrowUpRight, Search, Video } from "lucide-react";
import { capabilityName, type Row } from "@quicksort/candidate-db";
import { Empty, Pill, formatDate } from "@quicksort/candidate-ui";

export function ProjectsDirectory({ projects, people }: { projects: Row<"candidate_projects">[]; people: Row<"profiles">[] }) {
  const [query, setQuery] = useState("");
  const person = (project: Row<"candidate_projects">) => {
    const profile = people.find((item) => item.id === project.candidate_id);
    return {
      name: profile?.full_name || project.contributor_name || "Former QuickSort contributor",
      email: profile?.email || project.contributor_email,
      active: Boolean(profile),
    };
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => {
      const contributor = person(project);
      return [project.title, project.client_name, project.summary, project.outcome, contributor.name, contributor.email, ...project.technologies].join(" ").toLowerCase().includes(needle);
    });
  }, [projects, people, query]);

  return <>
    <section className="panel project-directory-toolbar">
      <label><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, people, clients or technologies"/></label>
      <span>{filtered.length} {filtered.length === 1 ? "project" : "projects"}</span>
    </section>
    {!filtered.length ? <Empty title={projects.length ? "No projects match" : "No projects yet"}>{projects.length ? "Try a different search." : "Projects added by candidates will appear here."}</Empty> : <section className="project-directory-grid">{filtered.map((project) => {
      const contributor = person(project);
      return <article className="project-directory-card" key={project.id}>
        <header><div><span>{capabilityName(project.vertical)}</span><h2>{project.title}</h2></div><Pill status={project.approved ? "approved" : "in review"}/></header>
        <div className="project-contributor"><strong>{contributor.name}</strong><span>{contributor.email || (contributor.active ? "QuickSort contributor" : "Archived contributor")}</span>{!contributor.active && <small>Former contributor · project retained</small>}</div>
        {project.client_name && <p className="project-client">{project.client_name}</p>}
        <section><h3>What they delivered</h3><p>{project.summary}</p></section>
        {project.outcome && <section><h3>Outcome or impact</h3><p>{project.outcome}</p></section>}
        {project.technologies.length > 0 && <div className="record-tags">{project.technologies.map((technology) => <span key={technology}>{technology}</span>)}</div>}
        {(project.project_url || project.video_urls.length > 0) && <div className="project-links">{project.project_url && <a href={project.project_url} target="_blank" rel="noreferrer">Open project <ArrowUpRight size={13}/></a>}{project.video_urls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}><Video size={13}/> Video {project.video_urls.length > 1 ? index + 1 : ""}</a>)}</div>}
        <footer>Updated {formatDate(project.updated_at)}</footer>
      </article>;
    })}</section>}
  </>;
}

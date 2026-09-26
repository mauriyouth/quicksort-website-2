# Product Requirements Document — TalentOS HR Pipeline: AI-Augmented Recruitment, Onboarding & Offboarding
*Module PRD #1 of th internal platform — Version 1.0 — September 2026. Internal use — single ESN. Scope: job offer → candidate → AI matching & screening → interviews → hiring → onboarding → employment → offboarding.*

---

## 1. Executive Summary & Scope

The HR pipeline is the module where the TalentOS platform either compounds value or leaks it. Every euro of mission margin starts as a hiring decision: a consultant hired 20 days faster is 20 days of billable TJM (taux journalier moyen — daily bill rate) recovered; a consultant hired on the wrong demand signal becomes intercontrat (paid bench time between client missions) at roughly 21.7 × CJM (coût journalier moyen — fully loaded daily cost) per month. This module PRD specifies the recruitment-to-employment pipeline as a standalone requirement set, consistent with the master PRD v1.2: single-tenant, internal use, human-final-decision AI, and compliance-by-design.

### 1.1 Why a dedicated HR pipeline module

Recruitment is the slowest, most compliance-exposed link in the ESN economic loop, and it deserves its own requirement document for three reasons. First, the economics: median time-to-fill for an IT consultant role in French ESNs is estimated at ~45 days in 2026, up ~18 days versus 2020 (single-vendor study, directional), and the funnel burns measurable handling delay at every stage — ~2 days at présélection (pre-screening), ~5 days before the HR interview, ~7 days around the technical interview. Compressing administrative slack inside those stages is the cheapest capacity an ESN can buy. Second, the regulatory surface: recruitment and employment AI is classified high-risk under EU AI Act Annex III point 4, with fines up to €15M or 3% of worldwide turnover for high-risk breaches and €35M or 7% for prohibited practices such as emotion recognition on candidates, banned since 2 February 2025. As deployer of its own internal AI, our ESN carries these obligations directly — this module PRD is where they become testable requirements rather than policy statements. Third, the data asset: the pipeline produces the structured talent record (parsed skills, interview scorecards, stage outcomes) that the staffing, zero-bench and CRM modules match against downstream; if intake is sloppy, every downstream AI feature degrades.

### 1.2 Pipeline coverage (job offer → hired → offboarding) and module boundaries

This module covers the full arc: job opportunity and offer management, multichannel sourcing and intake, AI resume matching, AI initial screening, interview management and interview intelligence, decision and offer, contract and candidate→employee conversion, pre-boarding and onboarding, the employment record (probation, confirmation), and offboarding back to alumni status. Boundaries are explicit:

1. **Upstream boundary — CRM & Opportunities module.** A opportunity "sur mission" consumes a qualified client need (fiche de besoin) owned by the CRM module; this module reads the need, it does not qualify it.
2. **Downstream boundary — Staffing & Missions module.** Positioning a hired or benched consultant on a mission, the plan de charge (workload plan) and roll-off alerts live in the staffing module; the HR pipeline emits the employee record and availability signal that staffing consumes.
3. **Finance boundary.** Compensation approval chains and margin simulation are specified here because they gate the offer; invoicing itself is delegated to Qonto via the Business API per the master PRD and is out of scope.
4. **Payroll.** Payroll execution stays with the specialized provider; this module produces payroll-preparation exports only.

### 1.3 Design principles: human-decides AI, compliance-by-design, one talent record

Three principles govern every requirement in this document. **Human-decides AI:** the system parses, ranks, drafts, screens and reminds; a named human always advances, rejects, offers and hires. This is not a UX preference — it is a legal posture (EU AI Act Art. 14 human oversight, GDPR Art. 22) and a candidate-trust posture: 71% of the public opposes AI making final hiring decisions and roughly a third of candidates report dropping out of AI-led processes, so every AI-assisted step carries a guaranteed human alternative path. **Compliance-by-design:** candidate disclosure that AI is used, consent-based recording, immutable decision logs retained at least six months, and pre-service information of workers' representatives are built into the workflow, per the deployer duties of AI Act Art. 26. **One talent record:** one canonical person record transitions Candidate → Employee → Alumni without re-entry or loss, so rediscovery, quality-of-hire analytics and alumni flows operate on complete history. Build-sequencing implication: no AI feature in sections 4–5 ships before the stage model (section 3) and the canonical record exist — every AI output is only as defensible as the data structure it reads.

---

## 2. Personas & Access Rights (module-scoped)

Access control on this module is a compliance surface before it is a convenience: the pipeline concentrates the most sensitive data classes in the company — candidate personal data, interview evidence, compensation proposals — and the RBAC model inherited from master PRD chapter 4 is where GDPR data minimization and AI Act human-oversight assignment become enforceable behavior.

### 2.1 Personas: HR Manager, Recruiter, Hiring Manager (Business Manager), Interviewer, Direction/CFO (read-only aggregates), Consultant (alumni of pipeline), Candidate (external portal)

Seven personas operate the pipeline, in three usage tiers. **Tier one — daily operators.** The **Recruiter** runs the funnel: opportunities, sourcing, AI shortlists, screening, scheduling; their administrative load (file qualification, note-taking) is what the AI layer offloads — 89% of AI-enabled recruiters cite time saved as the main benefit. The **Hiring Manager** — in our ESN model the Business Manager (*ingénieur d'affaires*, the 360° operator owning both the client account and the hire) — owns the demand signal, the client presentation and the final hiring decision. **Tier two — workflow owners and oversight.** The **HR Manager** owns screening policy, offers, contracts, compensation, onboarding and probation. The **Interviewer** (HR, technical lead, or BM as panelist) is a scoped, time-boxed role: access to the candidates they interview, for the panel assignment only. **Direction/CFO** consumes read-only aggregates — funnel velocity, cost per hire, offer-acceptance — and approves above-corridor compensation; they never see interview transcripts or individual AI scores. **Tier three — high-volume, low-touch.** The **Candidate** interacts only through the external portal (application, status, documents, AI-use disclosure, human-path request, GDPR rights) and sees their own file only — never a score, ranking or comparison. The **Consultant** is the pipeline's alumnus: their employee record carries candidate-era history, and at offboarding they return to the talent pool feeding rediscovery.

### 2.2 Module RBAC summary (table: entity × role — condensed from master ch. 4: candidates, applications, interviews, offers, contracts, compensation, onboarding plans, exit records)

Legend: **Full** = create/read/update/delete; **Read** = read-only; **Own** = full rights on owned/assigned records; **Scoped** = attribute-limited (own opportunities / panel membership / aggregates); **Approve** = validation gate only; **None** = no access.

| Entity | HR Manager | Recruiter | Hiring Mgr (BM) | Interviewer | Direction/CFO | Consultant | Candidate (portal) |
|---|---|---|---|---|---|---|---|
| Candidates / CVthèque | Read | Full | Read | Scoped (panel) | None | None | Own |
| Applications & opportunities | Read | Full | Own | None | Read (aggregates) | None | Own |
| Interviews & scorecards | Full | Full (own reqs) | Scoped (panel) | Scoped (panel) | None | None | None |
| Offers | Full | Read | Own (create, gated) | None | Approve (above corridor) | None | Own |
| Contracts | Full | None | Read (own hires) | None | Read | Own (read) | Own |
| Compensation | Full | None | Scoped (proposal only) | None | Full (Approve) | Own (read) | Own |
| Onboarding plans | Full | Read | Scoped (own hires) | None | Read (aggregates) | Own | Own (pre-boarding) |
| Exit records | Full | None | Scoped (own team) | None | Read (aggregates) | Own | — |

The matrix encodes three deliberate asymmetries that each close a documented risk. First, the Recruiter never sees compensation: the recruiter's job is funnel velocity, and salary visibility would both widen the personal-data exposure surface and bias screening toward negotiation dynamics rather than fit; the BM proposes within a corridor, HR validates, and the CFO approves exceptions — a three-party chain that keeps any single operator from trading margin for speed. Second, interview content is ring-fenced to panel + HR: transcripts and AI-scored summaries are the most evaluatively sensitive artifacts in the system, and even the CFO's financial-oversight mandate does not justify access; the Interviewer role is time-boxed to panel assignment so access decays automatically when the decision is made. Third, the Candidate row is the GDPR accountability surface — self-service access, rectification, erasure and human re-review — which converts Art. 26(11) candidate-notice and Art. 22 review obligations from legal text into default product behavior. Implication: any future feature that surfaces pipeline data to a new role (e.g., client-facing anonymized profiles) must extend this table first, because in this module the permission model is the compliance control.

---
## 3. Pipeline Stage Model

A single canonical stage model is the module's operating contract: it converts observed sector cycle times into enforceable SLAs, assigns every stage one accountable owner, and defines the exit criteria that keep the funnel honest. Median time-to-fill of ~45 days (directional, single-vendor) is not one delay — it is the sum of per-stage dwell, so the model manages dwell, not the aggregate.

### 3.1 Canonical stages & SLAs (table: stage → owner → SLA → exit criteria): job opportunity/offer → published/sourcing → application/intake → AI matching → AI initial screening → HR interview → technical interview → client presentation (if sur mission) → decision → offer → contract signed → pre-boarding → onboarding → hired (probation) → confirmed → offboarding

| # | Stage | Owner | Default SLA | Exit criteria |
|---|---|---|---|---|
| 1 | Job opportunity / offer draft | Hiring Mgr (BM) | 2 d to approval | Need qualified (fiche de besoin or speculative-profile brief); hiring mode tagged; approval logged |
| 2 | Published / sourcing | Recruiter | 1 d | Live on selected boards + career site; internal CVthèque rediscovery search executed |
| 3 | Application / intake | System → Recruiter | <10 s per CV parsed; 2 d triage | CV parsed into structured talent record; duplicates flagged; acknowledgment sent ≤1 h |
| 4 | AI matching | AI (recruiter reviews) | <30 s per opportunity | Ranked shortlist with explainable scores generated; recruiter review logged |
| 5 | AI initial screening | AI + Recruiter | 2 d (présélection) | Knockout criteria evaluated; screening summary + recommendation delivered; human advance/reject decision logged |
| 6 | HR interview | Recruiter / HR | 5 d | Structured scorecard submitted with evidence per competency |
| 7 | Technical interview | Tech interviewer | 7 d | Scorecard + (optional) test results submitted; divergence flags resolved or escalated |
| 8 | Client presentation (sur mission only) | Hiring Mgr (BM) | <24 h to proposal | Anonymized dossier de compétences sent; client feedback logged within 48 h |
| 9 | Decision | Hiring Mgr / BU Director | 2 d from consolidation | Human decision (advance / reject / offer) with recorded rationale |
| 10 | Offer | HR + BM | 2 d to send | Compensation within corridor or CFO approval; margin simulation displayed; e-signature routed |
| 11 | Contract signed | HR | 48 h reminder cadence | Countersigned contract archived; candidate→employee conversion executed |
| 12 | Pre-boarding | HR | Until day 1 | Document checklist complete (identity, diplomas, work permit, banking); IT access provisioned |
| 13 | Onboarding | Manager + parrain | 30 d plan | Day-1 readiness confirmed; parrain assigned ≤day 7; week 1/2/4 expectation check-ins done |
| 14 | Hired (probation) | Manager | Per contract type | Probation check-ins held; confirm/renew/terminate decision logged before expiry |
| 15 | Confirmed | HR | — | Probation validated; full employee record active; skills profile matchable by staffing module |
| 16 | Offboarding | HR + Manager | J-30 notice workflows | Exit checklist complete; knowledge transfer done; record transitioned to alumni with history intact |

Three properties of this model carry direct economic weight. First, the SLAs are calibrated to observed sector dwell — 2 days présélection, 5 days HR, 7 days technical — so the default configuration targets the median rather than an aspirational fiction; early dashboards should show breaches, and those breaches are the improvement backlog. Second, stage 8's <24-hour proposal SLA is the most commercially consequential row: sector practice holds that a client waiting 72 hours for a first profile has often already called a competitor, so sur mission opportunities are subordinated to the commercial clock, not the HR clock. Third, stages 12–16 belong in this module deliberately: recruitment ROI is realized or destroyed in the first six months of employment, and offboarding-to-alumni makes the CVthèque a compounding asset — an alum whose interview and mission history survives departure is rediscoverable the day a matching need opens. The 16 stages are not bureaucracy: stages 3–5 are largely machine-executed, and the human-heavy stages (6, 7, 9) are exactly where deliberation creates value and no SLA should trade judgment for speed.

### 3.2 Pipeline states, transitions, and the Kanban operating model

Operationally, stages 1–10 render as a drag-and-drop Kanban — the parity benchmark set by BoondManager's recruitment pipeline (states such as "À traiter", "En cours de qualif.", "Validé"), which recruiters already know how to run. Three state rules are non-negotiable:

1. **Every transition is an event.** Each move is timestamped, attributed, and appended to the immutable audit log — the same event stream that feeds per-stage dwell analytics and the AI Act logging duty.
2. **Gated transitions only.** Mandatory-field gates block silent shortcuts: no entry into "Offer" without an approved compensation proposal; no entry into "HR interview" without a completed knockout screening record; no candidate→employee conversion without a signed contract. Gates are configurable by administrators, but every gate change is itself logged.
3. **No silent rejection.** A candidate can leave the funnel only via a human disposition (rejected-with-reason, withdrawn, hired) — never by timeout, never by AI. Stale candidates trigger SLA escalation to the recruiter and, at 2× SLA, to the recruitment manager, because an unanswered application is an employer-brand cost and, under candidate-notice expectations, a compliance-adjacent risk.

Backward transitions (e.g., offer declined → back to decision) are first-class moves, not deletions: the offer, its margin simulation and the decline reason stay on the record, feeding offer-acceptance analytics. The Kanban's SLA-heat view (breaching cards first) is the recruiter's landing screen.

### 3.3 Hiring modes: "sur mission" vs "sur profil" and the pipeline-justification gate

French ESNs recruit in two modes, and the pipeline treats them as different risk classes. 
*Recrutement sur mission* hires against a signed or highly probable client need — the pipeline's job is speed, because revenue is waiting. 
*Recrutement sur profil* hires on profile and culture fit ahead of demand — sound only when the commercial pipeline justifies it, because hiring ahead of demand is precisely how consultants land in intercontrat. The sur profil offer is therefore the single riskiest economic decision this module supports: at ~€4,500–6,500 of monthly bench cost per unstaffed consultant, one unjustified speculative hire erases the annual ROI of the entire recruitment toolchain.

The module enforces the distinction structurally. Every opportunity and offer carries a mandatory hiring-mode tag; sur mission opportunities link to the CRM need and inherit its start date, target TJM and <24-hour client-presentation SLA. A sur profil offer cannot be sent until the **pipeline-justification gate** is passed: a decision screen computing expected utilization from probability-weighted pipeline demand for the profile's skill family, current bench count for comparable profiles, and time-to-staff history, approved or rejected by a human with delegated authority (BU Director or Direction) with a recorded rationale. The AI assembles the evidence and renders an advisory recommendation, labeled as such; accountability stays human per AI Act Art. 14. The gate's deeper function is cultural: it converts "we hired on a hunch and bench absorbed the cost" into a reviewable decision, and it generates the data (approved sur profil hires vs. realized utilization) that lets Direction recalibrate hiring risk appetite quarterly instead of annually.

---
## 4. Functional Requirements — Top of Funnel

Top-of-funnel design is governed by one insight: the cheapest qualified candidate is the one already in the database. Bullhorn's analysis of placement records found that 66.4% of externally sourced candidates were already sitting in the agency's own database (vendor-reported), so every requirement below is sequenced to exploit internal supply before external spend. Requirements are numbered FR-4.x.y, MoSCoW-prioritized, and written to be testable.

### 4.1 Job offer & opportunity management (FR-4.1.x): opportunity creation from a client need or speculative profile, approval workflow, multi-board publication, career-site page

**FR-4.1.1 — Opportunity creation from two origins.** The system shall create opportunities either (a) from a qualified client need in the CRM module, pre-filling the standardized *fiche de besoin* (mandatory vs. nice-to-have skills, seniority, location, duration, billing mode, start date, target TJM), or (b) as a speculative sur profil brief with skill family and justification draft. **Priority: Must.** *Acceptance criteria:* (1) sur mission opportunities carry a live link to the CRM need and inherit stage-8 SLA; (2) mandatory hiring-mode tag per §3.3; (3) creation-to-submitted-for-approval in ≤10 minutes for a CRM-linked need.

**FR-4.1.2 — Approval workflow.** Opportunitys shall route for approval (Hiring Manager → HR for budget/headcount check; Direction when sur profil or above-corridor compensation band) before publication. **Priority: Must.** *Acceptance criteria:* (1) approval or rejection with rationale within the stage-1 SLA of 2 days, with reminder at 1 day; (2) approver, decision and rationale immutably logged; (3) approved opportunity auto-transitions to stage 2.

**FR-4.1.3 — Multi-board publication and career site.** Approved opportunities shall publish to configurable job boards (connector/API), LinkedIn, and the company career site, with per-board tracking links; the career-site page is generated from the opportunity with brand template, AI-use disclosure notice, and human-path contact. **Priority: Must.** *Acceptance criteria:* (1) one action publishes to all selected channels; (2) source attribution per application is accurate to board level; (3) unpublishing propagates to all channels within 1 hour; (4) the AI disclosure text is versioned and legally reviewable.

### 4.2 Sourcing & intake (FR-4.2.x): LinkedIn extension, referrals, job boards, spontaneous applications; AI CV parsing into the structured talent record

**FR-4.2.1 — Unified multichannel intake.** The system shall create candidate records from a browser extension capturing LinkedIn profiles in one click; CV drag-and-drop and bulk import (PDF, DOCX); job-board feeds; employee referrals linked to the referrer; and career-site/spontaneous applications — all converging on the canonical talent record. **Priority: Must.** *Acceptance criteria:* (1) records land in a default "À traiter" state within 10 seconds from any channel; (2) source channel stamped and reportable; (3) bulk import of 500 CVs completes unattended with an error report.

**FR-4.2.2 — AI CV parsing into the structured talent record.** Incoming CVs shall be parsed by a semantic (LLM/NLP-based) engine — the industry has moved from keyword extraction to multilingual semantic parsing with skill inference from context — extracting identity, work history, education, certifications, languages and technical skills, normalized against the platform skills ontology, with adjacent skills inferred (e.g., Agile inferred from project-management experience) and visually distinguished from stated skills. **Priority: Must.** *Acceptance criteria:* (1) minimum fields: contact, last three positions, skills with years of experience, education, certifications; (2) French and English at launch; (3) every field editable, with recruiter corrections captured as model feedback; (4) special-category data (GDPR Art. 9) excluded from parsed scoring fields by default.

**FR-4.2.3 — Duplicate detection and internal-first rediscovery gate.** Intake shall fuzzy-match probable duplicates (identity, e-mail, phone) and propose merges with human confirmation; on every new opportunity the system shall run a semantic rediscovery search over the CVthèque — past applicants and silver medalists explicitly in scope — before external sourcing actions are enabled. **Priority: Must.** *Acceptance criteria:* (1) side-by-side merge screen, both histories preserved, no auto-merge; (2) internal shortlist returned in <30 seconds over a 50,000-profile pool, with match score plus natural-language explanation; (3) audit log records shortlist review before external spend, enforcing the 66.4%-rediscovery economics.

**FR-4.2.4 — Referral channel.** Any employee shall submit a referral in under one minute, with the referrer auto-linked and the CV parsed through FR-4.2.2. **Priority: Should.** *Acceptance criteria:* (1) referral attribution survives conversion to employee for bonus workflows; (2) referral conversion rate reportable per §3.2 analytics.

### 4.3 AI resume matching (FR-4.3.x): semantic matching of each candidate against the opportunity's skills/experience requirements; explainable score with evidence-linked factors (skills match %, seniority fit, availability, location); rank + explain, NEVER auto-reject; recruiter sees ranked list with reasons

Modern matching engines weigh hard skills, experience, location and availability into a match score and improve via recruiter feedback; agencies using AI-ranked matching are reported 63% more likely to fill a role in under 20 days (vendor-reported). The design consequence is that matching quality is a feedback-loop property, not a model property — the requirements below build the loop.

**FR-4.3.1 — Semantic matching with explainable score.** For each candidate against a opportunity, the system shall compute a semantic match score decomposed into evidence-linked factors — skills match %, seniority fit, availability, location, (sur mission) mission-context fit — each factor linking to the talent-record fields that drive it. **Priority: Must.** *Acceptance criteria:* (1) every factor displays its driving evidence (e.g., "Kubernetes, 3 yrs, inferred from 2 projects"); (2) inferred vs. stated skills distinguished in the explanation; (3) protected attributes and their proxies are excluded from scoring inputs and auditable as such — LLM screeners have demonstrated name-based bias (a 2024 University of Washington study found white-associated names favored 85% of the time), so input hygiene is a hard requirement, not a tuning option.

**FR-4.3.2 — Rank + explain, never auto-reject.** The recruiter shall see the opportunity's candidate pool as a ranked list with per-candidate score decomposition; the system shall provide no mechanism that rejects, hides, or auto-dispositions a candidate on the basis of the score. **Priority: Must.** *Acceptance criteria:* (1) no code path from score to rejection; (2) low-ranked candidates remain fully accessible; (3) every disposition is a logged human action per §3.2 rule 3; (4) matching scores are never visible to the candidate or any role outside §2.2.

**FR-4.3.3 — Feedback learning.** Recruiter actions on the ranked list (shortlist, skip, contact) shall be captured as structured feedback to retrain ranking, with per-opportunity precision reporting. **Priority: Should.** *Acceptance criteria:* (1) feedback captured without extra clicks; (2) ranking-model versions logged per suggestion for auditability; (3) drift monitoring alerts when score distributions shift materially.

### 4.4 AI initial screening (FR-4.4.x): knockout-criteria engine (work authorization, must-have skills) + AI screening assistant (chat/voice pre-qualification, opt-in with guaranteed human path); screening summary + recommendation to recruiter; human decision required to advance or reject; candidate disclosure that AI is used

Screening is where evidence and risk are both strongest. A 70,000-applicant field experiment found AI voice-agent interviews produced 12% more job offers and 18% more job starts, with 78% of applicants choosing the AI interviewer when offered the choice — yet 5% refused to speak to an AI, and roughly a third of candidates drop out of hiring processes over AI-led interviews. The design resolves the tension with a simple rule: AI screening is always opt-in, and a human path is always one click away.

**FR-4.4.1 — Knockout-criteria engine.** Each opportunity shall support explicit, human-configured knockout criteria (work authorization for France/EU, must-have certifications, minimum availability date) evaluated deterministically — not by the LLM — with the failing criterion shown to the human reviewer. **Priority: Must.** *Acceptance criteria:* (1) criteria are versioned per opportunity and reviewed by HR before publication; (2) no knockout criterion may encode a protected attribute; (3) knockout outcomes are recommendations to the recruiter, whose logged decision finalizes the disposition.

**FR-4.4.2 — AI screening assistant (chat/voice, opt-in).** Candidates may choose an AI-led pre-qualification conversation (chat or voice — commercial agents already conduct thousands of such interviews daily, with 48% occurring after business hours, a genuine candidate-convenience benefit) covering availability, salary expectations, mobility and must-have skills; candidates may instead book a human phone screen at any point, with no penalty in ranking. **Priority: Should.** *Acceptance criteria:* (1) explicit opt-in with plain-language AI-use disclosure before the conversation, per AI Act candidate-notice duties; (2) human-path request routes to a recruiter within 1 business day; (3) no emotion recognition, sentiment scoring of voice, or biometric inference — prohibited practices under the AI Act since February 2025; (4) transcript retained and visible to the candidate on request.

**FR-4.4.3 — Screening summary and recommendation.** The assistant shall produce a structured screening summary — knockout status, stated expectations vs. opportunity corridor, flagged inconsistencies, suggested questions for the HR interview — with an advisory recommendation to the recruiter. **Priority: Must (summary); Should (recommendation).** *Acceptance criteria:* (1) every claim in the summary links to the transcript or parsed field evidencing it; (2) the recommendation is labeled advisory; (3) the recruiter's advance/reject decision with rationale is the system of record; (4) summary + decision retained ≥6 months in the immutable log.

---

## 5. Functional Requirements — Interviews to Hiring

Interviews generate the structured evidence that powers rediscovery, defensible decisions and quality-of-hire analytics — scorecard-tagged notes enable precise AI matching where free text produces fuzzy matching. This section specifies the interview-to-contract chain: scheduling automation (the sharpest automation win, consuming ~35% of recruiter time), consent-based interview intelligence, human-final decision and offer workflows, and lossless conversion to the employment record.

### 5.1 Interview management (FR-5.1.x): scheduling automation, structured scorecards per stage, panel assignment

**FR-5.1.1 — Scheduling automation.** The system shall read interviewer calendars (Google/Microsoft 365), propose slots to candidates by e-mail/SMS, book, remind, and reschedule without recruiter intervention — the market reference for conversational scheduling is first-contact-to-confirmed-slot in under 15 minutes. **Priority: Must.** *Acceptance criteria:* (1) zero recruiter actions in the happy path; (2) panels resolve availability across up to 5 interviewers; (3) no-shows flagged within 15 minutes with one-click re-proposal; (4) candidate-facing messages carry the AI-use disclosure where an agent converses.

**FR-5.1.2 — Structured scorecards per stage.** Each interview stage shall use a configurable, versioned scorecard (competencies, rating scale, mandatory written evidence per rating) assigned by opportunity or role family. **Priority: Must.** *Acceptance criteria:* (1) feedback cannot be submitted without a rating and evidence per competency; (2) scorecards stored as competency-tagged records consumable by the matching engine (FR-4.3.3) and rediscovery gate (FR-4.2.3); (3) template changes versioned, never retroactive.

**FR-5.1.3 — Panel assignment.** The recruiter or Hiring Manager shall assign panels per stage, granting time-boxed Interviewer access (§2.2) scoped to the assigned candidates. **Priority: Must.** *Acceptance criteria:* (1) access activates at assignment and closes at decision; (2) panel composition logged; (3) interviewers see only their stage's scorecard plus prior-stage summaries, per visibility rules.

### 5.2 Interview intelligence (FR-5.2.x): consent-based transcription, AI rubric-scored summaries with evidence links, visible to panel + HR only

**FR-5.2.1 — Consent-based recording and transcription.** With candidate notice and explicit consent captured before recording, the system shall record and transcribe video/phone interviews. **Priority: Should.** *Acceptance criteria:* (1) no recording without logged consent; declining consent creates zero penalty and falls back to manual note-taking; (2) transcript visible to the interviewing panel + HR only, per §2.2; (3) no emotion recognition or biometric inference at any point in the pipeline.

**FR-5.2.2 — AI rubric-scored summaries with evidence links.** The system shall generate an AI summary mapped to scorecard questions and pre-fill draft scores, each linked to the transcript passage evidencing it; the interviewer reviews, edits and owns the final scores. Vendor benchmarks indicate AI notetaking compresses interview feedback loops from days to 10–20 minutes (vendor-reported); the design target is feedback within 24 hours. **Priority: Should.** *Acceptance criteria:* (1) every AI-suggested score displays its supporting excerpt; (2) the interviewer's submission — not the AI draft — is the system of record, the draft retained for audit; (3) AI drafts are never shown to the candidate and never feed automated disposition.

### 5.3 Decision & offer (FR-5.3.x): feedback consolidation, decision workflow (human final), offer generation with compensation approval chain (HR + Direction), e-signature

**FR-5.3.1 — Feedback consolidation.** On completion of all interviews at a stage, the system shall consolidate scorecards into one decision view: per-competency score spread, divergences highlighted, AI synthesis of strengths and risks linked to evidence. **Priority: Must.** *Acceptance criteria:* (1) divergence >2 points on any competency triggers a flagged reconciliation item; (2) view available within 5 minutes of the last submission; (3) synthesis labeled advisory.

**FR-5.3.2 — Human final decision workflow.** Advance, reject and offer decisions shall be executable only by an identified human with the appropriate role, confirming a rationale. **Priority: Must.** *Acceptance criteria:* (1) no system path advances, rejects or hires without a logged human decision; (2) decision logs (who, on what information, when) retained ≥6 months and exportable; (3) candidates can request human review of any AI-assisted step via the portal; (4) override monitoring flags reviewers who accept AI recommendations ~100% of the time as probable rubber-stamping.

**FR-5.3.3 — Offer generation with compensation approval chain.** The system shall generate offers from configurable templates (compensation, contract type — CDI/CDD, start date, BU/manager) and, before issuance, compute unit economics: salary-to-CJM conversion, target TJM, and forecast gross margin per day against the healthy corridor of 25–40% of TJM; offers route HR → Direction for approval, with above-corridor or sub-threshold-margin offers requiring CFO sign-off. **Priority: Must.** *Acceptance criteria:* (1) CJM, target TJM and forecast margin displayed before send; (2) sur profil offers additionally blocked until the §3.3 justification gate passes; (3) offer versions retained with full audit trail; (4) generation in ≤2 clicks from an approved decision.

**FR-5.3.4 — E-signature.** Offers and contracts shall route for legally valid electronic signature without leaving the platform (pay-per-use e-signature is the category norm), with status tracking and reminders. **Priority: Must.** *Acceptance criteria:* (1) status (sent/viewed/signed/expired) visible on the pipeline card; (2) countersigned documents auto-archive to the employee record; (3) default reminder at 48 hours.

### 5.4 Hiring & contract (FR-5.4.x): candidate→employee record conversion preserving full history, document collection, contract generation, probation tracking

**FR-5.4.1 — Candidate→employee conversion preserving full history.** Upon signed acceptance, the system shall convert the candidate record into an employee record in one action — the parity benchmark converts a hired candidate in-app from "Candidat" to "Ressource" with attachments carried over — preserving CV, parsed profile, interview history, scorecards, offer terms and source channel, with a permanent cross-reference. **Priority: Must.** *Acceptance criteria:* (1) zero data re-entry; (2) time-to-fill, source channel and interview scores remain queryable from the employee record for quality-of-hire analytics; (3) conversion emits the event that triggers pre-boarding (stage 12) and updates pipeline analytics in the same transaction.

**FR-5.4.2 — Document collection via portal.** The system shall drive a configurable pre-boarding checklist (identity documents, diplomas, work permits, banking and social-security details) through the candidate portal with HR-side validation status. **Priority: Must.** *Acceptance criteria:* (1) per-hire completeness dashboard with automated reminders; (2) document access restricted per §2.2 (HR only for identity documents); (3) payroll-preparation export generated at completeness.

**FR-5.4.3 — Contract generation and lifecycle.** Contracts and amendments shall be generated from customizable templates (CDI, CDD), with merge fields drawn exclusively from the canonical record, version management, and alerts on CDD end dates at J-60 and J-30. **Priority: Must.** *Acceptance criteria:* (1) no free-text salary fields outside the approved offer; (2) immutable version history; (3) countersigned contract auto-archived.

**FR-5.4.4 — Probation (période d'essai) tracking.** The system shall track probation periods and renewal milestones per contract type, scheduling manager check-ins and a review workflow before expiry. **Priority: Must.** *Acceptance criteria:* (1) alerts at configurable offsets before probation end and renewal deadlines; (2) the confirm/renew/terminate decision logged with manager rationale; (3) outcomes feed quality-of-hire analytics by source channel, opportunity and interviewer — closing the loop that turns top-of-funnel requirements into a learning system rather than a conveyor belt.

**Sections 4–5 KPI hook.** The top-of-funnel and hiring chain shall report, at minimum: time-to-fill per opportunity and per stage against the ~45-day directional median; internal-rediscovery hit rate; stage-SLA attainment; funnel conversion per stage; offer-acceptance rate; and probation success rate. These metrics are the acceptance test for the module's core thesis — that compressing administrative slack, not human deliberation, is where recruitment speed is won.

---

## 6. Functional Requirements — Onboarding, Employment & Offboarding

Hiring is the most expensive way to acquire a skill, and its ROI is realized or destroyed after the offer is signed. Poor onboarding correlates directly with early turnover; one documented ESN case cut junior turnover from 35% to 20% in six months through systematic buddy sponsorship, 6-month objectives, certifying skills paths, and mandatory annual career interviews. With median consultant turnover at ~15–18% annually and attrition among consultants under three years of experience at 25%, the employment-side workflow is margin protection, not administrative overhead. Offboarding deserves equal rigor: a badly managed exit loses knowledge, endangers the client account, and burns a statistically rehirable alumnus. ESN-specific offboarding literature being thin, §6.3 applies general French HR practice. Requirement numbering continues from sections 4–5 (FR-4.x, FR-5.x).

### 6.1 Pre-boarding & onboarding (FR-6.1.x)

The design goal is day-1 readiness and first-90-days retention. The critical window is the first weeks on mission, when mission reality is compared against what was presented during recruitment; mismatches must be recalibrated fast, and projection toward follow-on missions should begin within the first month.

- **FR-6.1.1 — Pre-boarding portal.** On offer acceptance (handoff from FR-5.x), the system shall open a candidate-facing portal collecting administrative documents (identity, bank details, diplomas, work permits) and generating IT access requests (accounts, equipment, tool provisioning) with a completion checklist. **Priority: Must.** *Acceptance criteria:* (1) portal opens automatically at contract signature; (2) day-1 readiness (% of hires with accounts and equipment ready) is reportable per BU; (3) collected data flows into the employee record at conversion with zero re-entry.
- **FR-6.1.2 — Onboarding plan templates.** The system shall instantiate a configurable onboarding task plan at conversion, templates varying by contract type, seniority, and hiring mode (*sur mission* vs. *sur profil*), with tasks assigned across HR, manager, IT, and parrain. **Priority: Must.** *Acceptance criteria:* (1) instantiation takes under one minute; (2) templates are versioned; (3) tasks overdue by >3 days escalate to the assignee's manager.
- **FR-6.1.3 — Parrainage (buddy/mentor) assignment.** Every new consultant shall be assigned a parrain before day 7, drawn from a volunteer pool with a workload cap (default: two concurrent filleuls). **Priority: Must.** *Acceptance criteria:* (1) a hire reaching day 7 without a parrain alerts HR and the BU director, and exceptions require a logged manager rationale; (2) parrainage coverage is reportable as a retention-leading indicator.
- **FR-6.1.4 — Six-month objectives.** The system shall structure a co-editable, versioned objectives record agreed between consultant and manager within the first month, formally reviewed at month 6. **Priority: Must.** *Acceptance criteria:* (1) objectives cover at least delivery, skills/certification, and integration, with measurable targets; (2) month-6 review completion feeds retention analytics; (3) objectives never reviewed are flagged to HR at month 7.
- **FR-6.1.5 — First-weeks expectation recalibration on mission.** For consultants staffed on mission, the system shall trigger structured check-ins at weeks 1, 2, and 4 capturing (a) alignment of mission reality vs. what was presented during recruitment, (b) integration blockers, (c) a first projection of follow-on opportunities. **Priority: Must.** *Acceptance criteria:* (1) a reported gap opens a recalibration workflow assigned to the manager within 48 hours; (2) responses are stored as structured data analyzable by recruiter, Business Manager, and client account — closing the loop on over-selling at sourcing; (3) gaps unresolved at week 4 escalate to the staffing manager.

### 6.2 Employment lifecycle (FR-6.2.x)

Probation, the annual review, skills growth, and next-mission projection are the four levers that convert a hire into a retained, appreciating asset; each is instrumented because what is not tracked does not happen.

- **FR-6.2.1 — Probation tracking with alerts.** The system shall track each probation period (*période d'essai*) with its contractual duration and renewal rules, scheduling mid-point and end-of-probation reviews and alerting manager and HR at J-30 and J-15 before expiry. **Priority: Must.** *Acceptance criteria:* (1) no probation expires without a logged confirm / renew / terminate decision with documented human rationale — AI summaries of check-ins may assist but never decide (§7.3, §8.1); (2) early failures are analyzable back to source channel and screening stage, feeding the hiring-quality loop.
- **FR-6.2.2 — Annual reviews (entretiens annuels) with 360° feedback.** The system shall schedule and track annual reviews with co-filled forms covering training needs, priority development actions, and follow-up indicators, enrichable with 360° feedback from clients, managers, and peers including delivery-quality criteria. **Priority: Must.** *Acceptance criteria:* (1) reviews not held within a configurable period (default 330 days) appear on HR and BU overdue dashboards; (2) 360° requests are sendable to external client contacts with tracked status and visibility rules (default manager + HR); (3) AI synthesis consolidates feedback themes with each claim linked to its source response; (4) completed forms are archived with dual-signature confirmation.
- **FR-6.2.3 — Certifications and skills progression feeding the skills ontology.** The system shall track certifications (cloud, cybersecurity, SAFe, ITIL) with expiry dates and sponsored-certification workflows, writing every earned certification to the matchable skills profile and the company skills ontology. **Priority: Must.** *Acceptance criteria:* (1) a certification earned updates the matchable profile within 24 hours, immediately improving staffing and rediscovery; (2) expiry alerts fire at J-90; (3) internal promotion rate, certifications per consultant, and billing-rate progression are reportable KPIs.
- **FR-6.2.4 — Career pathing and next-mission projection.** From month 4 of employment, the system shall maintain a forward projection per consultant: probable mission-end date, candidate follow-on opportunities from the commercial pipeline, and skill gaps to close. **Priority: Should.** *Acceptance criteria:* (1) visible to consultant, manager, and staffing manager; (2) consultants can express mission and mobility preferences, stored as first-class matching constraints — ignoring aspirations is a documented turnover driver; (3) the projection feeds the staffing module's J-90/J-60/J-30 roll-off anticipation chain, so career management and bench prevention operate on the same data.

### 6.3 Offboarding (FR-6.3.x)

Departures are predictable, date-bound events and should run as a managed workflow, not an email thread. Established priorities: interview the leaver to understand motives (and optionally counter-offer), announce nothing before the exit date is fixed, keep the consultant engaged through the préavis (notice period), and formalize knowledge transfer. An ESN adds a fifth: the leaver sits inside client relationships, and handover quality protects the account.

- **FR-6.3.1 — Resignation / termination workflow.** The system shall provide a separation workflow per type (resignation, rupture conventionnelle — mutually agreed termination, dismissal, end of probation), generating the corresponding checklist, approval chain, and sequenced notifications — internal announcement blocked until the exit date is fixed. **Priority: Must.** *Acceptance criteria:* (1) each type instantiates its appropriate checklist; (2) notification sequencing is enforced by the workflow, not by convention; (3) all steps are timestamped in the audit log.
- **FR-6.3.2 — Préavis management.** The system shall compute and track the notice period from contract type, seniority, and collective agreement (Syntec: typically up to three months for cadre status — configurable), manage reductions or waivers by mutual agreement, and maintain an engagement plan through the préavis to avoid the productivity collapse of a disengaged leaver. **Priority: Must.** *Acceptance criteria:* (1) exit date, remaining préavis days, and waiver status visible to HR, manager, and staffing; (2) for staffed consultants, a client-notification plan is mandatory.
- **FR-6.3.3 — Knowledge transfer & mission handover plan.** For every departing consultant on mission, the system shall require a structured handover plan: documentation, successor identification, client-side introduction of the successor, and access/credential transfer. **Priority: Must.** *Acceptance criteria:* (1) the plan is a completion gate — the offboarding checklist cannot close with handover items open without HR override; (2) where no successor exists, a replacement opportunity can be opened from the offboarding record, inheriting the mission's skill profile.
- **FR-6.3.4 — Exit interview with AI thematic analysis.** The system shall structure exit interviews (motives, management, mission, compensation, tools) and run AI thematic analysis over the aggregate, anonymized corpus. **Priority: Should.** *Acceptance criteria:* (1) themes are computed only over cohorts of k ≥ 5 leavers — no individual attribution, no per-person sentiment scoring; (2) theme reports feed a quarterly retention review; (3) raw interviews stay access-restricted to HR, and the analysis layer never surfaces quotes attributable to an identified individual (§8.2).
- **FR-6.3.5 — Alumni record conversion & rehire flag.** At exit, the employee record shall convert to an alumni record preserving the skills snapshot, mission history, and a rehire-eligibility flag with rationale. **Priority: Should.** *Acceptance criteria:* (1) alumni records remain searchable in the talent graph subject to GDPR retention rules — retention beyond legal archiving requires the alumnus's consent, renewed per §8.2; (2) a rehire-flagged alumnus matching a new opportunity surfaces in talent-pool rediscovery like any internal profile.
- **FR-6.3.6 — Legal document generation.** The system shall auto-generate the mandatory end-of-contract documents — certificat de travail, solde de tout compte receipt, and the attestation employeur for France Travail — from record data, with tracked delivery and signed-receipt capture. **Priority: Must.** *Acceptance criteria:* (1) documents generate from templates without re-keying; (2) documents missing at last working day + 5 are flagged to HR; (3) templates are versioned under HR/legal ownership.

---

## 7. AI Capability Catalog (module deep-dive)

This section deep-dives the AI capabilities specific to the HR pipeline, inheriting the platform AI layer's architecture (four planes, BEAM behavior boundaries, EU-resident inference) without restating it. Every candidate- or consultant-facing capability here is high-risk under Annex III.4 of the EU AI Act, so one rule governs all three families — **the AI ranks, explains, and drafts; it never decides**.

### 7.1 Matching & screening AI

Matching quality is a measurable engineering target and the module's largest legal exposure: *Mobley v. Workday* established that an AI vendor can be liable as an "agent" of employers, with a nationwide age-discrimination collective certified in May 2025, and academic audits found LLM resume screeners favoring white-associated names 85% of the time. Every capability below ships with a quantitative gate and a named owner.

| Capability | Metric | Threshold | Cadence |
|---|---|---|---|
| CV parsing — standard fields (identity, dates, education) | Field-level accuracy, 500-CV anonymized FR/EN golden corpus | ≥ 95% | Model change + weekly |
| CV parsing — skills / tech-stack extraction | Extraction accuracy on the golden corpus | ≥ 90% | Model change + weekly |
| Candidate-to-opportunity ranking | nDCG@10 on a 200-query recruiter-adjudicated golden set | ≥ 0.75 | Release gate + weekly |
| Screening shortlist vs. recruiter ground truth | Precision / recall on held-out adjudicated cases | ≥ 92% / ≥ 88% | Release gate + monthly production sample |
| Score explainability | Scores decomposable into weighted, inspectable factors with rationale | 100% (hard requirement) | Continuous (structural test) |
| Fairness | Documented bias audit vs. protected criteria; subgroup reporting | No unexplained subgroup degradation | Quarterly + pre-release |

Three commitments follow. First, explainability is structural: every score decomposes into weighted factors (hard skills with adjacency inference, experience, availability, mobility, mission history), each with a human-readable rationale — opaque skill inference is a known weakness of enterprise talent-intelligence tools and untenable under Art. 86 (§8.1). Second, the golden set is a hard gate: 50–100 adjudicated cases at launch, grown toward 200–500 from production traffic, run weekly and on every model change, with deployment blocked on degradation. Third, special-category data is processed only inside a safeguarded bias-detection sandbox (Art. 10(5)), never as a scoring input. The economics are proven — French ESN vendors report matching cutting per-mission search time from 2–4 hours to 10–20 minutes (vendor-reported) — but only if the precision/recall gate keeps recruiters from re-doing the machine's work.

### 7.2 Conversational AI

The module ships two assistants with different risk postures. The **onboarding assistant** is new-hire-facing and internal: it answers practical questions (tools, processes, contacts, benefits) grounded on company documentation — limited-risk because it makes no decisions about people. The **screening assistant** conducts structured first-round qualification conversations and is the catalog's most guarded capability. The evidence justifies both the capability and the guardrails: a 70,000-applicant field experiment found AI voice interviews produced 12% more offers, 18% more starts, and 16–18% higher early retention, with 78% of applicants choosing the AI interviewer when offered the choice — but 5% refused to speak to an AI, and the high-volume frontline context may not transfer to senior IT consultants. The counterweight: roughly a third of candidates drop out of AI-led processes, and 71% of Americans oppose AI final hiring decisions.

| Behavior | Screening assistant | Onboarding assistant |
|---|---|---|
| **Always (autonomous, logged)** | Disclose AI identity and purpose at first contact; offer the human path at every step; ask only rubric-mapped questions; log the full transcript | Answer from the curated knowledge base; cite the source document; log questions for content-gap analysis |
| **Ask first (human confirms)** | Propose advancing a candidate to human interview (recruiter decides); any deviation from the approved rubric | Answer policy-sensitive questions (compensation, contract terms) from a human-approved answer set only |
| **Never (hard stop)** | Score or reject a candidate autonomously; ask about protected traits; infer emotion or sentiment from voice or text; present itself as human | Give legal or contractual advice; access other employees' data; answer outside the curated corpus without escalating to HR |

The **human-path guarantee** is architectural: a human screening route is permanently available at equal priority — never a degraded or slower track — and its usage is a monitored health metric, with ≥10% sustained usage treated as evidence the path is genuinely open (§9.2). Candidate disclosure happens at first contact: the candidate is told they are interacting with a high-risk AI system, what it evaluates, and that a human reviews every advancement decision (Art. 26 candidate-notice duty). Delivery implication: the screening assistant ships only at V3, after logging, audit, and bias monitoring have been proven in production on internal-facing capabilities (§10.1) — candidate-facing autonomy without proven guardrails is the catalog's largest reputational risk.

### 7.3 Generative & predictive AI

Four capabilities ship under one rule: **assistive only — no automated employment decisions.**

1. **Interview summaries.** Structured summaries mapped to scorecard rubrics, ≥95% of facts verifiable against the transcript, every claim source-linked; the interviewer reviews, edits, and submits — no auto-submission. Time savings are the best-documented in the catalog: 89% of AI-enabled recruiters cite time saved as the main benefit, with feedback loops cut from days to 10–20 minutes in a named benchmark.
2. **Offer and contract drafting.** Drafts assembled from a versioned clause library owned by HR/legal; a named human approves every outgoing document. An offer-acceptance probability signal (V2), in the spirit of shipped offer-forecast features, may advise timing and package calibration.
3. **Exit-interview theme analysis.** Aggregate, anonymized analysis over cohorts of k ≥ 5 (FR-6.3.4): recurring motives and systemic friction feeding the quarterly retention review; no individual-level inference exposed.
4. **Early-attrition risk signals.** A consultant-level advisory indicator built from structured, work-related signals only — onboarding check-in gaps (FR-6.1.5), overdue reviews, prolonged bench, overtime patterns — consistent with the leading academic attrition drivers (job satisfaction, overtime, pay). It never triggers or recommends termination; trait-based allocation or termination support is precisely the Annex III 4(b) territory the policy engine hard-blocks. Accuracy claims here are vendor-origin (IBM's reported 95% accuracy, $300M saving), and academic models reaching ~99% on benchmark datasets perform materially worse in production — the capability is early-warning triage for human attention, not a prediction to act on.

### 7.4 Failure modes & guardrails

| Failure mode | Detection | UX recovery |
|---|---|---|
| Hallucinated interview summary | Faithfulness scoring on generation; human audit of ≥5% of summaries | Claims source-linked to transcript; one-click regenerate; low-faithfulness drafts flagged before review |
| Biased score drift | PSI ≥ 0.25 drift alert; quarterly bias audit vs. protected criteria | Autonomy freeze; named owner; affected shortlists re-reviewed by a human; redeploy blocked until audit passes |
| Parsing errors (messy formats, multilingual CVs) | Per-field confidence scores; weekly golden-corpus regression | Low-confidence fields highlighted for one-click human confirmation; corrections feed the golden corpus |
| AI-written CV inflation (arms race) | Fraud/integrity signals: timeline inconsistencies, generic-pattern text, CV-vs-interview inconsistency | Advisory flags for the human interviewer; structured live skill validation; **never** an automated penalty — false fraud accusations against honest candidates are the worse failure |
| Candidate refuses AI interaction | Explicit opt-out at disclosure point; per-step drop-off analytics | Immediate routing to the human path at equal priority; refusal never recorded as a negative signal |
| Assistant out-of-scope / low-confidence answer | Confidence threshold + curated-corpus boundary check | Graceful escalation to HR/recruiter with conversation attached; the assistant never improvises |

The unifying principle: detection routes to a human, not to automated countermeasures. The AI-generated-applications arms race makes this concrete — over 90% of job seekers used AI tools in applications by Q2 2025, and 90% of employers report increased spammy AI applications. AI-detection of AI-written CVs is an arms race the module deliberately does not join as an automated filter: detector false positives penalize honest candidates and the detectable signal degrades monthly. The defensible responses are structured interview evidence, live skill demonstrations ("authenticity trials"), and consistency checks between document claims and interview performance. Guardrail quality, not parsing accuracy, is the durable differentiator.

---

## 8. Compliance Mapping (module-scoped)

This section maps the regulatory regime onto module features; the platform-level compliance architecture (governance plane, EU-resident inference, tamper-evident audit log) is inherited, not restated. The module carries the platform's highest exposure: it contains both high-risk families — Annex III 4(a) recruitment systems and 4(b) employment-relationship systems — and enforcement is pointed directly at it, the CNIL having made recruitment a 2026 priority control theme (AI CV triage, candidate information, retention) in preparation for its future AI Act market-surveillance role for the "work" domain.

### 8.1 EU AI Act: high-risk obligations applied to this module

The original 2 August 2026 date for Annex III obligations has reportedly been deferred to 2 December 2027 for stand-alone systems by the Digital Omnibus (Regulation (EU) 2026/1744) — consistently reported across 2026 sources, to be verified against EUR-Lex. The build plan treats the date as irrelevant: Art. 5 prohibitions and the penalty framework (up to €35M/7% for prohibited practices, €15M/3% for high-risk breaches) are already in force, and GDPR Art. 22 is fully enforceable today. Full conformity is a GA requirement.

| Obligation | Module implementation |
|---|---|
| Art. 14 — Human oversight: rank + explain, never decide | No auto-rejection or auto-advancement; reviewer sees full dossier plus factor-level rationale; one-click override with logged reason; no friction against overriding |
| Art. 26(2) — Oversight assignment | Named, trained oversight owners per capability; rubber-stamping detector (sustained ≈0% override rate triggers review, §9.2) — nominal review without real discretion does not qualify |
| Arts. 12/19/26(6) — Record-keeping | Immutable decision logs: every AI input/output, score, recommendation, human action, override, model version, timestamp; ≥6-month deployer retention, 10-year provider documentation |
| Art. 86 — Right to explanation | Per-decision explanation record (plain-language main factors) reconstructable months later on request — the trigger is subjective, so every AI-influenced decision must be individually retrievable |
| Art. 26(7)/(11) — Notification | Candidate notice when high-risk AI assists decisions about them; workers'-representative and affected-worker notice before workplace deployment, with French CSE consultation layered on top |
| Art. 10 — Data governance & bias | Quarterly documented bias audits; special-category processing confined to a safeguarded bias-detection sandbox; subgroup performance in the instructions for use (§7.1) |
| Art. 73 — Serious-incident reporting | Incident-detection workflow with the 15/10/2-day reporting clocks wired to the compliance owner |

Two Article 5 prohibitions are excluded by design — hard product constraints with no compliance pathway, enforced in the policy engine rather than in prompts: **no emotion recognition** on candidates or workers (including video-interview expression analysis, voice-stress detection, and sentiment inference; Commission guidelines treat job candidates as "workers"), and **no biometric categorisation or protected-trait inference**, including inferred proxies for health, origin, beliefs, or orientation. These exclusions bind the roadmap: no future version of the screening assistant, interview intelligence, or attrition signaling may cross them. Because we build and deploy for our own account, provider and deployer duties coincide — and the audit log becomes the module's highest-leverage compliance investment, simultaneously satisfying record-keeping, the six-month retention duty, and Art. 86 reconstructability, "a logging and retention requirement disguised as a transparency right".

### 8.2 GDPR & CNIL

Four rules govern personal data in this module, operationalized as features rather than policy. **DPIA first:** AI candidate screening is systematic, extensive automated evaluation under Art. 35(3)(a), and CNIL's mandatory-DPIA list explicitly covers selection algorithms — the DPIA, including the discriminatory-bias assessment CNIL expects, is maintained pre-filled from the AI register and exportable as evidence. **Human review is the core design rule:** under Art. 22 and CJEU *SCHUFA* (C-634/21), a score playing a determining role is itself an automated decision and rubber-stamp review does not break automation — every adverse decision loop contains an empowered human, and Art. 22(3) safeguards (human intervention, expression of viewpoint, contestation) are wired into the candidate portal. **Lawful basis is legitimate interest** (Art. 6(1)(f)) with a documented balancing test, consent being rarely freely given in recruitment; explicit consent is reserved for talent-pool (vivier) retention, where refusal carries no detriment. **Retention is automated**, executed with purge certificates:

| Data category | Retention rule | Automation |
|---|---|---|
| Non-retained candidates | Active base purged 2 years after last contact | Auto-purge with certificate; countdown on record |
| Sourced profiles without application/consent (e.g., LinkedIn) | 30 days maximum without consent | Auto-deletion at day 30 unless consent captured |
| Talent pool (vivier) with consent | Consent renewed every 2 years | Renewal workflow at month 22; lapse triggers purge |
| Litigation-evidence archive | 5 years restricted-access archiving (Code du travail Art. L.1134-5) | Separate store, HR-legal access only, then destruction |
| Alumni records (FR-6.3.5) | Legal archive rules, then consent-based retention | Consent capture at exit; same renewal cycle as vivier |

DSR workflows live in the candidate portal: access, rectification, erasure, portability, human re-review, expression of viewpoint, and contestation, with the CNIL complaint channel surfaced — opacity about AI scoring is among candidates' most consistent complaints and a cheap differentiator to fix. Two French specifics complete the picture: CSE information/consultation before deploying AI affecting working conditions, Art. 26(7) being a floor rather than a ceiling; and EU-resident inference with no fallback to non-EU LLM endpoints — sending CVs to a US-hosted LLM API without SCCs and a transfer impact assessment is a Chapter V violation, and with CNIL fines reaching €487M in 2025, residency is enforced at the gateway, not in a policy.

---

## 9. KPIs & Success Metrics

The module is measured on two planes that must move together: funnel economics and AI health. Funnel KPIs tell whether the pipeline converts faster and better; AI health KPIs catch the two failure modes funnel KPIs cannot see — disuse and rubber-stamping. Our own baseline is measured at rollout (M+0), with target reviews at M+6 and M+12.

### 9.1 Funnel KPIs

| Metric | Baseline (sector reference) | Target (M+12) | Alert threshold |
|---|---|---|---|
| Time-to-fill (consultant role) | ~45 days median (single-vendor study, directional) | −20% vs. M+0 baseline | > 60 days |
| Stage-SLA attainment (présélection ~2d, RH ~5d, technical ~7d) | Sector stage-delay template | ≥ 90% of candidates inside stage SLA | Any stage median > 2× SLA |
| Screening quality vs. recruiter ground truth | n/a (new capability) | ≥ 92% precision / ≥ 88% recall | Below golden-set gate (§7.1) |
| Offer acceptance rate | M+0 baseline | ≥ 85% | < 75% |
| Early attrition (< 6 months) | Junior turnover 35% in documented case; <3-year consultant attrition 25% sector-wide | ≤ 15% | > 20% |
| 12-month new-hire retention | Sector turnover ~15–18% | ≥ 85% | < 80% |
| Candidate NPS | M+0 baseline | ≥ +30 | < +10 |
| Recruiter hours saved per hire | Scheduling ~35% of recruiter time; ~20% of the work week saved with generative AI | ≥ 4 h/hire, triangulated self-report + cycle-time deltas | Gains not visible in cycle time |

These KPIs form a causal chain that matters more than any single link. Faster stage handling only pays if screening quality holds — a pipeline that accelerates by lowering the bar resurfaces as probation failure and early attrition, the costliest outcome in the table because it compounds re-hiring cost, vacancy cost, and staffing disruption. Early attrition and 12-month retention therefore carry the heaviest weight at the M+12 review: they prove the funnel selected for durability, not just speed, and they validate the §6.1 onboarding investment — the documented case behind our targets cut junior turnover by 15 points precisely through parrainage, 6-month objectives, and mandatory career interviews. The hours-saved KPI is triangulated because 89% of AI-enabled recruiters report time saved but perceived productivity diverges from measured productivity. Baselines marked directional are replaced with measured M+0 values at first review.

### 9.2 AI health KPIs

| Metric | Target | Rationale |
|---|---|---|
| Suggestion acceptance rate | ~30% | Calibrated trust, not maximum acceptance; >40% can correlate with insufficient review |
| Edit rate on accepted drafts | 30–60% | Evidence of genuine human review of AI output |
| Gate override / rejection rate | Monitored; sustained ≈ 0% triggers rubber-stamping alert | Near-zero override means gates are clicked through — unexercised oversight fails Art. 26(2) |
| Drift (input/output distributions) | PSI ≥ 0.25 alert with named owner | Catches CV-format shifts, provider model drift, and score creep before users notice |
| Bias audit | Quarterly pass, documented | Art. 10 obligation and litigation posture (§7.1, §8.1) |
| Human-path usage (candidate-facing AI, V3) | ≥ 10% sustained | Proves the human alternative is genuinely open, not a degraded track |
| Candidate drop-out on AI-led flows (V3) | < 15% vs. ~⅓ market baseline | Phase-gate for keeping candidate-facing AI on |
| Cost per screened candidate | ≤ €0.05 per operation; alert at 80% daily budget | Protects unit economics as volume scales |

The set must be read as a system: acceptance, edit, and override rates together describe whether human oversight is real. The rubber-stamping alert is the most consequential metric because it converts a legal obligation into an operational tripwire — the AI Act requires a person able to understand and act on AI output rather than rubber-stamp it, and a sustained zero-override dashboard evidences exactly that failure, actionable before an auditor finds it. Human-path usage and AI-flow drop-out are the candidate-experience counterparts, ensuring the V3 screening assistant is chosen for convenience rather than endured as a gate. Cost per screened candidate is tracked per feature so a runaway agent loop triggers an alert before it reaches the finance report — rising cost is a leading cause of agentic-AI project cancellations, so unit economics are a launch criterion, not an optimization.

---

## 10. Roadmap & Integration Points

### 10.1 Module roadmap

Sequencing follows one governing logic: ship the safest-ROI AI first, build the compliance spine before it is legally forced, and defer candidate-facing autonomy until the audit infrastructure exists to contain it.

| Phase | Window | Scope | AI depth | Exit criteria |
|---|---|---|---|---|
| **MVP** | 0–9 months | Pipeline core (stages, intake, interview management); pre-boarding portal, onboarding plans, parrainage, probation tracking; compliance spine (immutable logs, explainability, candidate disclosure, retention engine) | Assistive: parsing, explainable matching, interview intelligence | Zero auto-rejection possible by design; golden-set gate live; matching used on ≥50% of staffed opportunities; day-1 readiness KPI reportable |
| **V2** | 9–18 months | Full employment lifecycle: annual reviews with 360°, certifications, next-mission projection; offer/contract drafting; exit-interview thematic analysis; early-attrition advisory signals | Predictive (advisory): attrition triage, offer-acceptance signal | Quarterly bias-audit loop operating; attrition flags logged with outcome tracking; flag precision ≥ 60% on 6-month outcomes before any expansion |
| **V3** | 18+ months | Guarded candidate-facing agents: screening assistant with human-path guarantee; scheduling automation | Agentic, guarded: human final decision mandatory; human path always offered at equal priority | AI-flow drop-out <15%; human-path usage ≥10% sustained; Art. 86 explanation requests answerable from logs within 5 business days |

The exit criteria are decision-oriented: a phase completes when its risk posture is demonstrated, not when features are merged. Two implications follow. First, MVP scope must be defended against creep toward predictive work — attrition and acceptance forecasting before the data graph accumulates a year of lifecycle history would burn credibility on bad predictions, so V2 predictive features activate only against measured data-completeness thresholds. Second, the V3 gates are contractual: if drop-out or human-path criteria fail, candidate-facing agents stay off by default and are repositioned as optional per-team add-ons. The sequence is reversible throughout — every phase can run indefinitely at its current autonomy level without blocking other modules.

### 10.2 Integration points

| System | Direction | Integration |
|---|---|---|
| **Master talent graph** | Internal | Candidate ≡ Resource ≡ Consultant as one record across lifecycle states: offer acceptance converts candidate → resource with zero re-entry; exit converts employee → alumni (FR-6.3.5); every AI capability reads the same graph |
| **Staffing module** | Internal | The hired consultant enters the plan de charge at conversion; FR-6.2.4 preferences and projections become matching constraints feeding J-90/J-60/J-30 roll-off anticipation; FR-6.3.3 handover can open a replacement opportunity |
| **Qonto (finance)** | Boundary — none | This module creates no invoices, payments, or billing payloads; invoicing and cash belong to the Finance module's Qonto integration. The only touchpoint is indirect: hiring converts to billable capacity that Finance later invoices against |
| **LinkedIn / job boards** | Inbound | One-click profile import to the CVthèque; job-offer multiposting; sourced profiles enter the 30-day consent clock (§8.2) |
| **E-signature (Signaturit)** | Outbound | Offer letters, contracts, amendments, and end-of-contract documents signed in-flow with tracked status |
| **Payroll (Silae)** | Outbound | Silae-ready export of hiring data (contract type, start date, compensation elements, bank details from FR-6.1.1) and lifecycle events (probation confirmation, exit dates) — no payroll execution in this module |

The talent-graph identity (Candidate ≡ Resource ≡ Consultant) is the integration everything else depends on: it lets a match score computed at sourcing improve at certification (FR-6.2.3), an onboarding check-in signal inform attrition triage (§7.3), and an alumni record resurface in rediscovery — one record accumulating value instead of three systems reconciled by hand. The staffing handoff is the second structural integration: the moment a hire converts, staffing inherits a fully profiled consultant, and §6.2 career-projection data flows into bench prevention — recruitment and staffing become one pipeline rather than sequential departments. The Qonto boundary is stated explicitly to prevent scope bleed: this module's output is *employed capacity*, measured financially through the Finance module's invoicing chain. Finally, the Silae export is a launch dependency, not an afterthought: pre-boarding collects exactly the fields payroll needs, and re-keying them would reintroduce the fragmentation this platform exists to eliminate.

---

## Sources & Evidence Base

Sources are grouped by research theme and were gathered 2024–2026 during product research; they grounded this HR pipeline module PRD.

### BoondManager product analysis

- boondmanager.com — Discover Boond page + Maddyness (2025). https://www.boondmanager.com/en/about-boond
- boondmanager.com — Discover Boond page + Maddyness (2024-02-27). https://www.maddyness.com/2024/02/27/brest-lediteur-boondmanager-leve-32-millions-deuros-pour-accelerer-son-expansion/
- Capterra directory listing (2025). https://www.boondmanager.com/blog/boondmanager-leve-32meu-pour-accelerer-la-performance-des-esn-en-france-et-a-linternational
- Les Echos, Maddyness, Le Journal des Entreprises, Expedition Capital PR, Boond about page (2024-02-27). https://www.lesechos.fr/pme-regions/innovateurs/boondmanager-leve-32-millions-deuros-pour-accelerer-sur-le-secteur-des-erp-2078829
- Les Echos, Maddyness, Le Journal des Entreprises, Expedition Capital PR, Boond about page (2024-03-12). https://www.lejournaldesentreprises.com/article/lediteur-derp-boondmanager-leve-32-millions-deuros-pour-booster-son-expansion-2091338
- erpimplementation.eu comparative table — ERP Sociétés de Services 2026 (2026-04-17). https://www.erpimplementation.eu/erp-societes-services-psa-staffing-rentabilite-projet/
- rh-match.com ATS guide (2025-07-29). https://rh-match.com/ats-esn/
- softguide.com product profile (2026). https://www.softguide.com/program/boondmanager
- boondmanager.com/en/solutions/business (read directly) (2026). https://www.boondmanager.com/en/solutions/business
- boondmanager.com blog L'ERP métier : indispensable en ESN (2025-09-04). https://www.boondmanager.com/blog/erp-metier-est-il-indispensable-en-esn
- boondmanager.com blog ERP-métier article (2025-09-04). https://www.boondmanager.com/solutions/recrutement-et-rh
- boondmanager.com/solutions/recrutement-et-rh (2026). https://lebonlogiciel.com/organisation-facturation-et-planification-gestion-commerciale-erp-gpao/boondmanager/148
- Boond Help Center article (2026-02-23). https://help.boondmanager.com/fr/articles/373575-convertir-un-candidat-en-ressource
- lebonlogiciel.com (annual-review actions). https://www.boondmanager.com/evenements/boond-en-bref-3-5-tips-pour-faciliter-votre-onboarding-en-esn-en-moins-de-10-min
- boondmanager.com blog intercontrat-esn (2026-05-21). https://www.boondmanager.com/blog/intercontrat-esn
- boondmanager.com/en/pricing feature grid (2026). https://www.boondmanager.com/en/pricing
- boondmanager.com blog Facturation électronique : les dernières annonces de la DGFIP (2026-07-15). https://www.boondmanager.com/blog/facturation-electronique-les-dernieres-annonces-de-la-dgfip
- boondmanager.com/integrations (read directly) (2026). https://www.boondmanager.com/integrations
- softwareadvice.com integration list (2026-04-27). https://www.softwareadvice.com/erp/boondmanager-profile/
- softwarefinder.com FAQ (2026). https://www.profilforge.fr/blog/boondmanager-ia-automatisation-placement
- softwarefinder.com. https://softwarefinder.com/crm/boondmanager
- billi.so alternatives analysis quoting Capterra — Top 5 alternatives BoondManager 2026 (2026-05-30). https://billi.so/fr/blog/alternative-boondmanager-logiciel-esn
- boondmanager.com blog IA et recrutement… and Boond passe à la vitesse supérieure avec l'IA — Boond passe à la vitesse supérieure avec l'IA (2025-12-19). https://www.boondmanager.com/blog/boond-passe-a-la-vitesse-superieure-avec-lia
- karanext.com. https://www.karanext.com/blog/meilleur-erp-esn-comparatif
- Appvizer — BoondManager alternatives (atimeüs, Karanext). https://www.appvizer.fr/operations/erp/boondmanager
- culture-rh.com. https://culture-rh.com/solution-rh/boondmanager/
- selectsoftwarereviews.com. https://www.selectsoftwarereviews.com/buyer-guide/resume-parsing-software
- appvizer.fr. https://www.appvizer.fr/magazine/operations/erp/odoo-alternatives
- blogdumoderateur.com. https://www.blogdumoderateur.com/tools/boond/
- tool-advisor.fr — Avis Boond Manager 2026 (2026-04-24). https://tool-advisor.fr/logiciel-erp/boond-manager/
- mon-expert-digital.com. https://www.mon-expert-digital.com/blog/outils-et-logiciels/10-meilleurs-erp-pour-agence-web.html
- BoondManager blog — IA et recrutement (2026-06-15). https://www.boondmanager.com/blog/ia-et-recrutement-comment-boond-accelere-votre-recherche-pour-vos-besoins-clients
- BoondManager blog — Matching candidat IA (2026-05-21). https://www.boondmanager.com/blog/esn-maitriser-les-enjeux-du-matching-candidat-grace-a-lia
- boondmanager.com. https://www.boondmanager.com/en/testimonials/nextsourcia-boondmanager-is-the-clear-choice-in-terms-of-pricing-and-features
### AI in recruitment & staffing

- Saply.ai — 12 Best AI Resume Parsing Software Tools for Recruiters (2026-08-20). https://www.saply.ai/blog/ai-resume-parsing-software/
- Recruiterflow — AI Candidate Matching: A Complete Guide (2026-03-06). https://recruiterflow.com/blog/candidate-matching/
- Bullhorn — What is AI staffing agency software? Buyer's guide (2026-09-08). https://www.bullhorn.com/blog/ai-staffing-agency-software-buyers-guide/
- Greenhouse support documentation — Greenhouse AI features (2026-09-03). https://support.greenhouse.io/hc/en-us/articles/33043749845403-Greenhouse-AI-features
- Recruiterflow — AI Agents in Recruiterflow: every AIRA Agent (2026-08-17). https://recruiterflow.com/blog/ai-agents-in-recruiterflow-a-complete-guide-to-every-aira-agent/
- aiagentsquare — SeekOut Review 2026 (2026-07-04). https://aiagentsquare.com/agents/seekout
- Pin — Recruitment Trends 2026 (2026-01-21). https://pin-com.ghost.io/recruitment-trends-2026/
- Hirevire — Paradox.ai Review 2026 (2026-08-22). https://hirevire.com/blog/paradox-ai-reviews-pricing-and-alternatives
- Vantaige — Paradox AI (Olivia) (2026-05-10). https://vantaige.io/ai-tool/paradox-ai
- Recrew.ai — Agentic AI Is Changing Recruitment in 2026 (2026-08-10). https://www.recrew.ai/blog/future-of-ai-in-recruitment
- Alex — Best Lever ATS Integrations (2026-08-24). https://www.alex.com/blog/best-lever-ats-integrations
- Eightfold blog — How agentic AI is shaping the future of recruiting (2025-09-15). https://eightfold.ai/blog/li-agentic-ai-shaping-future-recruiting/
- Metaview — How AI recruiting tools save time (2026-05-28). https://www.metaview.ai/resources/blog/ai-powered-recruiting-key-strategies-for-talent-teams
- BestRecruitingTools 2026 buyer's guide (2026-04-15). https://bestrecruitingtools.com/blog/best-ai-recruiting-software-enterprise-2026
- Humanly blog (2026-08-25). https://www.humanly.io/blog/automate-recruiting-tasks
- aiwithmichal.com — Silver medalist candidates | AI glossary in practice (2026-06-13). https://aiwithmichal.com/ai-glossary-in-practice/silver-medalist-candidates
- Pin — 8 Best Talent Intelligence Platforms 2026 (2026-08-19). https://www.pin.com/blog/talent-intelligence-platforms/
- Skywork — AI vs Manual Skill Tagging (2026-06-08). https://skywork.ai/skypage/en/ai-manual-skill-tagging/2063941005583777792
- hrtechsaas — Workday AI vs Eightfold vs Gloat (2026-06-30). https://hrtechsaas.com/blog/workday-ai-vs-eightfold-vs-gloat/
- Techsy — AI Tools for HR 2026 (2026-02-20). https://techsy.io/en/blog/ai-tools-for-hr
- TheHRempire — Predictive analytics to reduce turnover (2025-09-04). https://thehrempire.com/blogs/how-to-use-predictive-analytics-to-reduce-employee-turnover/
- IJERT — Employee Attrition Prediction (2026-03-01). https://www.ijert.org/employee-attrition-prediction-ijertconv14is010080
- PMC — Integrating machine learning and explainable AI for employee attrition prediction (2025). https://pmc.ncbi.nlm.nih.gov/articles/PMC12905426/
- Recruiterflow — State of AI in Recruiting 2026 (2026-08-03). https://recruiterflow.com/blog/state-of-ai-in-recruiting/
- Svitla — Agentic AI Market Trends 2025-2026 (2026-07-21). https://svitla.com/blog/agentic-ai-market-trends-2026/
- Phenom — Best Agentic AI Platforms for HR (2026-08-12). https://www.phenom.com/blog/best-agentic-ai-platforms-hr
- OperatorAITools — Paradox review (2026-05-28). https://operatoraitools.com/ai-hr-recruiting/paradox-ai-olivia-review-2026-conversational-hiring-assistant-high-volume-hourly-qsr-retail-multi-location-hr-ops/
- Recruiterflow — AI Recruiting Assistant: What is it & How to Use? (2026-07-15). https://recruiterflow.com/blog/ai-recruiting-assistants/
- petegabi.com — Best AI Recruiting Automation Tools 2026 (2026-07-21). https://www.petegabi.com/blog/ai-recruiting-automation-tools-hr-teams/
- CXToday — Workday Rising 2025: Top 5 Announcements (2025-10-19). https://www.cxtoday.com/event-news/workday-rising-2025-the-top-5-announcements/
- Workday newsroom (May 19 and June 3, 2025) (2025-06-03). https://newsroom.workday.com/2025-06-03-Workday-Announces-New-AI-Agent-Partner-Network-and-Agent-Gateway-to-Power-the-Next-Generation-of-Human-and-Digital-Workforces
- Marxel — AI Resume Screening Statistics 2026 (compiling SHRM Talent Trends 2025, LinkedIn, Ladders, Tribepad, U. Washington, Pew) (2026-06-10). https://www.marxel.co/blog/ai-resume-screening-statistics-2026
- Pin — Agentic AI in Recruiting: The 2026 Practitioner's Guide (2026-02-20). https://www.pin.com/blog/agentic-ai-recruiting/
- RecruitAISuite — 47 AI Recruiting Statistics 2026 (2026-02-18). https://copilot.recruitaisuite.com/blog/ai-recruiting-statistics-2026/
- Feedough — 67+ AI in Recruitment Statistics 2026 (2026-08-23). https://www.feedough.com/ai-in-recruitment-statistics/
- Parseur — 5 Human-in-the-Loop Examples (2026-08-19). https://parseur.com/blog/hitl-case-studies
- Hiretruffle — 100 AI Recruiting Statistics (citing LinkedIn FoR 2025) (2025-09-09). https://www.hiretruffle.com/blog/best-ai-recruitment-statistics
- arXiv — A Natural Field Experiment on Automated Job Interviews (2026-07-30). https://arxiv.org/html/2607.28222v1
- HireCade / FactoryFix summaries (2026-07-30). https://www.factoryfix.com/blog/do-ai-interviews-actually-work-a-landmark-study-gives-a-resounding-yes
- Clustor — Logiciel de staffing ESN: 10 meilleures solutions 2026 (2026-09-02). https://www.clustor.app/blog/logiciel-staffing-esn-10-meilleures-solutions-2026
- Tensoria — Matching CV-Mission par IA en ESN (2026-03-02). https://tensoria.fr/blog/matching-cv-mission-ia-esn
- IAMI. https://www.iamisolutions.com/
- Turnover-IT. https://www.turnover-it.com/audiences/esn
- Masternode AI — AI-Powered Demand Forecasting for Staffing: Reducing Bench Time by 40% (2026-06-19). https://www.masternodeai.com/en/systems/ai-powered-demand-forecasting-for-staffing
- Operating.app — How IT Consulting Firms Can Fix Bench Management (2026-08-25). https://www.operating.app/blog-posts/bench-management-it-consulting
- ShopClawmart — How to Automate Resource Allocation and Project Staffing with AI (2026-04-17). https://www.shopclawmart.com/blog/how-to-automate-resource-allocation-with-ai
- AnywhereR — 12 Best Skills Gap Analysis Software 2026 (2026-07-28). https://www.anywherer.com/best-skills-gap-analysis-software/
- Skywork — AI Skill Mapping and Workforce Planning (2026-05-28). https://skywork.ai/skypage/en/ai-skill-mapping-workforce-planning/2064617987539664896
- Libertify — HR Technology Trends 2025 Deloitte (2026-04-18). https://www.libertify.com/interactive-library/hr-technology-trends-2025-deloitte/
- K&L Gates — 2025 Review of AI and Employment Law in California (2026-08-10). https://www.klgates.com/thought-leadership/2025-Review-of-AI-and-Employment-Law-in-California-5-29-2025
- Warden AI — Workday Class Action Lawsuit timeline (2026-09-04). https://www.warden-ai.com/resources/workday-class-action-lawsuit
- Tenwest Recruiting (2026-04-23). https://tenwestrecruiting.com/the-landmark-agent-theory-ruling-in-mobley-v-workday/
- TheInterviewGuys (citing U. Washington) (2026-05-05). https://blog.theinterviewguys.com/heres-what-74-of-companies-are-doing-wrong-with-ai/
- Classet — AI-Only Recruiting Is More Biased (2026-06-15). https://www.classet.ai/blog/ai-only-recruiting-more-biased-than-combined
- FinalRoundAI — HireVue Review 2026 (2026-08-17). https://www.finalroundai.com/blog/hirevue-review-pros-cons
- ReadySetExec — AI Recruitment: The Candidate Experience Crisis (2026-06-05). https://readysetexec.com/ai-recruitment-candidate-experience/
- Polsky Center (U. Chicago) — The Hiring Process is Now an AI Arms Race (2026-01-15). https://polsky.uchicago.edu/2026/01/15/the-hiring-process-is-now-an-ai-arms-race-but-theres-still-room-to-restore-the-human-element/
- Jobsprout — AI Hiring Arms Race (2026-05-12). https://www.jobsprout.ai/blog/ai-hiring-arms-race
- TheAICronicle (2026-04-22). https://theaicronicle.com/en/news/future/ai-based-hiring-2026-developments
- Boundless — What is the EU AI Act (2026-07-24). https://boundlesshq.com/blog/what-is-the-eu-ai-act-everything-you-need-to-know/
- HeyMilo — How the EU AI Act Changes Recruitment (2026-02-11). https://www.heymilo.ai/blog/how-the-eu-ai-act-changes-recruitment-and-what-employers-need-to-know
- Basil AI (2026-09-01). https://basilai.app/articles/2026-09-01-eu-ai-act-august-2026-ai-notetakers-workplace-monitoring-employer-obligations.html
- Ogletree — EU Nears Approval of Agreement to Delay Rules (2026-06-16). https://ogletree.com/insights-resources/blog-posts/eu-nears-approval-of-agreement-to-delay-rules-for-ai-use-in-employment-decisions/
- FinalRoundAI (2026-08-24). https://futurewithoutconsent.com/timeline
### EU AI Act / GDPR / CNIL compliance

- RecruitmentAds — EU AI Act Annex III & Recruitment (2026-08-05). https://recruitmentads.com/resources/guides/eu-ai-act-recruitment
- RegulatoryAI — EU AI Act & Recruitment/HR AI complete guide (2026-06-13). https://www.regulatoryai.eu/ai-recruitment/
- WageHour Tools — EU AI Act HR Compliance Checker (2026-08-02). https://wagehourtools.com/tools/eu-ai-act-hr-checker
- Alice Labs — EU AI Act Compliance Consulting (Arts. 9–15 seven obligations) (2026-08-04). https://alicelabs.ai/en/insights/eu-ai-act-compliance-consulting
- European Commission AI Act Service Desk — Article 10 (official text) (Reg. 2024/1689). https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-10
- SureCloud — EU AI Act Technical Compliance Requirements 2026 (2026-08-05). https://www.surecloud.com/blog-hub/eu-ai-act-technical-compliance-requirements
- VECOMP 2024 proceedings — fairness requirements table (Arts. 10(2)(f)-(g), 13(3)(b)(v), 15(4)). https://jurisinformaticscenter.github.io/VECOMP2024/AICOM/vecomp_aicomp_proceedings.pdf
- ar.io — EU AI Act Record-Keeping Obligations (2026-08-12). https://ar.io/eu-ai-act/
- Josef Kamara — EU AI Act Deployer Obligations roadmap (2026-08-30). https://josefkamara.com/eu-ai-act-deployer-obligations/
- aiact-navigator — Article 10 plain-English guide (CEN-CENELEC JTC 21 status) (2026-07-06). https://aiact-navigator.com/blog/eu-ai-act-article-10-data-governance-guide
- Optinest — EU AI Act fines, penalty tiers, enforcement (2026-08-19). https://optinest.de/ai-infrastructure/regulation/enforcement/eu-ai-act-fines-penalty-tiers-and-enforcement
- Lawgent — Deployer obligations from 2 December 2027 (2026-08-24). https://lawgent.se/ai-act-deployer-obligations-article-26/
- ailawguide — EU AI Act 2026 survival guide (2026-04-21). https://ailawguide.org/blog/eu-ai-act-2026-the-august-2-survival-guide-for-us-tech-4138766486414074290
- CloseIT — Annex III Point 4 decoded (verbatim Art. 26(7)) (2026-07-08). https://www.closeit.co/eu-ai-act/annex-iii-employment-hr/
- Mima — Deployer obligations Art. 26 & FRIA Art. 27 (consolidated text read at EUR-Lex) (2026-08-02). https://www.mimasolution.com/ai-act/deployer-obligations
- Pin — EU AI Act and Recruiting (2026-06-04). https://www.pin.com/blog/eu-ai-act-recruiting/
- Tech Jacks — EU AI Act obligations reference (Art. 26(6)/(7)/(11), 49(3)) (2026-07-23). https://techjacksolutions.com/eu-ai-act/
- Regumatrix — EU AI Act public sector (FRIA vs DPIA, Art. 27(4)) (2026-08-02). https://regumatrix.eu/compliance/public-sector-ai
- koji.so — Contestability & redress (verbatim Art. 86) (2026-08-06). https://www.koji.so/docs/contesting-ai-decisions-redress-research
- Legalithm — Right to explanation, Art. 86 (2026-08-03). https://www.legalithm.com/en/rules/right-to-explanation-of-individual-decision-making
- European Commission — AI Act regulatory framework (2026-08-02). https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
- montro.io — Provider vs Deployer (Digital Omnibus deferral) (2026-08-24). https://montro.io/blog/eu-ai-act-provider-vs-deployer
- legalithm — EU AI Act penalties explained (tier 2, deferral) (2026-07-30). https://www.legalithm.com/blog/eu-ai-act-penalties-fines-explained
- DeepInspect — EU AI Act Article 99 fines & tiers (2026-09-04). https://www.deepinspect.ai/blog/eu-ai-act-article-99-penalties
- pretense.ai — Art. 99/101 enforcement (2026-08-02). https://www.pretense.ai/case-studies/eu-ai-act-article-99-article-101-enforcement
- SecurePrivacy — GDPR Article 22 guide (SCHUFA, Foodinho, fine tiers) (2026-08-11). https://secureprivacy.ai/blog/gdpr-article-22-automated-decision-making-guide
- teamed.global — Is emotion recognition at work legal in the EU in 2026? (2026-04-20). https://www.teamed.global/insights/is-emotion-recognition-at-work-legal-in-eu
- SecurePrivacy — Article 5 prohibited practices guide 2026 (2026-07-10). https://secureprivacy.ai/blog/eu-ai-act-article-5-prohibited-ai-practices-and-compliance-guide-2026
- University of Essex AI Policy Observatory — EU case (guidelines para 254: candidates covered as workers) (2026-07-14). https://www.essex.ac.uk/research-projects/ai-policy-observatory-for-the-world-of-work/national-and-regional-cases/european-union
- agmabogados — Prohibited practices & penalties (2026-06-17). https://www.agmabogados.com/en/eu-ai-act-prohibited-practices-and-penalties/
- Legiscope — GDPR Article 22 after SCHUFA (2026-09-08). https://www.legiscope.com/blog/gdpr-article-22-automated-decision-making.html
- gdpr-law.eu — GDPR & AI automated decision-making 2026 (Recital 71 e-recruiting) (2026-08-03). https://gdpr-law.eu/blog/gdpr-and-ai-automated-decision-making-profiling-and-compliance-in-2026/
- Innovires — AI recruitment legal risks (Art. 22(2)/(3) safeguards) (2026-04-10). https://www.innovires.com/en/blog/ai-rekrutirane-pravni-riskove.html
- Terralogic — DPIA explained (Art. 35(3)(a); AI recruitment screening) (2026-08-25). https://terralogic.com/blogs/dpia-explained-data-protection-impact-assessment/
- Orbiq — DPIA template (Art. 35(7) content; CNIL 14-category list; Art. 83(4)) (2026-07-15). https://www.orbiqhq.com/templates/dpia-template
- CNIL — Guide recrutement (official PDF, Jan 2023; AIPD, réexamen humain, profilage). https://www.cnil.fr/sites/cnil/files/atoms/files/guide_referentiel_recrutement.pdf
- Legisocial — CNIL référentiel durées de conservation recrutement (2 Apr 2026) (2026-04-13). https://www.legisocial.fr/actualites-sociales/7875-recrutement-duree-conservation-donnees-personnelles-candidat.html
- RGPDkit — CNIL 2026 recruitment controls (2 ans; 30 jours sourcing; 5 ans archive) (2026-09-04). https://www.rgpdkit.fr/blog/recrutement-rgpd-cnil-controle-2026
- donneespersonnelles.fr — CV retention 2 years from last contact (2026-07-02). https://www.donneespersonnelles.fr/quelle-duree-conservation-cv-candidats
- koji.so — Works councils & employee research (EDPB consent/power imbalance; Art. 88) (2026-08-01). https://www.koji.so/docs/works-council-employee-research
- workauditor — Employee monitoring & GDPR (legitimate interest + balancing test) (2026-08-31). https://www.workauditor.com/blog/posts/employee-monitoring-and-gdpr-guide.html
- Knowlee — CNIL et décision automatisée en recrutement (doctrine: no sensitive data, bias audit, 2-year retention) (2026-04-30). https://www.knowlee.ai/fr/blog/cnil-decision-automatisee-recrutement
- totalshiftleft — Data residency, GDPR, Schrems II (EU-region inference, TIA, SCCs) (2026-04-11). https://totalshiftleft.ai/blog/api-testing-data-residency-gdpr
- aona.ai — AI data residency requirements EU/UK (2026-06-12). https://aona.ai/resources/guides/ai-data-residency-requirements-eu-uk/
- noxcod — IA et RGPD: hébergement France (CNIL 12 fiches; sanction totals) (2026-04-23). https://www.noxcod.com/blog/assistant-ia-heberge-france-rgpd
- soethik — RGPD et IA: ce que dit la CNIL (4 recommendation series timeline, délibérations 2024-011 / 2025-047) (2026-04-03). https://soethik.com/cnil-rgpd-intelligence-artificielle.html
- nophi.sh — CNIL sanctions & priorities 2025-2026 (2026-04-06). https://nophi.sh/blog/cnil-plus-grosses-amendes-rgpd-france
- CNIL (official) — Contrôles prioritaires 2026: recrutement (2026-04-03). https://www.cnil.fr/fr/controles-prioritaires-2026
- Capital — La CNIL va contrôler les entreprises qui utilisent l'IA pour trier les CV (2026-05-31). https://www.capital.fr/votre-carriere/recrutement-la-cnil-va-controler-les-entreprises-qui-utilisent-lia-pour-trier-les-cv-1527053
- DLA Piper — AI Laws of the World: France supervisory authority (DGCCRF, DGE, PEReN/ANSSI, DDADUE pending) (2026-07-20). https://intelligence.dlapiper.com/artificial-intelligence/?t=03-appointed-supervisory-authority&c=FR
- mmoww — EU AI Act high-risk employment (CSE inform/consult; Art. 26(7) floor) (2026-06-10). https://mmoww.net/ai/industry/eu-ai-act-high-risk-employment/
- MRU HIPSTer literature review — C-203/22 Dun & Bradstreet (procedures & principles actually applied). https://www.mruni.eu/wp-content/uploads/2026/06/07.-HIPSTer-MRU-Literatūros-apžvalga.pdf
- datenschutz-notizen — Automated credit scoring under scrutiny (Austrian DPA KSV1870, Sep 2025) (2025-10-28). https://www.datenschutz-notizen.de/automated-credit-scoring-under-scrutiny-in-europe-4556684/
- Juno David K — GDPR in the age of AI (Clearview enforcement lessons) (2026-03-29). https://junodavidk.com/gdpr-in-the-age-of-ai-what-every-data-protection-officer-needs-to-know.html
- aitency — EU AI Act penalties: enforcement trajectory forecast (2026-04-25). https://aitency.com/blog/eu-ai-act-penalties-non-compliance
- luxgap — Deploying ChatGPT without consulting staff: courts order suspension (2026-07-03). https://luxgap.com/articles/deployer-chatgpt-sans-consulter-le-personnel-justice-suspend-luxembourg/?lang=en
### ESN talent lifecycle & operations

- Timizer — ESN Définition (2026-01-15). https://timizer.io/esn-dfinition/
- Fitnet Manager — Logiciel de gestion de facturation pour ESN (2026-04-07). https://fitnetmanager.com/logiciel-de-gestion-de-facturation-pour-esn/
- Elyx AI — Suivi candidatures Excel (2026-01-03). https://getelyxai.com/fr/excel-use-cases/charge-de-recrutement/suivi-des-candidatures
- Pacte Novation — Travailler dans une ESN (2025-07-08). https://www.pactenovation.fr/rejoindre-pacte-novation/
- Cobalt — État du recrutement ESN France 2026 (2026-04-21). https://www.cobalt-ia.com/fr/blog/etat-recrutement-esn-france-2026-etude
- Vague à l'Ouest — Défis de recrutement ESN (2024-11-25). https://vaguealouest.odoo.com/blog/actualites-1/comment-une-esn-peut-faire-la-difference-face-aux-defis-de-recrutement-en-developpement-6
- EveryCheck — Le défi du recrutement dans les ESN en France en (2024). https://www.everycheck.com/blog/marche-esn/
- BoondManager / Informatique News — IA et automatisation du recrutement ESN (2024-11-12). https://www.boondmanager.com/la-presse-en-parle/lia-et-lautomatisation-deux-leviers-strategiques-pour-optimiser-le-recrutement-dans-les-esn/
- Marvin Recruiter — Recrutement sur profil,   n.d. https://www.marvinrecruiter.com/guides/recrutement-sur-profil-lapproche-centree-sur-les-competences
- Tekos — Pourcentage d'intercontrat (2026-01-20). https://tekos.io/blog/taux-intercontrat
- VerySwing — Staffing en ESN : le guide pratique (2026-06-16). https://veryswing.com/staffing-en-esn-le-guide-pratique-pour-optimiser-laffectation-de-vos-consultants-sur-les-missions.html
- UnJobEnVille — Responsable Staffing et Performance (ESN) job posting (2026-03-02). https://www.unjobenville.com/offre-emploi/cq-norgay-responsable-staffing-et-performance-esn
- Digirocks — Recruter un Business Manager en ESN (2026-08-06). https://www.digirocks.fr/recruter-un-business-manager-en-esn/
- Workhint — Consulting Bench Management Best Practices (2026-07-31). https://blog.workhint.com/blog/consulting-bench-management-best-practices/
- Lyno — Gestion de l'intercontrat en ESN (2026-06-12). https://lyno-app.com/ressources/gestion-intercontrat
- Cobalt — Intercontrat en ESN : coût réel & gestion (2026-03-27). https://www.cobalt-ia.com/fr/blog/intercontrat-esn-cout-reel-gestion
- VerySwing — Intercontrat en ESN : anticiper et gérer (2026-04-21). https://veryswing.com/intercontrat-esn-comment-anticiper-reduire-fideliser.html
- EKLA LAB — Onboarding consultant ESN (2026-02-09). https://www.ekla-lab.fr/post/onboarding-consultant-la-variable-sous-estim%C3%A9e-dans-les-esn
- Orsys — Gestion des compétences en ESN (2026-03-17). https://www.orsys.fr/orsys-lemag/gestion-des-competences-en-esn-attirer-fideliser-faire-evoluer-talents-it/
- Singular — Quels points aborder lors d'un entretien annuel ? (2026-05-25). https://www.singular-is-future.com/post/quels-points-aborder-lors-d-un-entretien-annuel-par-le-collaborateur-et-l-entreprise
- BoostRH — Tableau de bord RH – Guide Complet (2026-03-11). https://www.boostrh.com/tableau-de-bord-rh-mesurer-et-piloter-avec-efficacite/
- Fitnet Manager — CRM pour ESN (2026-04-15). https://fitnetmanager.com/crm-pour-esn/
- Lab0 — Pipelines Pipedrive Recrutement & ESN,   n.d. https://lelab0.com/guide-pipedrive/recrutement-esn/pipelines/
- Karanext — Top 8 bonnes pratiques de facturation en ESN (2026-06-22). https://www.karanext.com/blog/bonnes-pratiques-facturation-esn
- Billi — Compte rendu d'activité (CRA) : définition et bonnes pratiques (2026-06-05). https://billi.so/fr/blog/compte-rendu-activite-cra-definition-guide
- Karanext — CRA en ESN : Les bonnes pratiques (2025-09-22). https://www.karanext.com/blog/bonnes-pratiques-gerer-les-cra-esn
- Timizer — CRA ESN (2026-09-11). https://timizer.io/cra-esn/
- Atimeus — TJM (Taux Journalier Moyen) (2026-03-31). https://www.atimeus.com/glossaire/tjm
- Hayot Expertise — Expert-comptable ESN (2025-01-01). https://hayot-expertise.fr/secteurs/expert-comptable-esn
- Konsilys — Suivre la marge d'une mission en ESN (2026-07-09). https://konsilys.fr/blog/suivre-marge-mission-esn.html
- Karanext — 10 indicateurs de performance ESN (2026-06-26). https://www.karanext.com/blog/pilotez-votre-esn-10-indicateurs-de-performance
- Philix — Les 6 indicateurs de performance ESN (2026-01-13). https://philix.fr/les-6-indicateurs-de-performance-a-suivre-pour-votre-esn/
- Napta — ROI de votre démarche de staffing,   n.d. https://www.napta.io/blog/comment-mesurer-le-roi-de-votre-demarche-de-staffing
- Solal Digital — Turnover dans les ESN (2024-04-30). https://solal-digital-mauritius.com/externalisation-maurice/turnover-dans-les-esn-une-analyse-de-ce-phenomene/
- Consultor — Le turn-over dans les cabinets de conseil (2025-04-25). https://www.consultor.fr/articles/le-turn-over-dans-les-cabinets-de-conseil-un-mal-necessaire
- Peeramid — TACE en ESN : Guide Complet (2025-05-22). https://peeramid.live/actualites/tace/
- Talent Program — Offboarding : Guide (2026-07-13). https://www.talentprogram.fr/offboarding/
- DAF Mag — Bien réussir la phase d'offboarding (2024-07-10). https://www.daf-mag.fr/Thematique/rh-1245/motivation-engagement-2128/Breves/Depart-d-un-salarie-comment-bien-reussir-la-phase-d-460761.htm


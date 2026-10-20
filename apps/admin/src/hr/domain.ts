export type ApplicationStage = 'application' | 'screening' | 'hr_interview' | 'technical_interview' | 'client_presentation' | 'decision' | 'offer' | 'contract';
export type ApplicationStatus = 'active' | 'hired' | 'rejected' | 'withdrawn';
export type EmploymentStatus = 'preboarding' | 'active' | 'offboarding' | 'ended';
export type AssignmentStatus = 'proposed' | 'reserved' | 'confirmed' | 'active' | 'completed' | 'cancelled';
export type Person = { id: string; full_name: string; email: string; phone: string; headline: string; location: string; skills: string; languages: string; degrees: string; certifications: string; notes: string; source: string; owner_email: string; contact_allowed: boolean; version: number; created_at: string; updated_at: string };
export type Application = { id: string; person_id: string; opportunity_id: string; stage: ApplicationStage; status: ApplicationStatus; reason: string; screening_summary: string; screening_recommendation: string; source: string; referrer: string; stage_entered_at: string; version: number; created_at: string; updated_at: string };
export type Employee = { id: string; person_id: string; application_id: string | null; offer_id: string | null; matricule: string; role: string; manager_email: string; parrain: string; start_date: string; end_date: string | null; planned_exit_date: string | null; status: EmploymentStatus; onboarding_completed_at: string | null; probation_status: 'pending' | 'confirmed' | 'extended' | 'ended'; probation_end: string | null; version: number; created_at: string; updated_at: string };
export type Opportunity = { id: string; title: string; hiring_mode: string; job_id: string | null; project_id: string | null; client_ids: string[]; client_need: string; skill_family: string; owner_email: string; target_tjm: number | null; status: string; justification: string; decided_by: string; decided_at: string | null; decision_rationale: string; version: number; created_at: string; updated_at: string };
export type Interview = { id: string; application_id: string; kind: 'hr' | 'technical' | 'client'; scheduled_at: string; panel: string; location: string; status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'; scorecard: unknown; notes: string; invitation_status: 'manual' | 'pending' | 'delivered' | 'failed'; version: number; created_at: string };
export type Offer = { id: string; application_id: string; title: string; contract_type: string; salary_monthly: number; cjm: number; target_tjm: number; margin_pct: number; status: 'draft' | 'pending_approval' | 'pending_direction' | 'approved' | 'shared' | 'accepted' | 'declined' | 'cancelled' | 'expired'; approver_note: string; decided_by: string; shared_at: string | null; response_at: string | null; valid_until: string | null; delivery_status: 'manual' | 'pending' | 'delivered' | 'failed'; version: number; created_at: string };
export type JourneyTask = { id: string; employee_id: string; phase: 'preboarding' | 'onboarding' | 'probation'; title: string; assignee: string; due_date: string | null; required: boolean; dependency_id: string | null; evidence: string; completed_at: string | null; completed_by: string | null; version: number; created_at: string };
export type Review = { id: string; employee_id: string; kind: 'probation' | 'annual'; due_date: string; status: 'scheduled' | 'held'; outcome: string; rationale: string; held_at: string | null; version: number; created_at: string };
export type Exit = { id: string; employee_id: string; kind: string; status: 'open' | 'completed'; exit_date: string; notice_end: string | null; handover_plan: string; successor: string; exit_interview: string; rehire_eligible: boolean | null; rehire_rationale: string; legal_docs_evidence: string; completed_at: string | null; version: number; created_at: string };
export type ExitItem = { id: string; offboarding_id: string; title: string; required: boolean; evidence: string; completed_at: string | null; version: number; created_at: string };
export type Assignment = { id: string; employee_id: string; project_id: string; position: string; pricing_line: string; allocation_pct: number; start_date: string; end_date: string | null; status: AssignmentStatus; version: number; created_at: string; updated_at: string };
export type Event = { id: number; person_id: string; application_id: string | null; employee_id: string | null; kind: string; previous_state: string; next_state: string; actor_id: string; actor_email: string; rationale: string; request_id: string; created_at: string };
export type Contract = { id: string; offer_id: string | null; candidate_id: string; person_id: string | null; application_id: string | null; employee_id: string | null; title: string; storage_path: string; document_sha256: string; created_at: string };
export type Signature = { contract_id: string; candidate_id: string; signer_name: string; consent_text: string; document_sha256: string; signed_at: string };
export type Countersignature = { contract_id: string; actor_id: string; signer_name: string; document_sha256: string; signed_at: string };
export type SuggestionKind = 'interview_prep' | 'profile_summary' | 'onboarding_plan' | 'staffing_match' | 'handover' | 'alumni_reconnect' | 'job_description';
export type Suggestion = { id: string; person_id: string | null; application_id: string | null; employee_id: string | null; opportunity_id: string | null; kind: SuggestionKind; payload: unknown; sources: unknown; input_version: number; model: string; status: 'draft' | 'accepted' | 'dismissed' | 'stale'; reviewed_by: string | null; reviewed_at: string | null; created_at: string };
export type StaffingProject = { id: string; version: number; title: string; client_id: string | null; status: string; start_date: string | null; end_date: string | null; pricing_model: string; currency: string; tjm_profiles?: unknown };
export type StaffingClient = { id: string; name: string };
export type Account = { profile_id: string; person_id: string; linked_by: string; linked_at: string };
export type Capabilities = { recruit: boolean; approve_offer: boolean; approve_direction: boolean; staff: boolean; admin: boolean };
export type Workspace = { jobs: { id: string; title: string; published: boolean }[]; people: Person[]; applications: Application[]; employees: Employee[]; opportunities: Opportunity[]; interviews: Interview[]; offers: Offer[]; tasks: JourneyTask[]; reviews: Review[]; exits: Exit[]; exitItems: ExitItem[]; assignments: Assignment[]; events: Event[]; contracts: Contract[]; signatures: Signature[]; countersignatures: Countersignature[]; suggestions: Suggestion[]; projects: StaffingProject[]; clients: StaffingClient[]; accounts: Account[]; capabilities: Capabilities };
export type Requirement = { key: string; label: string; done: boolean };
export type ProfileInput = Pick<Person, 'full_name'> & Partial<Pick<Person, 'email' | 'phone' | 'headline' | 'location' | 'skills' | 'languages' | 'degrees' | 'certifications' | 'notes' | 'source' | 'owner_email' | 'contact_allowed'>>;
type Versioned = { expected_version: number };
type PersonTarget = { person_id: string; application_id?: string; employee_id?: string };
type RequisitionInput = Pick<Opportunity, 'title' | 'hiring_mode'> & Partial<Pick<Opportunity, 'job_id' | 'project_id' | 'client_ids' | 'client_need' | 'skill_family' | 'owner_email' | 'target_tjm' | 'justification'>>;
export type CommandIntent =
 | ({ kind: 'create_person' } & ProfileInput)
 | ({ kind: 'update_person'; person_id: string } & Versioned & ProfileInput)
 | { kind: 'link_account'; person_id: string; profile_id: string }
 | { kind: 'create_application'; person_id: string; opportunity_id: string; source?: string; referrer?: string }
 | ({ kind: 'move_application'; application_id: string; to_stage: ApplicationStage; rationale?: string } & Versioned)
 | ({ kind: 'dispose_application'; application_id: string; status: 'rejected' | 'withdrawn'; reason: string } & Versioned)
 | ({ kind: 'add_note'; rationale: string } & PersonTarget)
 | { kind: 'schedule_interview'; application_id: string; interview_kind: 'hr' | 'technical' | 'client'; scheduled_at: string; panel: string; location?: string }
 | ({ kind: 'complete_interview'; interview_id: string; scorecard: unknown; notes: string } & Versioned)
 | ({ kind: 'cancel_interview'; interview_id: string; rationale: string } & Versioned)
 | { kind: 'create_offer'; application_id: string; title: string; contract_type: string; salary_monthly: number; cjm: number; target_tjm: number; valid_until?: string | null }
 | ({ kind: 'approve_offer'; offer_id: string; note: string } & Versioned)
 | ({ kind: 'cancel_offer'; offer_id: string; rationale: string } & Versioned)
 | ({ kind: 'share_offer'; offer_id: string } & Versioned)
 | ({ kind: 'respond_offer'; offer_id: string; response: 'accepted' | 'declined'; rationale: string } & Versioned)
 | ({ kind: 'hire'; application_id: string; start_date: string; role: string; manager_email?: string; parrain?: string; probation_end?: string | null } & Versioned)
 | ({ kind: 'start_onboarding' | 'complete_onboarding'; employee_id: string } & Versioned)
 | ({ kind: 'cancel_hire'; employee_id: string; rationale: string } & Versioned)
 | ({ kind: 'update_employment'; employee_id: string; manager_email?: string; parrain?: string } & Versioned)
 | { kind: 'save_task'; employee_id: string; task_id?: string; expected_version?: number; phase: JourneyTask['phase']; title: string; assignee: string; due_date?: string | null; required?: boolean; dependency_id?: string | null; evidence?: string }
 | ({ kind: 'complete_task'; task_id: string; evidence: string } & Versioned)
 | { kind: 'schedule_review'; employee_id: string; review_kind: Review['kind']; due_date: string }
 | ({ kind: 'record_review'; review_id: string; outcome: string; rationale: string; probation_end?: string | null } & Versioned)
 | ({ kind: 'open_exit'; employee_id: string; exit_kind: string; exit_date: string; notice_end?: string | null; rationale: string } & Versioned)
 | ({ kind: 'save_exit'; exit_id: string; handover_plan: string; successor: string; exit_interview: string; rehire_eligible: boolean | null; rehire_rationale: string; legal_docs_evidence: string } & Versioned)
 | ({ kind: 'complete_exit'; exit_id: string } & Versioned)
 | { kind: 'save_exit_item'; exit_id: string; item_id?: string; expected_version?: number; title: string; required?: boolean; evidence?: string }
 | ({ kind: 'complete_exit_item'; item_id: string; evidence: string } & Versioned)
 | { kind: 'assign_project'; employee_id: string; project_id: string; position: string; pricing_line?: string; allocation_pct: number; start_date: string; end_date?: string | null; status: 'proposed' | 'reserved' | 'confirmed' | 'active' }
 | ({ kind: 'update_assignment'; assignment_id: string; position: string; pricing_line?: string; allocation_pct: number; start_date: string; end_date?: string | null; status: 'proposed' | 'reserved' | 'confirmed' | 'active'; rationale: string } & Versioned)
 | ({ kind: 'end_assignment'; assignment_id: string; end_date: string; rationale: string; cancel?: boolean } & Versioned)
 | ({ kind: 'create_requisition' } & RequisitionInput)
 | ({ kind: 'update_requisition'; opportunity_id: string } & Versioned & RequisitionInput)
 | ({ kind: 'publish_requisition'; opportunity_id: string; job_id: string } & Versioned)
 | { kind: 'countersign_contract'; contract_id: string; signer_name: string }
 | { kind: 'save_suggestion'; person_id?: string | null; application_id?: string | null; employee_id?: string | null; opportunity_id?: string | null; suggestion_kind: SuggestionKind; payload: unknown; sources: unknown; input_version: number; model: string }
 | { kind: 'review_suggestion'; suggestion_id: string; status: 'accepted' | 'dismissed' }
 | ({ kind: 'import_person'; external_source: string; external_id: string; employment?: { role: string; start_date: string; end_date?: string | null }; rationale: string } & ProfileInput);
export type Command = CommandIntent & { request_id?: string };
export type CommandResult = { request_id: string; created?: boolean; person_id?: string; application_id?: string; employee_id?: string; opportunity_id?: string; interview_id?: string; offer_id?: string; task_id?: string; review_id?: string; exit_id?: string; item_id?: string; assignment_id?: string; suggestion_id?: string; version?: number };

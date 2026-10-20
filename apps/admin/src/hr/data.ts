import { z } from "zod";
import { db } from "@quicksort/hr-db";
import type { CommandResult, Requirement, Workspace } from "./domain";
export type * from "./domain";
const personSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  email: z.string(),
  phone: z.string(),
  headline: z.string(),
  location: z.string(),
  skills: z.string(),
  languages: z.string().catch(''),
  degrees: z.string().catch(''),
  certifications: z.string().catch(''),
  notes: z.string(),
  source: z.string(),
  owner_email: z.string(),
  contact_allowed: z.boolean(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const applicationSchema = z.object({
  id: z.string(),
  person_id: z.string(),
  opportunity_id: z.string(),
  stage: z.enum(["application","screening","hr_interview","technical_interview","client_presentation","decision","offer","contract"]),
  status: z.enum(["active","hired","rejected","withdrawn"]),
  reason: z.string(),
  screening_summary: z.string(),
  screening_recommendation: z.string(),
  source: z.string(),
  referrer: z.string(),
  stage_entered_at: z.string(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const employeeSchema = z.object({
  id: z.string(),
  person_id: z.string(),
  application_id: z.string().nullable(),
  offer_id: z.string().nullable(),
  matricule: z.string(),
  role: z.string(),
  manager_email: z.string(),
  parrain: z.string(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  planned_exit_date: z.string().nullable(),
  status: z.enum(["preboarding","active","offboarding","ended"]),
  onboarding_completed_at: z.string().nullable(),
  probation_status: z.enum(["pending","confirmed","extended","ended"]),
  probation_end: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const opportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  hiring_mode: z.string(),
  job_id: z.string().nullable(),
  project_id: z.string().nullable(),
  client_ids: z.array(z.string().uuid()),
  client_need: z.string(),
  skill_family: z.string(),
  owner_email: z.string(),
  target_tjm: z.number().nullable(),
  status: z.string(),
  justification: z.string(),
  decided_by: z.string(),
  decided_at: z.string().nullable(),
  decision_rationale: z.string(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const interviewSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  kind: z.enum(["hr","technical","client"]),
  scheduled_at: z.string(),
  panel: z.string(),
  location: z.string(),
  status: z.enum(["scheduled","completed","cancelled","no_show"]),
  scorecard: z.unknown(),
  notes: z.string(),
  invitation_status: z.enum(["manual","pending","delivered","failed"]),
  version: z.number(),
  created_at: z.string(),
});
const offerSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  title: z.string(),
  contract_type: z.string(),
  salary_monthly: z.number(),
  cjm: z.number(),
  target_tjm: z.number(),
  margin_pct: z.number(),
  status: z.enum(["draft","pending_approval","pending_direction","approved","shared","accepted","declined","cancelled","expired"]),
  approver_note: z.string(),
  decided_by: z.string(),
  shared_at: z.string().nullable(),
  response_at: z.string().nullable(),
  valid_until: z.string().nullable(),
  delivery_status: z.enum(["manual","pending","delivered","failed"]),
  version: z.number(),
  created_at: z.string(),
});
const journeyTaskSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  phase: z.enum(["preboarding","onboarding","probation"]),
  title: z.string(),
  assignee: z.string(),
  due_date: z.string().nullable(),
  required: z.boolean(),
  dependency_id: z.string().nullable(),
  evidence: z.string(),
  completed_at: z.string().nullable(),
  completed_by: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
});
const reviewSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  kind: z.enum(["probation","annual"]),
  due_date: z.string(),
  status: z.enum(["scheduled","held"]),
  outcome: z.string(),
  rationale: z.string(),
  held_at: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
});
const exitSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  kind: z.string(),
  status: z.enum(["open","completed"]),
  exit_date: z.string(),
  notice_end: z.string().nullable(),
  handover_plan: z.string(),
  successor: z.string(),
  exit_interview: z.string(),
  rehire_eligible: z.boolean().nullable(),
  rehire_rationale: z.string(),
  legal_docs_evidence: z.string(),
  completed_at: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
});
const exitItemSchema = z.object({
  id: z.string(),
  offboarding_id: z.string(),
  title: z.string(),
  required: z.boolean(),
  evidence: z.string(),
  completed_at: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
});
const assignmentSchema = z.object({
  id: z.string(),
  employee_id: z.string(),
  project_id: z.string(),
  position: z.string(),
  /** Named TJM profile ("Data Engineer") the person is staffed on; empty
      when the assignment covers the whole project. */
  pricing_line: z.string().default(''),
  allocation_pct: z.number(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  status: z.enum(["proposed","reserved","confirmed","active","completed","cancelled"]),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const eventSchema = z.object({
  id: z.number(),
  person_id: z.string(),
  application_id: z.string().nullable(),
  employee_id: z.string().nullable(),
  kind: z.string(),
  previous_state: z.string(),
  next_state: z.string(),
  actor_id: z.string(),
  actor_email: z.string(),
  rationale: z.string(),
  request_id: z.string(),
  created_at: z.string(),
});
const contractSchema = z.object({
  offer_id: z.string().nullable(),
  id: z.string(),
  candidate_id: z.string(),
  person_id: z.string().nullable(),
  application_id: z.string().nullable(),
  employee_id: z.string().nullable(),
  title: z.string(),
  storage_path: z.string(),
  document_sha256: z.string(),
  created_at: z.string(),
});
const signatureSchema = z.object({
  contract_id: z.string(),
  candidate_id: z.string(),
  signer_name: z.string(),
  consent_text: z.string(),
  document_sha256: z.string(),
  signed_at: z.string(),
});
const countersignatureSchema = z.object({
  contract_id: z.string(),
  actor_id: z.string(),
  signer_name: z.string(),
  document_sha256: z.string(),
  signed_at: z.string(),
});
const suggestionSchema = z.object({
  id: z.string(),
  person_id: z.string().nullable(),
  application_id: z.string().nullable(),
  employee_id: z.string().nullable(),
  opportunity_id: z.string().nullable(),
  kind: z.enum(["interview_prep","profile_summary","onboarding_plan","staffing_match","handover","alumni_reconnect","job_description"]),
  payload: z.unknown(),
  sources: z.unknown(),
  input_version: z.number(),
  model: z.string(),
  status: z.enum(["draft","accepted","dismissed","stale"]),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
});
const staffingProjectSchema = z.object({
  version: z.number(),
  id: z.string(),
  title: z.string(),
  client_id: z.string().nullable(),
  status: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  /** Régie pricing lines — offered as staffing targets in the assign form. */
  pricing_model: z.string().default(''),
  currency: z.string().default('EUR'),
  tjm_profiles: z.unknown().default(null),
});
const staffingClientSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const accountSchema = z.object({
  profile_id: z.string(),
  person_id: z.string(),
  linked_by: z.string(),
  linked_at: z.string(),
});
const capabilitiesSchema = z.object({
  recruit: z.boolean(),
  approve_offer: z.boolean(),
  approve_direction: z.boolean(),
  staff: z.boolean(),
  admin: z.boolean(),
});
const workspaceSchema = z.object({
 people: z.array(personSchema),
 applications: z.array(applicationSchema),
 employees: z.array(employeeSchema),
 opportunities: z.array(opportunitySchema),
 interviews: z.array(interviewSchema),
 offers: z.array(offerSchema),
 tasks: z.array(journeyTaskSchema),
 reviews: z.array(reviewSchema),
 exits: z.array(exitSchema),
 exitItems: z.array(exitItemSchema),
 assignments: z.array(assignmentSchema),
 events: z.array(eventSchema),
 contracts: z.array(contractSchema),
 signatures: z.array(signatureSchema),
 countersignatures: z.array(countersignatureSchema),
 suggestions: z.array(suggestionSchema),
 projects: z.array(staffingProjectSchema),
 clients: z.array(staffingClientSchema),
 accounts: z.array(accountSchema),
 capabilities: capabilitiesSchema, jobs: z.array(z.object({id:z.string(),title:z.string(),published:z.boolean()})),
});
const uuid = z.string().uuid();
const text = z.string();
const date = z.iso.date();
const nullableDate = date.nullable().optional();
const version = { expected_version: z.number().int().positive() };
const personFields = { full_name: text.trim().min(1).max(200), email: text.max(200).optional(), phone:text.max(40).optional(), headline:text.optional(),location:text.optional(),skills:text.optional(),languages:text.optional(),degrees:text.optional(),certifications:text.optional(),notes:text.optional(),source:text.optional(),owner_email:text.optional(),contact_allowed:z.boolean().optional() };
const requisitionFields = {title:text.trim().min(1),hiring_mode:z.enum(['sur_mission','sur_profil']),job_id:uuid.nullable().optional(),project_id:uuid.nullable().optional(),client_ids:z.array(uuid).optional(),client_need:text.optional(),skill_family:text.optional(),owner_email:text.optional(),target_tjm:z.number().nonnegative().nullable().optional(),justification:text.optional()};
const commandSchemas = {
 create_person:z.object({kind:z.literal('create_person'),...personFields}),
 update_person:z.object({kind:z.literal('update_person'),person_id:uuid,...version,...personFields}),
 link_account:z.object({kind:z.literal('link_account'),person_id:uuid,profile_id:uuid}),
 create_application:z.object({kind:z.literal('create_application'),person_id:uuid,opportunity_id:uuid,source:text.optional(),referrer:text.optional()}),
 move_application:z.object({kind:z.literal('move_application'),application_id:uuid,...version,to_stage:applicationSchema.shape.stage,rationale:text.optional()}),
 dispose_application:z.object({kind:z.literal('dispose_application'),application_id:uuid,...version,status:z.enum(['rejected','withdrawn']),reason:text.trim().min(1)}),
 add_note:z.object({kind:z.literal('add_note'),person_id:uuid,application_id:uuid.optional(),employee_id:uuid.optional(),rationale:text.trim().min(1)}),
 schedule_interview:z.object({kind:z.literal('schedule_interview'),application_id:uuid,interview_kind:interviewSchema.shape.kind,scheduled_at:z.iso.datetime({offset:true}),panel:text,location:text.optional()}),
 complete_interview:z.object({kind:z.literal('complete_interview'),interview_id:uuid,...version,scorecard:z.array(z.object({competency:text.trim().min(1),rating:z.number().min(1).max(5),evidence:text.trim().min(1)})).min(1),notes:text.trim().min(1)}),
 cancel_interview:z.object({kind:z.literal('cancel_interview'),interview_id:uuid,...version,rationale:text.trim().min(1)}),
 create_offer:z.object({kind:z.literal('create_offer'),application_id:uuid,title:text.trim().min(1),contract_type:text,salary_monthly:z.number().nonnegative(),cjm:z.number().positive(),target_tjm:z.number().positive(),valid_until:nullableDate}),
 approve_offer:z.object({kind:z.literal('approve_offer'),offer_id:uuid,...version,note:text.trim().min(1)}),
 cancel_offer:z.object({kind:z.literal('cancel_offer'),offer_id:uuid,...version,rationale:text.trim().min(1)}),
 share_offer:z.object({kind:z.literal('share_offer'),offer_id:uuid,...version}),
 respond_offer:z.object({kind:z.literal('respond_offer'),offer_id:uuid,...version,response:z.enum(['accepted','declined']),rationale:text.trim().min(1)}),
 hire:z.object({kind:z.literal('hire'),application_id:uuid,...version,start_date:date,role:text.trim().min(1),manager_email:text.optional(),parrain:text.optional(),probation_end:nullableDate}),
 start_onboarding:z.object({kind:z.literal('start_onboarding'),employee_id:uuid,...version}),
 complete_onboarding:z.object({kind:z.literal('complete_onboarding'),employee_id:uuid,...version}),
 cancel_hire:z.object({kind:z.literal('cancel_hire'),employee_id:uuid,...version,rationale:text.trim().min(1)}),
 update_employment:z.object({kind:z.literal('update_employment'),employee_id:uuid,...version,manager_email:text.optional(),parrain:text.optional()}),
 save_task:z.object({kind:z.literal('save_task'),employee_id:uuid,task_id:uuid.optional(),expected_version:z.number().int().positive().optional(),phase:journeyTaskSchema.shape.phase,title:text.trim().min(1),assignee:text,due_date:nullableDate,required:z.boolean().optional(),dependency_id:uuid.nullable().optional(),evidence:text.optional()}),
 complete_task:z.object({kind:z.literal('complete_task'),task_id:uuid,...version,evidence:text.trim().min(1)}),
 schedule_review:z.object({kind:z.literal('schedule_review'),employee_id:uuid,review_kind:reviewSchema.shape.kind,due_date:date}),
 record_review:z.object({kind:z.literal('record_review'),review_id:uuid,...version,outcome:text.trim().min(1),rationale:text.trim().min(1),probation_end:nullableDate}),
 open_exit:z.object({kind:z.literal('open_exit'),employee_id:uuid,...version,exit_kind:text.trim().min(1),exit_date:date,notice_end:nullableDate,rationale:text.trim().min(1)}),
 save_exit:z.object({kind:z.literal('save_exit'),exit_id:uuid,...version,handover_plan:text,successor:text,exit_interview:text,rehire_eligible:z.boolean().nullable(),rehire_rationale:text,legal_docs_evidence:text}),
 complete_exit:z.object({kind:z.literal('complete_exit'),exit_id:uuid,...version}),
 save_exit_item:z.object({kind:z.literal('save_exit_item'),exit_id:uuid,item_id:uuid.optional(),expected_version:z.number().int().positive().optional(),title:text.trim().min(1),required:z.boolean().optional(),evidence:text.optional()}),
 complete_exit_item:z.object({kind:z.literal('complete_exit_item'),item_id:uuid,...version,evidence:text.trim().min(1)}),
 assign_project:z.object({kind:z.literal('assign_project'),employee_id:uuid,project_id:uuid,position:text,pricing_line:text.optional(),allocation_pct:z.number().int().min(1).max(100),start_date:date,end_date:nullableDate,status:z.enum(['proposed','reserved','confirmed','active'])}),
 update_assignment:z.object({kind:z.literal('update_assignment'),assignment_id:uuid,...version,position:text,pricing_line:text.optional(),allocation_pct:z.number().int().min(1).max(100),start_date:date,end_date:nullableDate,status:z.enum(['proposed','reserved','confirmed','active']),rationale:text.trim().min(1)}),
 end_assignment:z.object({kind:z.literal('end_assignment'),assignment_id:uuid,...version,end_date:date,rationale:text.trim().min(1),cancel:z.boolean().optional()}),
 create_requisition:z.object({kind:z.literal('create_requisition'),...requisitionFields}),
 update_requisition:z.object({kind:z.literal('update_requisition'),opportunity_id:uuid,...version,...requisitionFields}),
 publish_requisition:z.object({kind:z.literal('publish_requisition'),opportunity_id:uuid,...version,job_id:uuid}),
 countersign_contract:z.object({kind:z.literal('countersign_contract'),contract_id:uuid,signer_name:text.trim().min(2)}),
 save_suggestion:z.object({kind:z.literal('save_suggestion'),person_id:uuid.nullable().optional(),application_id:uuid.nullable().optional(),employee_id:uuid.nullable().optional(),opportunity_id:uuid.nullable().optional(),suggestion_kind:suggestionSchema.shape.kind,payload:z.json(),sources:z.array(z.object({type:z.enum(['person','application','employee','task','assignment','opportunity','project']),id:uuid,version:z.number().int().positive()})).min(1),input_version:z.number().int().positive(),model:text.trim().min(1)}),
 review_suggestion:z.object({kind:z.literal('review_suggestion'),suggestion_id:uuid,status:z.enum(['accepted','dismissed'])}),
 import_person:z.object({kind:z.literal('import_person'),...personFields,external_source:text.trim().min(1),external_id:text.trim().min(1),rationale:text.trim().min(1),employment:z.object({role:text,start_date:date,end_date:nullableDate}).optional()}),
};
const commandSchema = z.discriminatedUnion('kind',[commandSchemas.create_person.extend({request_id:uuid.optional()}),...Object.values(commandSchemas).filter(schema=>schema!==commandSchemas.create_person).map(schema=>schema.extend({request_id:uuid.optional()}))]);
const resultSchema = z.object({request_id:uuid,created:z.boolean().optional(),person_id:uuid.optional(),application_id:uuid.optional(),employee_id:uuid.optional(),opportunity_id:uuid.optional(),interview_id:uuid.optional(),offer_id:uuid.optional(),task_id:uuid.optional(),review_id:uuid.optional(),exit_id:uuid.optional(),item_id:uuid.optional(),assignment_id:uuid.optional(),suggestion_id:uuid.optional(),version:z.number().int().positive().optional()});
const requirementsSchema = z.array(z.object({key:text,label:text,done:z.boolean()}));

export async function loadWorkspace(): Promise<Workspace> {
 const result = await db().rpc('hr_workspace_snapshot');
 if(result.error) throw result.error;
 return workspaceSchema.parse(result.data);
}
export async function executeCommand(input: unknown): Promise<CommandResult> {
 const parsed = commandSchema.parse(input);
 const command = z.json().parse({...parsed,request_id:parsed.request_id ?? crypto.randomUUID()});
 const result = await db().rpc('hr_command',{command});
 if(result.error) throw result.error;
 return resultSchema.parse(result.data);
}
export async function loadRequirements(applicationId: string,toStage: string): Promise<Requirement[]> {
 const result = await db().rpc('hr_application_requirements',{application_id:uuid.parse(applicationId),to_stage:toStage});
 if(result.error) throw result.error;
 return requirementsSchema.parse(result.data);
}
export { errorMessage } from '@quicksort/hr-db';

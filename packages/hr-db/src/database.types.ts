import type { HrTable, HrPerson, HrApplication, HrEmployee, HrEmployeeSalary, HrOpportunity, HrInterview, HrOffer, HrJourneyTask, HrReview, HrExit, HrExitItem, HrAssignment, HrEvent, HrSuggestion, HrAccount } from "./hr.types";
import type { BlogRecord, BlogInsert } from "./blog";
import type { DocumentTypeRecord, DocumentRecord, DocumentFolderRecord, DocumentAlert, DocumentRegistration } from "./documents.types";
export type SignatureSigner = { role: 'person' | 'quicksort'; name: string; email: string; order: number };
export type SignatureRequestStatus = 'draft' | 'sending' | 'sent' | 'signed_by_person' | 'completed' | 'declined' | 'expired' | 'cancelled' | 'error';
// Server-only: never select encrypted_credentials from the browser.
export type SignatureSettingsRecord = { id: string; options: { staging?: boolean; signatory_name?: string; signatory_email?: string }; encrypted_credentials: string | null; updated_at: string };
export type SignatureTemplateRecord = { id: string; name: string; google_doc_id: string; signers: 'person_and_quicksort' | 'person' | 'quicksort'; type_code: string; active: boolean; created_by: string | null; created_at: string; updated_at: string };
export type FreelancerBillingRecord = { employee_id: string; company_name: string; siret: string; iban: string; extra_emails: string[]; updated_by: string | null; updated_at: string };
export type FreelancerInvoiceRecord = { id: string; employee_id: string; source: 'portal' | 'email'; gmail_message_id: string | null; document_id: string | null; sha256: string; number: string; issue_date: string | null; period_month: string | null; due_date: string | null; amount_ht_cents: number | null; vat_cents: number | null; amount_ttc_cents: number | null; is_credit_note: boolean; review: 'to_check' | 'ok' | 'rejected'; flags: string[]; review_note: string; extraction: Json | null; paid_at: string | null; paid_by_transaction_id: string | null; created_at: string; updated_at: string; version: number };
export type FreelancerInvoiceMatchRecord = { invoice_id: string; transaction_id: string; kind: 'confident' | 'probable' | 'manual'; state: 'suggested' | 'confirmed' | 'dismissed'; created_at: string; decided_by: string | null };
export type FreelancerInvoiceEventRecord = { id: string; invoice_id: string; kind: string; actor_email: string | null; detail: Json; created_at: string };
export type FreelancerMailboxSettingsRecord = { id: 'mailbox'; address: string; backfill_from: string; last_polled_at: string | null; last_error: string | null; locked_until: string | null; updated_by: string | null };
export type FreelancerMailboxMessageRecord = { message_id: string; status: 'done' | 'failed'; attempts: number; last_error: string | null; internal_date: string | null; processed_at: string };
export type SignatureRequestRecord = { id: string; person_id: string; template_id: string | null; title: string; type_code: string; signers: SignatureSigner[]; field_values: Record<string, string>; supersedes: string | null; application_id: string | null; status: SignatureRequestStatus; error: string; youtrust_request_id: string | null; youtrust_document_id: string | null; doc_copy_file_id: string | null; pdf_file_id: string | null; pdf_folder_id: string | null; signed_document_id: string | null; audit_document_id: string | null; filing_claimed_at: string | null; created_by: string; created_at: string; updated_at: string; status_changed_at: string };
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      hr_people: HrTable<HrPerson>;
      hr_applications: HrTable<HrApplication>;
      hr_events: HrTable<HrEvent>;
      hr_ai_suggestions: HrTable<HrSuggestion>;
      hr_person_accounts: HrTable<HrAccount>;
      blog_posts: { Row: BlogRecord; Insert: BlogInsert; Update: Partial<BlogRecord>; Relationships: [] };
      document_types: HrTable<DocumentTypeRecord>;
      documents: HrTable<DocumentRecord>;
      document_folders: HrTable<DocumentFolderRecord>;
      signature_settings: HrTable<SignatureSettingsRecord>;
      signature_templates: HrTable<SignatureTemplateRecord>;
      signature_requests: HrTable<SignatureRequestRecord>;
      signature_webhook_events: HrTable<{ event_id: string; received_at: string }>;
      freelancer_billing: HrTable<FreelancerBillingRecord>;
      freelancer_invoices: HrTable<FreelancerInvoiceRecord>;
      freelancer_invoice_matches: HrTable<FreelancerInvoiceMatchRecord>;
      freelancer_invoice_events: HrTable<FreelancerInvoiceEventRecord>;
      freelancer_mailbox_settings: HrTable<FreelancerMailboxSettingsRecord>;
      freelancer_mailbox_messages: HrTable<FreelancerMailboxMessageRecord>;
      admin_access_audit: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: number
          target_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: never
          target_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: never
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_access_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_access_audit_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_access_requests: {
        Row: {
          created_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_access_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_documents: {
        Row: {
          candidate_id: string
          category: string
          created_at: string
          id: string
          name: string
          size_bytes: number
          storage_path: string
          type_code: string | null
        }
        Insert: {
          candidate_id: string
          category: string
          created_at?: string
          id?: string
          name: string
          size_bytes: number
          storage_path: string
          type_code?: string | null
        }
        Update: {
          candidate_id?: string
          category?: string
          created_at?: string
          id?: string
          name?: string
          size_bytes?: number
          storage_path?: string
          type_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_documents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cra_entries: {
        Row: {
          employee_id: string
          month: string
          day: string
          part: "full" | "am" | "pm"
          status:
            | "rtt"
            | "unpaid_leave"
            | "paid_leave"
            | "internal"
            | "client_project"
          project_id: string | null
        }
        Insert: {
          employee_id: string
          month: string
          day: string
          part?: "full" | "am" | "pm"
          status:
            | "rtt"
            | "unpaid_leave"
            | "paid_leave"
            | "internal"
            | "client_project"
          project_id?: string | null
        }
        Update: {
          employee_id?: string
          month?: string
          day?: string
          part?: "full" | "am" | "pm"
          status?:
            | "rtt"
            | "unpaid_leave"
            | "paid_leave"
            | "internal"
            | "client_project"
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cra_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sales_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_accrual_settings: {
        Row: {
          kind: string
          rate: number
          updated_at: string
        }
        Insert: {
          kind: string
          rate: number
          updated_at?: string
        }
        Update: {
          kind?: string
          rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      leave_payslip_checkpoints: {
        Row: {
          employee_id: string
          period: string
          n1_acquired: number
          n1_taken: number
          n_acquired: number
          n_taken: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          employee_id: string
          period: string
          n1_acquired?: number
          n1_taken?: number
          n_acquired?: number
          n_taken?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          employee_id?: string
          period?: string
          n1_acquired?: number
          n1_taken?: number
          n_acquired?: number
          n_taken?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      hr_economics_settings: {
        Row: {
          id: boolean
          cjm_multiplier: number
          bp_multiplier_optimistic: number
          bp_multiplier_pessimistic: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          cjm_multiplier: number
          bp_multiplier_optimistic?: number
          bp_multiplier_pessimistic?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          cjm_multiplier?: number
          bp_multiplier_optimistic?: number
          bp_multiplier_pessimistic?: number
          updated_at?: string
        }
        Relationships: []
      }
      candidate_requests: {
        Row: {
          id: string
          email: string
          kind: string
          message: string
          status: string
          admin_note: string
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          kind: string
          message?: string
          status?: string
          admin_note?: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          kind?: string
          message?: string
          status?: string
          admin_note?: string
          created_at?: string
        }
        Relationships: []
      }
      interviews: HrTable<HrInterview>;
      jobs: {
        Row: {
          created_at: string
          department: string
          description: string
          employment_type: string
          id: string
          linkedin_url: string
          location: string
          published: boolean
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string
          description: string
          employment_type?: string
          id?: string
          linkedin_url: string
          location: string
          published?: boolean
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string
          description?: string
          employment_type?: string
          id?: string
          linkedin_url?: string
          location?: string
          published?: boolean
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      offboarding_items: HrTable<HrExitItem>;
      offboarding_records: HrTable<HrExit>;
      offers: HrTable<HrOffer>;
      ops_boards: {
        Row: {
          id: string
          name: string
          description: string
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string
          position?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_columns: {
        Row: {
          id: string
          board_id: string
          name: string
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          board_id: string
          name: string
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          board_id?: string
          name?: string
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "ops_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_cards: {
        Row: {
          id: string
          board_id: string
          column_id: string
          title: string
          content: string
          priority: string
          owner_email: string
          counters: Json
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          board_id: string
          column_id: string
          title: string
          content?: string
          priority?: string
          owner_email?: string
          counters?: Json
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          board_id?: string
          column_id?: string
          title?: string
          content?: string
          priority?: string
          owner_email?: string
          counters?: Json
          position?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_cards_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "ops_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "ops_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_items: HrTable<HrJourneyTask>;
      employee_project_assignments: HrTable<HrAssignment>;
      employees: HrTable<HrEmployee>;
      employee_salaries: HrTable<HrEmployeeSalary>;


      portal_owners: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_owners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
        }
        Relationships: []
      }
      opportunities: HrTable<HrOpportunity>;
      sales_activities: {
        Row: {
          id: string
          opportunity_id: string | null
          client_id: string | null
          person_id: string | null
          type: string
          text: string
          author_email: string
          created_at: string
        }
        Insert: {
          id?: string
          opportunity_id?: string | null
          client_id?: string | null
          person_id?: string | null
          type: string
          text: string
          author_email: string
          created_at?: string
        }
        Update: {
          id?: string
          opportunity_id?: string | null
          client_id?: string | null
          person_id?: string | null
          type?: string
          text?: string
          author_email?: string
          created_at?: string
        }
        Relationships: []
      }
      sales_clients: {
        Row: {
          id: string
          name: string
          industry: string
          size: string
          website: string
          location: string
          revenue: string
          tags: string[]
          health: string
          owner_email: string
          notes: string
          last_activity_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          industry?: string
          size?: string
          website?: string
          location?: string
          revenue?: string
          tags?: string[]
          health?: string
          owner_email?: string
          notes?: string
          last_activity_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          industry?: string
          size?: string
          website?: string
          location?: string
          revenue?: string
          tags?: string[]
          health?: string
          owner_email?: string
          notes?: string
          last_activity_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales_opportunities: {
        Row: {
          id: string
          title: string
          client_id: string
          pricing_model: string
          currency: string
          tjm: number | null
          estimated_days: number | null
          fixed_price: number | null
          amount: number
          stage: string
          probability: number
          expected_close: string | null
          owner_email: string
          lost_reason: string
          notes: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          client_id: string
          pricing_model: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          fixed_price?: number | null
          amount?: number
          stage?: string
          probability?: number
          expected_close?: string | null
          owner_email?: string
          lost_reason?: string
          notes?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          client_id?: string
          pricing_model?: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          fixed_price?: number | null
          amount?: number
          stage?: string
          probability?: number
          expected_close?: string | null
          owner_email?: string
          lost_reason?: string
          notes?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_opportunities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "sales_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_contacts: {
        Row: {
          id: string
          name: string
          role: string
          client_id: string
          email: string
          phone: string
          linkedin: string
          is_decision_maker: boolean
          notes: string
          last_contact_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          role?: string
          client_id: string
          email?: string
          phone?: string
          linkedin?: string
          is_decision_maker?: boolean
          notes?: string
          last_contact_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          role?: string
          client_id?: string
          email?: string
          phone?: string
          linkedin?: string
          is_decision_maker?: boolean
          notes?: string
          last_contact_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "sales_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_project_extensions: {
        Row: {
          id: string
          project_id: string
          label: string
          pricing_model: string
          currency: string
          tjm: number | null
          estimated_days: number | null
          fixed_price: number | null
          amount: number
          status: string
          start_date: string | null
          end_date: string | null
          notes: string
          created_at: string
          updated_at: string
          tjm_profiles: Json
        }
        Insert: {
          id?: string
          project_id: string
          label?: string
          pricing_model: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          fixed_price?: number | null
          amount?: number
          status?: string
          start_date?: string | null
          end_date?: string | null
          notes?: string
          created_at?: string
          updated_at?: string
          tjm_profiles?: Json
        }
        Update: {
          id?: string
          project_id?: string
          label?: string
          pricing_model?: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          fixed_price?: number | null
          amount?: number
          status?: string
          start_date?: string | null
          end_date?: string | null
          notes?: string
          created_at?: string
          updated_at?: string
          tjm_profiles?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sales_project_extensions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sales_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_projects: {
        Row: {
          version: number
          id: string
          title: string
          client_id: string
          intermediary_client_id: string | null
          opportunity_id: string | null
          type: string
          pricing_model: string
          currency: string
          tjm: number | null
          estimated_days: number | null
          tjm_profiles: Json
          fixed_price: number | null
          amount: number
          status: string
          start_date: string | null
          end_date: string | null
          owner_email: string
          notes: string
          drive_folder_id: string | null
          drive_folder_name: string | null
          drive_folder_link: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          version?: number
          id?: string
          title: string
          client_id: string
          intermediary_client_id?: string | null
          opportunity_id?: string | null
          type?: string
          pricing_model: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          tjm_profiles?: Json
          fixed_price?: number | null
          amount?: number
          status?: string
          start_date?: string | null
          end_date?: string | null
          owner_email?: string
          notes?: string
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          drive_folder_link?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          version?: number
          id?: string
          title?: string
          client_id?: string
          intermediary_client_id?: string | null
          opportunity_id?: string | null
          type?: string
          pricing_model?: string
          currency?: string
          tjm?: number | null
          estimated_days?: number | null
          tjm_profiles?: Json
          fixed_price?: number | null
          amount?: number
          status?: string
          start_date?: string | null
          end_date?: string | null
          owner_email?: string
          notes?: string
          drive_folder_id?: string | null
          drive_folder_name?: string | null
          drive_folder_link?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "sales_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_projects_intermediary_client_id_fkey"
            columns: ["intermediary_client_id"]
            isOneToOne: false
            referencedRelation: "sales_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_projects_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "sales_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_sponsors: {
        Row: {
          opportunity_id: string
          person_id: string
          influence: string
          is_primary: boolean
          created_at: string
        }
        Insert: {
          opportunity_id: string
          person_id: string
          influence?: string
          is_primary?: boolean
          created_at?: string
        }
        Update: {
          opportunity_id?: string
          person_id?: string
          influence?: string
          is_primary?: boolean
          created_at?: string
        }
        Relationships: []
      }
      admin_statuses: {
        Row: {
          kind: string
          key: string
          label: string
          color: string
          position: number
          is_default: boolean
          is_terminal: boolean
          visible: boolean
          updated_at: string
        }
        Insert: {
          kind: string
          key: string
          label: string
          color?: string
          position?: number
          is_default?: boolean
          is_terminal?: boolean
          visible?: boolean
          updated_at?: string
        }
        Update: {
          kind?: string
          key?: string
          label?: string
          color?: string
          position?: number
          is_default?: boolean
          is_terminal?: boolean
          visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      admin_types: {
        Row: {
          key: string
          label: string
          mode: string
          position: number
          visible: boolean
          updated_at: string
        }
        Insert: {
          key: string
          label: string
          mode?: string
          position?: number
          visible?: boolean
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          mode?: string
          position?: number
          visible?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      reviews: HrTable<HrReview>;
      tool_requests: {
        Row: {
          admin_note: string
          candidate_id: string
          created_at: string
          id: string
          reason: string
          status: string
          tool_name: string
        }
        Insert: {
          admin_note?: string
          candidate_id?: string
          created_at?: string
          id?: string
          reason: string
          status?: string
          tool_name: string
        }
        Update: {
          admin_note?: string
          candidate_id?: string
          created_at?: string
          id?: string
          reason?: string
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_requests_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role?: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      my_applications: HrTable<{ id: string; person_id: string; opportunity_id: string; full_name: string; title: string; stage: string; status: string; created_at: string; updated_at: string }>;
      my_application_events: HrTable<{ id: number; application_id: string; to_stage: string; kind: string; created_at: string }>;
      my_employment: HrTable<Pick<HrEmployee, 'id' | 'person_id' | 'matricule' | 'role' | 'start_date' | 'end_date' | 'status' | 'onboarding_completed_at' | 'probation_status' | 'probation_end' | 'contract_type'>>;
      my_onboarding_items: HrTable<Omit<HrJourneyTask,'completed_by'|'created_at'>>;
      document_alerts: HrTable<DocumentAlert>;
      my_payslips: HrTable<{ id: string; person_id: string; title: string; valid_from: string | null; file_name: string; size_bytes: number | null; created_at: string }>;
      my_documents: HrTable<{ id: string; upload_path: string | null; uploaded_by_me: boolean; type_code: string; type_label: string | null; title: string; file_name: string; mime_type: string; size_bytes: number | null; status: 'active' | 'superseded' | 'archived'; needs_review: boolean; issued_on: string | null; expires_on: string | null; warn_days: number[]; created_at: string }>;
      my_document_types: HrTable<{ code: string; label: string; folder: string; requirement_group: string | null; requires_expiry: boolean; warn_days: number[]; sensitive: boolean; position: number; required: boolean; self_upload: boolean; relevant: boolean }>;
      my_offers: HrTable<Pick<HrOffer,'id'|'application_id'|'title'|'contract_type'|'salary_monthly'|'status'|'shared_at'|'valid_until'|'version'>>;
    }
    Functions: {
      cra_context: { Args: Record<PropertyKey, never>; Returns: Json };
      my_freelancer_invoices: { Args: Record<PropertyKey, never>; Returns: { id: string; number: string; period_month: string | null; amount_ttc_cents: number | null; received_at: string; portal_status: 'received' | 'to_pay' | 'paid' | 'not_accepted' }[] };
      freelancer_known_senders: { Args: Record<PropertyKey, never>; Returns: { employee_id: string; email: string }[] };
      freelancer_invoice_mark_paid: { Args: { invoice_ids: string[]; transaction_id: string; match_kind: 'confident' | 'probable' | 'manual'; actor: string; paid_at: string }; Returns: number };
      my_name_from_hr: { Args: Record<PropertyKey, never>; Returns: boolean };
      cra_month_snapshot: { Args: { target_employee: string; target_month: string }; Returns: Json };
      cra_save_month: { Args: { target_employee: string; target_month: string; expected_version: number; entries: Json }; Returns: Json };
      employee_leave_balances: {
        Args: Record<PropertyKey, never>
        Returns: { employee_id: string; kind: string; accrued: number; consumed: number; available: number }[]
      };
      hr_command: { Args: { command: Json }; Returns: Json };
      register_document: { Args: { document: DocumentRegistration; supersedes?: string | null; request_id?: string }; Returns: DocumentRecord };
      register_signed_document: { Args: { signature_request: string; document: DocumentRegistration; supersedes?: string | null }; Returns: DocumentRecord };
      set_employee_matricule: { Args: { employee_id: string; matricule: string; request_id?: string }; Returns: HrEmployee };
      own_document_download_source: { Args: { document_id: string }; Returns: { provider_file_id: string; file_name: string; mime_type: string; size_bytes: number | null; storage_provider: string; encrypted_credentials: string | null }[] };
      payslip_download_source: { Args: { document_id: string }; Returns: { provider_file_id: string; file_name: string; mime_type: string; size_bytes: number | null; storage_provider: string; encrypted_credentials: string | null }[] };
      move_payslip: { Args: { document_id: string; to_person_id: string; to_folder_id: string; request_id?: string }; Returns: DocumentRecord };
      log_document_access: { Args: { document_id: string; request_id?: string }; Returns: undefined };
      hr_workspace_snapshot: { Args: Record<PropertyKey, never>; Returns: Json };
      hr_application_requirements: { Args: { application_id: string; to_stage: string }; Returns: Json };
      sync_clerk_profile: { Args: Record<PropertyKey, never>; Returns: string };
      review_admin_access: {
        Args: { decision: string; target_email: string }
        Returns: undefined
      }
      assign_workspace_role: {
        Args: { role: string; target_email: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

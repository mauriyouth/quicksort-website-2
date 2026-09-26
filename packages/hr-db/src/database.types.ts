import type { BlogRecord, BlogInsert } from "./blog";
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
      blog_posts: { Row: BlogRecord; Insert: BlogInsert; Update: Partial<BlogRecord>; Relationships: [] };
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
        }
        Insert: {
          candidate_id: string
          category: string
          created_at?: string
          id?: string
          name: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          candidate_id?: string
          category?: string
          created_at?: string
          id?: string
          name?: string
          size_bytes?: number
          storage_path?: string
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
      contract_signatures: {
        Row: {
          candidate_id: string
          consent_text: string
          contract_id: string
          document_sha256: string
          signed_at: string
          signer_name: string
        }
        Insert: {
          candidate_id?: string
          consent_text?: string
          contract_id: string
          document_sha256?: string
          signed_at?: string
          signer_name: string
        }
        Update: {
          candidate_id?: string
          consent_text?: string
          contract_id?: string
          document_sha256?: string
          signed_at?: string
          signer_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_signatures_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          candidate_id: string
          created_at: string
          document_sha256: string
          id: string
          storage_path: string
          title: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          document_sha256: string
          id?: string
          storage_path: string
          title: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          document_sha256?: string
          id?: string
          storage_path?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      interviews: {
        Row: {
          id: string
          candidate_id: string
          opportunity_id: string | null
          kind: string
          scheduled_at: string
          panel: string
          location: string
          status: string
          scorecard: Json
          ai_summary: string
          created_at: string
        }
        Insert: {
          id?: string
          candidate_id: string
          opportunity_id?: string | null
          kind: string
          scheduled_at: string
          panel?: string
          location?: string
          status?: string
          scorecard?: Json
          ai_summary?: string
          created_at?: string
        }
        Update: {
          id?: string
          candidate_id?: string
          opportunity_id?: string | null
          kind?: string
          scheduled_at?: string
          panel?: string
          location?: string
          status?: string
          scorecard?: Json
          ai_summary?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
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
      offboarding_items: {
        Row: {
          id: string
          offboarding_id: string
          title: string
          done: boolean
          done_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          offboarding_id: string
          title: string
          done?: boolean
          done_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          offboarding_id?: string
          title?: string
          done?: boolean
          done_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offboarding_items_offboarding_id_fkey"
            columns: ["offboarding_id"]
            isOneToOne: false
            referencedRelation: "offboarding_records"
            referencedColumns: ["id"]
          },
        ]
      }
      offboarding_records: {
        Row: {
          id: string
          candidate_id: string
          kind: string
          status: string
          exit_date: string
          notice_end: string | null
          prerequis_waived: boolean
          handover_plan: string
          successor: string
          exit_interview: string
          rehire_eligible: boolean | null
          rehire_rationale: string
          legal_docs_done: boolean
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          candidate_id: string
          kind: string
          status?: string
          exit_date: string
          notice_end?: string | null
          prerequis_waived?: boolean
          handover_plan?: string
          successor?: string
          exit_interview?: string
          rehire_eligible?: boolean | null
          rehire_rationale?: string
          legal_docs_done?: boolean
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          candidate_id?: string
          kind?: string
          status?: string
          exit_date?: string
          notice_end?: string | null
          prerequis_waived?: boolean
          handover_plan?: string
          successor?: string
          exit_interview?: string
          rehire_eligible?: boolean | null
          rehire_rationale?: string
          legal_docs_done?: boolean
          completed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offboarding_records_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          id: string
          candidate_id: string
          opportunity_id: string | null
          title: string
          contract_type: string
          salary_monthly: number
          cjm: number
          target_tjm: number
          margin_pct: number
          status: string
          approver_note: string
          decided_by: string
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          candidate_id: string
          opportunity_id?: string | null
          title: string
          contract_type?: string
          salary_monthly: number
          cjm: number
          target_tjm: number
          margin_pct?: number
          status?: string
          approver_note?: string
          decided_by?: string
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          candidate_id?: string
          opportunity_id?: string | null
          title?: string
          contract_type?: string
          salary_monthly?: number
          cjm?: number
          target_tjm?: number
          margin_pct?: number
          status?: string
          approver_note?: string
          decided_by?: string
          sent_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
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
      onboarding_items: {
        Row: {
          id: string
          candidate_id: string
          phase: string
          title: string
          assignee: string
          due_date: string | null
          done: boolean
          done_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          candidate_id: string
          phase: string
          title: string
          assignee?: string
          due_date?: string | null
          done?: boolean
          done_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          candidate_id?: string
          phase?: string
          title?: string
          assignee?: string
          due_date?: string | null
          done?: boolean
          done_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_items_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_candidates: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string
          source: string
          referrer: string
          opportunity_id: string | null
          stage: string
          person_status: string
          disposition: string | null
          disposition_reason: string
          match_score: number | null
          match_explanation: string
          screening_summary: string
          screening_recommendation: string
          skills: string
          notes: string
          start_date: string | null
          probation_end: string | null
          parrain: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          email?: string
          phone?: string
          source?: string
          referrer?: string
          opportunity_id?: string | null
          stage?: string
          person_status?: string
          disposition?: string | null
          disposition_reason?: string
          match_score?: number | null
          match_explanation?: string
          screening_summary?: string
          screening_recommendation?: string
          skills?: string
          notes?: string
          start_date?: string | null
          probation_end?: string | null
          parrain?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string
          source?: string
          referrer?: string
          opportunity_id?: string | null
          stage?: string
          person_status?: string
          disposition?: string | null
          disposition_reason?: string
          match_score?: number | null
          match_explanation?: string
          screening_summary?: string
          screening_recommendation?: string
          skills?: string
          notes?: string
          start_date?: string | null
          probation_end?: string | null
          parrain?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_candidates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_events: {
        Row: {
          id: number
          candidate_id: string
          from_stage: string
          to_stage: string
          actor_email: string
          rationale: string
          created_at: string
        }
        Insert: {
          id?: never
          candidate_id: string
          from_stage?: string
          to_stage?: string
          actor_email: string
          rationale?: string
          created_at?: string
        }
        Update: {
          id?: never
          candidate_id?: string
          from_stage?: string
          to_stage?: string
          actor_email?: string
          rationale?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_events_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
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
      opportunities: {
        Row: {
          id: string
          title: string
          hiring_mode: string
          job_id: string | null
          client_need: string
          skill_family: string
          owner_email: string
          target_tjm: number | null
          status: string
          justification: string
          decided_by: string
          decided_at: string | null
          decision_rationale: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          hiring_mode: string
          job_id?: string | null
          client_need?: string
          skill_family?: string
          owner_email?: string
          target_tjm?: number | null
          status?: string
          justification?: string
          decided_by?: string
          decided_at?: string | null
          decision_rationale?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          hiring_mode?: string
          job_id?: string | null
          client_need?: string
          skill_family?: string
          owner_email?: string
          target_tjm?: number | null
          status?: string
          justification?: string
          decided_by?: string
          decided_at?: string | null
          decision_rationale?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
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
      sales_people: {
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
            foreignKeyName: "sales_people_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "sales_clients"
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
      reviews: {
        Row: {
          id: string
          candidate_id: string
          kind: string
          due_date: string
          status: string
          outcome: string
          rationale: string
          held_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          candidate_id: string
          kind: string
          due_date: string
          status?: string
          outcome?: string
          rationale?: string
          held_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          candidate_id?: string
          kind?: string
          due_date?: string
          status?: string
          outcome?: string
          rationale?: string
          held_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "pipeline_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
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
      my_application: {
        Row: {
          id: string
          full_name: string
          stage: string
          start_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name?: string
          stage?: string
          start_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          stage?: string
          start_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      my_application_events: {
        Row: {
          id: number
          candidate_id: string
          to_stage: string
          created_at: string
        }
        Insert: {
          id?: number
          candidate_id?: string
          to_stage?: string
          created_at?: string
        }
        Update: {
          id?: number
          candidate_id?: string
          to_stage?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Functions: {
      sync_clerk_profile: { Args: Record<PropertyKey, never>; Returns: string };
      review_admin_access: {
        Args: { decision: string; target_email: string }
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

// Document registry (supabase/migrations/20261122090000_documents.sql).
export type DocumentOwnerKind = "person" | "client" | "project";
export type DocumentStatus = "active" | "superseded" | "archived";
export type DocumentStorageProvider = "gdrive" | "s3" | "supabase";
export type DocumentAlertSeverity = "expired" | "expiring" | "missing";

export type DocumentTypeRecord = {
  code: string;
  label: string;
  owner_kinds: DocumentOwnerKind[];
  folder: string;
  requires_expiry: boolean;
  default_validity_months: number | null;
  warn_days: number[];
  sensitive: boolean;
  required_for: string[];
  requirement_group: string | null;
  position: number;
  updated_at: string;
};

export type DocumentRecord = {
  id: string;
  type_code: string;
  owner_kind: DocumentOwnerKind;
  person_id: string | null;
  client_id: string | null;
  project_id: string | null;
  extension_id: string | null;
  parent_document_id: string | null;
  title: string;
  status: DocumentStatus;
  issued_on: string | null;
  valid_from: string | null;
  expires_on: string | null;
  superseded_by: string | null;
  needs_review: boolean;
  notes: string;
  storage_provider: DocumentStorageProvider;
  provider_file_id: string;
  provider_folder_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  sha256: string | null;
  uploaded_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type DocumentFolderRecord = {
  storage_provider: Exclude<DocumentStorageProvider, "supabase">;
  owner_kind: DocumentOwnerKind | "root";
  owner_id: string | null;
  folder_code: string;
  provider_folder_id: string;
  folder_name: string;
  folder_link: string;
  created_at: string;
};

export type DocumentAlert = {
  severity: DocumentAlertSeverity;
  days_left: number | null;
  owner_kind: DocumentOwnerKind;
  person_id: string | null;
  client_id: string | null;
  project_id: string | null;
  extension_id: string | null;
  type_code: string;
  type_label: string;
  document_id: string | null;
  title: string;
  expires_on: string | null;
};

// Fields accepted by register_document; ids and audit columns are set by the database.
export type DocumentRegistration = Pick<DocumentRecord, "type_code" | "owner_kind" | "title" | "storage_provider" | "provider_file_id" | "file_name">
  & Partial<Pick<DocumentRecord, "person_id" | "client_id" | "project_id" | "extension_id" | "parent_document_id" | "issued_on" | "valid_from" | "expires_on" | "needs_review" | "notes" | "provider_folder_id" | "mime_type" | "size_bytes" | "sha256">>;

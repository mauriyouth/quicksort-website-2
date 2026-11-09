import type { SupabaseClient } from "@supabase/supabase-js";
import { datedSubfolder } from "./folders.ts";
import { documentRecord, loadType, resolveFolder } from "./handler.ts";
import type { DocumentStorage, StorageFolder } from "./storage/types.ts";

/** The folder a person's document of this type is filed in (also used for preview copies). */
export async function personFolder(client: SupabaseClient, storage: DocumentStorage, personId: string, typeCode: string): Promise<StorageFolder> {
  const owner = { kind: "person" as const, id: personId };
  const type = await loadType(client, typeCode, owner, null);
  return resolveFolder(client, storage, owner, type.folder, datedSubfolder(type.code, {}));
}

export type FileBufferInput = {
  personId: string;
  typeCode: string;
  title: string;
  fileName: string;
  bytes: Uint8Array;
  signatureRequestId: string;
  supersedes?: string | null;
  parentDocumentId?: string | null;
  issuedOn?: string | null;
};

/**
 * Files a PDF the server holds (a signed contract) into the person's registry
 * folder through register_signed_document. A refused registration trashes the
 * upload so storage never keeps an untracked copy; a repeat of the same file
 * returns the row already registered.
 */
export async function fileBuffer(client: SupabaseClient, storage: DocumentStorage, input: FileBufferInput): Promise<{ id: string }> {
  const folder = await personFolder(client, storage, input.personId, input.typeCode);
  const file = await storage.uploadFile(folder, { name: input.fileName, mimeType: "application/pdf" }, input.bytes);
  const registered = await client.rpc("register_signed_document", {
    signature_request: input.signatureRequestId,
    document: documentRecord(
      { owner: { kind: "person", id: input.personId }, typeCode: input.typeCode, title: input.title, issuedOn: input.issuedOn, parentDocumentId: input.parentDocumentId },
      storage.provider,
      file,
      folder.id,
    ),
    supersedes: input.supersedes ?? null,
  });
  if (!registered.error) return { id: (registered.data as { id: string }).id };
  if (registered.error.code === "23505") {
    const existing = await client.from("documents").select("*").eq("storage_provider", storage.provider).eq("provider_file_id", file.id).neq("status", "archived").maybeSingle();
    if (existing.data) return { id: (existing.data as { id: string }).id };
  }
  await storage.trash(file.id).catch(() => undefined);
  throw registered.error;
}

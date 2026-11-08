/**
 * Storage behind the document registry. The database (public.documents) holds
 * what a file is; a DocumentStorage only holds bytes and folders. Google Drive
 * implements it today, S3 later — callers never branch on the provider.
 *
 * Uploads never pass through the serverless function (request bodies are too
 * small for scans and signed PDFs): prepareUpload returns a URL the browser
 * PUTs the bytes to, then the API registers the file by its id.
 */
export type StorageProvider = "gdrive" | "s3";

/** The trees: client/project documents, the restricted HR tree, and the company's own papers. */
export type StorageRoot = "clients" | "people" | "company";

export type StorageFolder = { id: string; name: string; link: string | null };

export type StoredFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedAt: string | null;
  link: string | null;
  /** Folders holding the file — the API checks an upload landed where it was sent. */
  folderIds: string[];
  /** Content hash when the provider computes one (Drive does). */
  sha256: string | null;
  isFolder: boolean;
};

export type UploadTarget = {
  uploadUrl: string;
  method: "PUT";
  /** Headers the browser must send with the bytes. */
  headers: Record<string, string>;
  /**
   * Known up front for S3 (the object key). Drive assigns the id on upload and
   * returns it in the PUT response body ({ id }).
   */
  fileId: string | null;
};

export interface DocumentStorage {
  readonly provider: StorageProvider;
  /** Finds or creates the nested folder path under a root, e.g. ["Acme/Run", "01_Contrat"]. */
  ensureFolder(root: StorageRoot, path: string[]): Promise<StorageFolder>;
  /** Finds or creates one folder inside a known one (by id, so renamed owners keep their folder). */
  ensureChild(parent: StorageFolder, name: string): Promise<StorageFolder>;
  /** `origin` is the browser origin that will PUT the bytes (CORS on the upload URL). */
  prepareUpload(folder: StorageFolder, file: { name: string; mimeType: string; size: number }, origin?: string | null): Promise<UploadTarget>;
  getFile(fileId: string): Promise<StoredFile>;
  listFiles(folderId: string): Promise<StoredFile[]>;
  /** The file bytes as a fetch Response, for the API to stream to the browser. */
  download(fileId: string): Promise<globalThis.Response>;
  /** Moves a file between two folders of the same storage. */
  move(fileId: string, fromFolderId: string, toFolderId: string): Promise<void>;
  /** Recoverable removal (Drive trash / S3 versioned delete). */
  trash(fileId: string): Promise<void>;
}

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

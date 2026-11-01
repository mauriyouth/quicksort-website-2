import type { StorageRoot } from "./storage/types.ts";

/**
 * Folder layout. document_types.folder holds the code; the label is the
 * storage folder name. Numbered prefixes keep Drive sorted the way people
 * read a file: contract first, exit papers last.
 *
 *   <clients root>/<Client>/<Contract>/01_Contrat …          project documents
 *   <clients root>/<Client>/_Societe                          client documents
 *   <people root>/<NOM Prénom> – <id>/01_Identite …           person documents
 *   <people root>/<NOM Prénom> – <id>/07_Justificatifs        Navigo, mutuelle and other proofs
 *   <people root>/<NOM Prénom> – <id>/07_Justificatifs/Navigo/2025   see YEARLY_SUBFOLDERS
 *   <people root>/<NOM Prénom> – <id>/08_Bulletins_de_paie/2025     see YEAR_ONLY_SUBFOLDERS
 */
export const FOLDER_LABELS: Record<string, string> = {
  contrat: "01_Contrat",
  annexes: "02_Annexes_Avenants",
  commandes: "03_Bons_de_commande",
  societe: "_Societe",
  identite: "01_Identite",
  securite_sociale: "02_Securite_sociale",
  contrat_travail: "03_Contrat_travail",
  administratif: "04_Administratif",
  sante: "05_Sante",
  diplomes: "06_Diplomes_Certifications",
  justificatifs: "07_Justificatifs",
  bulletins: "08_Bulletins_de_paie",
  sortie: "99_Sortie",
  divers: "99_Divers",
};

/**
 * Types filed one level deeper, by year: 07_Justificatifs/Navigo/2025. The
 * year is the period the proof covers (valid from), else its issue date, else
 * the year it was uploaded.
 */
export const YEARLY_SUBFOLDERS: Record<string, string> = {
  TRANSPORT_PASS: "Navigo",
};

/** Types filed by period year directly under their folder: 08_Bulletins_de_paie/2025. */
export const YEAR_ONLY_SUBFOLDERS = new Set(["PAYSLIP"]);

export function datedSubfolder(typeCode: string, dates: { validFrom?: string | null; issuedOn?: string | null }, today = new Date()): string[] {
  const name = YEARLY_SUBFOLDERS[typeCode];
  if (!name && !YEAR_ONLY_SUBFOLDERS.has(typeCode)) return [];
  const year = (dates.validFrom || dates.issuedOn)?.slice(0, 4) || String(today.getFullYear());
  return name ? [name, year] : [year];
}

/** Drive allows "/" inside a name; the team names contract folders "<Client>/<Contract>". */
const cleanPart = (value: string) => value.replace(/\s+/g, " ").replace(/^\/+|\/+$/g, "").trim();

export const contractFolderName = (clientName: string, title: string) =>
  (`${cleanPart(clientName)}/${cleanPart(title)}`.slice(0, 200).trim()) || "Contract";

/** Names change; the short id keeps two homonyms apart and the folder findable. */
export const personFolderName = (fullName: string, personId: string) => {
  const parts = cleanPart(fullName).replace(/\//g, "-").split(" ").filter(Boolean);
  const last = parts.length > 1 ? parts.pop()!.toUpperCase() : "";
  return `${[last, ...parts].filter(Boolean).join(" ") || "Collaborateur"} – ${personId.slice(0, 8)}`.slice(0, 200);
};

export type FolderOwner =
  | { kind: "project"; clientName: string; projectTitle: string }
  | { kind: "client"; clientName: string }
  | { kind: "person"; fullName: string; personId: string };

/** Root and nested path for an owner's folder; folderCode "" is the owner's own folder. */
export function folderPath(owner: FolderOwner, folderCode: string): { root: StorageRoot; path: string[] } {
  const leaf = folderCode ? [FOLDER_LABELS[folderCode] ?? FOLDER_LABELS.divers] : [];
  if (owner.kind === "project") return { root: "clients", path: [contractFolderName(owner.clientName, owner.projectTitle), ...leaf] };
  // Every client-level document (Kbis, NDA, contrat-cadre…) lives in _Societe.
  if (owner.kind === "client") return { root: "clients", path: [cleanPart(owner.clientName) || "Client", ...(folderCode ? [FOLDER_LABELS.societe] : [])] };
  return { root: "people", path: [personFolderName(owner.fullName, owner.personId), ...leaf] };
}

/** Lowercase ASCII words joined by "_", cut at a word boundary when longer than `max`. */
const slugify = (value: string, max: number) => {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const boundary = cut.lastIndexOf("_");
  return boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, max);
};

/** Catch-all types say nothing about the file, so their name comes from the document's title. */
const GENERIC_TYPES = new Set(["OTHER", "JUSTIF_OTHER"]);

/**
 * "<owner>_<what>.<ext>" so a file's name says whose it is and what it is,
 * whatever folder it sits in: amadou_ngam_carte_vitale.pdf, or for an "Autre"
 * document aicha_bouzid_attestation_employeur_26_10_2026.pdf.
 */
export function documentFileName(typeCode: string, ownerName: string, originalName: string, title?: string) {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(originalName)?.[1]?.toLowerCase();
  const owner = slugify(ownerName, 80);
  const described = GENERIC_TYPES.has(typeCode)
    ? slugify(title || "", 60) || slugify(originalName.replace(/\.[^.]*$/, ""), 60)
    : "";
  return `${owner || "document"}_${described || typeCode.toLowerCase()}${ext ? `.${ext}` : ""}`;
}

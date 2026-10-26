export function isLinkedInUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["linkedin.com", "www.linkedin.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}
export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function validateFile(
  file: { size: number; type: string },
  pdfOnly = false,
) {
  const allowed = pdfOnly
    ? ["application/pdf"]
    : [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];
  if (file.size === 0 || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a non-empty file up to 10 MB.");
  if (!allowed.includes(file.type))
    throw new Error(
      pdfOnly
        ? "Choose a PDF contract."
        : "Choose a PDF, JPG, PNG or DOCX file.",
    );
}

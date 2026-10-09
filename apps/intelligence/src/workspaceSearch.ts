export type WorkspaceSearchEntry = {
  id: string;
  label: string;
  detail: string;
  keywords: string;
};

const searchableText = (entry: WorkspaceSearchEntry) => `${entry.label} ${entry.detail} ${entry.keywords}`.toLocaleLowerCase();

export function filterWorkspaceSearch<T extends WorkspaceSearchEntry>(entries: T[], query: string, limit = 12): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries.slice(0, limit);

  const terms = normalized.split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => terms.every((term) => searchableText(entry).includes(term)))
    .sort((left, right) => {
      const leftLabel = left.label.toLocaleLowerCase();
      const rightLabel = right.label.toLocaleLowerCase();
      const leftRank = leftLabel === normalized ? 0 : leftLabel.startsWith(normalized) ? 1 : 2;
      const rightRank = rightLabel === normalized ? 0 : rightLabel.startsWith(normalized) ? 1 : 2;
      return leftRank - rightRank || left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

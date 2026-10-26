export const portraitBackground = "#b9b6ad";

// Finished photographs include the refined edges, shared background and approved
// exposure corrections. Vite hashes the URLs whenever a photograph changes.
const portraitAssets = import.meta.glob<string>("../assets/team-portraits/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

export const teamPortraits: Record<string, string> = Object.fromEntries(
  Object.entries(portraitAssets).map(([path, url]) => [
    path.split("/").pop()!.replace(".webp", ""),
    url,
  ]),
);

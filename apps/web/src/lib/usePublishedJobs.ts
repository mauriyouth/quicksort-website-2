import { useCallback, useEffect, useState } from "react";
import { publicDb, type Job } from "@quicksort/db";
export function usePublishedJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!publicDb) {
        if (active) {
          setError("Job listings are temporarily unavailable.");
          setLoading(false);
        }
        return;
      }
      try {
        const { data, error } = await publicDb
          .from("jobs")
          .select("*")
          .eq("published", true)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (active) {
          setJobs(data || []);
          setError("");
        }
      } catch {
        if (active) {
          setJobs([]);
          setError(
            "We couldn’t load the latest opportunities. Please try again.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 60000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [retry]);
  return { jobs, loading, error, refresh };
}

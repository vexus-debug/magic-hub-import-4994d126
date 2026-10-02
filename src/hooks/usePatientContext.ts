import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";

/**
 * Shared patient context carried in the URL as `?patientId=`.
 * Lets every clinical page lock onto the same patient without re-selecting.
 */
export function usePatientContext() {
  const [searchParams, setSearchParams] = useSearchParams();
  const patientId = searchParams.get("patientId") || "";

  const setPatientId = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("patientId", id);
          else next.delete("patientId");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** Read and clear a one-shot flag such as `?new=1`. */
  const consumeFlag = useCallback(
    (key: string) => {
      if (searchParams.get(key) !== "1") return false;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(key);
          return next;
        },
        { replace: true },
      );
      return true;
    },
    [searchParams, setSearchParams],
  );

  return { patientId, setPatientId, searchParams, consumeFlag };
}

/** Builds clinic-scoped links that keep the patient locked in the URL. */
export function useClinicLinks() {
  const { slug } = useParams();
  const base = `/clinic/${slug}`;
  return useCallback(
    (page: string, patientId?: string | null, extra?: Record<string, string>) => {
      const qs = new URLSearchParams();
      if (patientId) qs.set("patientId", patientId);
      Object.entries(extra || {}).forEach(([k, v]) => qs.set(k, v));
      const q = qs.toString();
      if (page === "patient" && patientId) return `${base}/patients/${patientId}`;
      return `${base}/${page}${q ? `?${q}` : ""}`;
    },
    [base],
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { toast } from "@/hooks/use-toast";

const today = () => new Date().toISOString().split("T")[0];

/** Suggested procedure for each charted condition (null = nothing to treat). */
export const conditionProcedure: Record<string, { label: string; keywords: string[] } | null> = {
  healthy: null,
  treated: null,
  erupting: null,
  decayed: { label: "Filling", keywords: ["filling", "restoration", "composite", "amalgam"] },
  root_canal: { label: "Root Canal Treatment", keywords: ["root canal", "endodont", "rct"] },
  crowned: { label: "Crown", keywords: ["crown"] },
  missing: { label: "Implant / Bridge", keywords: ["implant", "bridge"] },
  impacted: { label: "Surgical Extraction", keywords: ["extraction", "surgical"] },
  fractured: { label: "Repair / Crown", keywords: ["crown", "repair", "bonding"] },
  sensitive: { label: "Desensitising Treatment", keywords: ["sensitiv", "fluoride", "desensit"] },
  rotated: { label: "Orthodontic Assessment", keywords: ["ortho", "brace", "aligner"] },
  bridged: { label: "Bridge", keywords: ["bridge"] },
  veneer: { label: "Veneer", keywords: ["veneer"] },
  implant: { label: "Implant", keywords: ["implant"] },
  other: { label: "Procedure", keywords: [] },
};

export function matchCatalogTreatment(
  condition: string,
  treatments: { id: string; name: string; price: number }[],
) {
  const rule = conditionProcedure[condition];
  if (!rule) return null;
  for (const kw of rule.keywords) {
    const t = treatments.find((tr) => tr.name.toLowerCase().includes(kw));
    if (t) return t;
  }
  return null;
}

/** Adds a charted tooth procedure to the patient's active plan, creating one if needed. */
export function useAddChartItemToPlan() {
  const qc = useQueryClient();
  const { currentOrg } = useOrg();
  return useMutation({
    mutationFn: async (input: {
      patient_id: string;
      tooth_number: number;
      description: string;
      treatment_id?: string | null;
      estimated_cost: number;
    }) => {
      const db = supabase as any;
      const { data: existing, error: findErr } = await db
        .from("treatment_plans")
        .select("id, total_estimated_cost, treatment_plan_items(id)")
        .eq("org_id", currentOrg?.org_id)
        .eq("patient_id", input.patient_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      if (findErr) throw findErr;

      let plan = existing?.[0];
      if (!plan) {
        const userId = (await supabase.auth.getUser()).data.user?.id;
        const { data: created, error } = await db
          .from("treatment_plans")
          .insert({
            org_id: currentOrg?.org_id,
            patient_id: input.patient_id,
            plan_name: `Treatment plan — ${today()}`,
            description: "Created from dental charting",
            priority: "normal",
            start_date: today(),
            total_estimated_cost: 0,
            created_by: userId,
          })
          .select("id, total_estimated_cost")
          .single();
        if (error) throw error;
        plan = { ...created, treatment_plan_items: [] };
      }

      const { error: itemErr } = await db.from("treatment_plan_items").insert({
        plan_id: plan.id,
        treatment_id: input.treatment_id || null,
        description: input.description,
        tooth_number: String(input.tooth_number),
        visit_number: (plan.treatment_plan_items?.length || 0) + 1,
        estimated_cost: input.estimated_cost,
      });
      if (itemErr) throw itemErr;

      await db
        .from("treatment_plans")
        .update({ total_estimated_cost: Number(plan.total_estimated_cost || 0) + input.estimated_cost })
        .eq("id", plan.id);
      return plan.id as string;
    },
    onSuccess: (_id, v) => {
      qc.invalidateQueries({ queryKey: ["treatment-plans"] });
      qc.invalidateQueries({ queryKey: ["treatment-plan-items"] });
      qc.invalidateQueries({ queryKey: ["patient-plan-items", v.patient_id] });
      toast({ title: "Added to treatment plan", description: `${v.description} · tooth #${v.tooth_number}` });
    },
    onError: (e: any) => toast({ title: "Could not add to plan", description: e.message, variant: "destructive" }),
  });
}

export interface PatientPlanItem {
  id: string;
  plan_id: string;
  treatment_id: string | null;
  description: string;
  tooth_number: string | null;
  estimated_cost: number;
  status: string;
  completed_date: string | null;
  plan_name: string;
}

/** All open/today-completed plan items for a patient (used by the visit hand-off). */
export function usePatientPlanItems(patientId?: string | null) {
  const { currentOrg } = useOrg();
  return useQuery({
    queryKey: ["patient-plan-items", patientId],
    enabled: !!patientId && !!currentOrg?.org_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("treatment_plan_items")
        .select("*, treatment_plans!inner(plan_name, patient_id, org_id, status)")
        .eq("treatment_plans.patient_id", patientId)
        .eq("treatment_plans.org_id", currentOrg?.org_id)
        .order("visit_number", { ascending: true });
      if (error) throw error;
      return (data || [])
        .filter((i: any) => i.status !== "skipped" && (i.status !== "completed" || i.completed_date === today()))
        .map((i: any) => ({ ...i, plan_name: i.treatment_plans?.plan_name || "Plan" })) as PatientPlanItem[];
    },
  });
}

/** Prescriptions written for the patient today. */
export function useTodaysPrescriptions(patientId?: string | null) {
  const { currentOrg } = useOrg();
  return useQuery({
    queryKey: ["prescriptions", "today", patientId],
    enabled: !!patientId && !!currentOrg?.org_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prescriptions")
        .select("*, staff(full_name), prescription_medications(*)")
        .eq("org_id", currentOrg?.org_id)
        .eq("patient_id", patientId)
        .gte("created_at", `${today()}T00:00:00`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useCompletePlanItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await (supabase as any)
        .from("treatment_plan_items")
        .update({ status: "completed", completed_date: today() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["treatment-plans"] });
      qc.invalidateQueries({ queryKey: ["treatment-plan-items"] });
      qc.invalidateQueries({ queryKey: ["patient-plan-items"] });
    },
  });
}

/** Check an appointment straight into today's queue with chair carried over. */
export function useCheckInAppointment() {
  const qc = useQueryClient();
  const { currentOrg } = useOrg();
  return useMutation({
    mutationFn: async (appt: { id: string; patient_id: string; chair?: string | null; notes?: string | null }) => {
      const db = supabase as any;
      const { data: existing } = await db
        .from("waiting_list")
        .select("id")
        .eq("appointment_id", appt.id)
        .gte("created_at", `${today()}T00:00:00`)
        .limit(1);
      if (existing?.length) return existing[0].id as string;
      const { data, error } = await db
        .from("waiting_list")
        .insert({
          org_id: currentOrg?.org_id,
          patient_id: appt.patient_id,
          appointment_id: appt.id,
          chair: appt.chair || null,
          notes: appt.notes || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["waiting-list"] });
      toast({ title: "Patient checked in", description: "Added to today's waiting list." });
    },
    onError: (e: any) => toast({ title: "Check-in failed", description: e.message, variant: "destructive" }),
  });
}

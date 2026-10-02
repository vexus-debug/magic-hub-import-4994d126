import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Receipt, Pill, CalendarPlus, Printer, Plus, CheckCircle2 } from "lucide-react";
import { useTreatments } from "@/hooks/useTreatments";
import { usePatientPlanItems, useTodaysPrescriptions, useCompletePlanItems } from "@/hooks/useVisitFlow";
import { CreateInvoiceDialog } from "@/components/dashboard/CreateInvoiceDialog";
import { CreatePrescriptionDialog } from "@/components/dashboard/CreatePrescriptionDialog";
import { BookAppointmentDialog } from "@/components/dashboard/BookAppointmentDialog";
import { printPrescription } from "@/lib/printPrescription";
import { useOrg } from "@/hooks/useOrg";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string | null | undefined;
  patientName?: string;
  /** Treatment booked on the appointment, auto-included in the bill. */
  appointmentTreatmentId?: string | null;
}

const naira = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

/** End-of-visit hand-off: review billables, attach prescriptions, send to billing, book recall. */
export function VisitCompletionDialog({ open, onOpenChange, patientId, patientName, appointmentTreatmentId }: Props) {
  const { currentOrg } = useOrg();
  const { data: treatments = [] } = useTreatments();
  const { data: planItems = [] } = usePatientPlanItems(open ? patientId : null);
  const { data: prescriptions = [] } = useTodaysPrescriptions(open ? patientId : null);
  const completeItems = useCompletePlanItems();

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [includeAppt, setIncludeAppt] = useState(true);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [invoiceTreatmentIds, setInvoiceTreatmentIds] = useState<string[]>([]);

  // Pre-tick everything completed today.
  useEffect(() => {
    if (!open) return;
    setSelectedItems(new Set(planItems.filter((i) => i.status === "completed").map((i) => i.id)));
    setIncludeAppt(true);
  }, [open, planItems.length]);

  const apptTreatment = treatments.find((t) => t.id === appointmentTreatmentId);
  const toggle = (id: string) =>
    setSelectedItems((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selected = planItems.filter((i) => selectedItems.has(i.id));
  const total = useMemo(
    () => selected.reduce((s, i) => s + Number(i.estimated_cost || 0), 0) + (includeAppt && apptTreatment ? Number(apptTreatment.price || 0) : 0),
    [selected, includeAppt, apptTreatment],
  );
  const unlinked = selected.filter((i) => !i.treatment_id);

  const sendToBilling = async () => {
    const pending = selected.filter((i) => i.status !== "completed").map((i) => i.id);
    if (pending.length) await completeItems.mutateAsync(pending);
    const ids = selected.map((i) => i.treatment_id).filter(Boolean) as string[];
    if (includeAppt && appointmentTreatmentId && !ids.includes(appointmentTreatmentId)) ids.unshift(appointmentTreatmentId);
    setInvoiceTreatmentIds(ids);
    setInvoiceOpen(true);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-secondary" /> Finish visit
            </SheetTitle>
            <SheetDescription>{patientName ? `Wrap up ${patientName}'s visit.` : "Wrap up this visit."} Review what to bill, then send to billing.</SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-5">
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billable items</h4>
              {apptTreatment && (
                <label className="flex items-start gap-3 rounded-lg border border-border/40 p-3 cursor-pointer">
                  <Checkbox checked={includeAppt} onCheckedChange={(v) => setIncludeAppt(!!v)} />
                  <div className="flex-1 text-sm">
                    <p className="font-medium">{apptTreatment.name}</p>
                    <p className="text-xs text-muted-foreground">Booked treatment</p>
                  </div>
                  <span className="text-sm font-semibold">{naira(apptTreatment.price)}</span>
                </label>
              )}
              {planItems.length === 0 && !apptTreatment && (
                <p className="text-sm text-muted-foreground rounded-lg bg-muted/30 p-3">No treatment plan items for this patient yet. You can still add items on the invoice.</p>
              )}
              {planItems.map((i) => (
                <label key={i.id} className="flex items-start gap-3 rounded-lg border border-border/40 p-3 cursor-pointer">
                  <Checkbox checked={selectedItems.has(i.id)} onCheckedChange={() => toggle(i.id)} />
                  <div className="flex-1 text-sm min-w-0">
                    <p className="font-medium truncate">
                      {i.description}
                      {i.tooth_number ? <span className="text-muted-foreground font-normal"> · #{i.tooth_number}</span> : null}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant={i.status === "completed" ? "secondary" : "outline"} className="text-[10px] capitalize">
                        {i.status === "completed" ? "Done today" : i.status}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground truncate">{i.plan_name}</span>
                    </div>
                  </div>
                  <span className="text-sm font-semibold">{naira(i.estimated_cost)}</span>
                </label>
              ))}
              {selected.some((i) => i.status !== "completed") && (
                <p className="text-[11px] text-muted-foreground">Ticked items not yet done will be marked completed.</p>
              )}
              {unlinked.length > 0 && (
                <p className="text-[11px] text-amber-600">{unlinked.length} item(s) aren't linked to a catalog treatment — add them on the invoice manually.</p>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prescriptions today</h4>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRxOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" /> Write Rx
                </Button>
              </div>
              {prescriptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">None written during this visit.</p>
              ) : (
                prescriptions.map((rx: any) => (
                  <div key={rx.id} className="flex items-start gap-3 rounded-lg bg-muted/30 p-3 text-sm">
                    <Pill className="h-4 w-4 text-secondary mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {(rx.prescription_medications || []).map((m: any) => m.medication_name || m.name).join(", ") || "Prescription"}
                      </p>
                      <p className="text-xs text-muted-foreground">{rx.staff?.full_name || ""}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Print prescription"
                      onClick={() =>
                        printPrescription(
                          {
                            patientName: patientName || "Patient",
                            clinicianName: rx.staff?.full_name || "",
                            date: rx.prescription_date,
                            diagnosis: rx.diagnosis,
                            notes: rx.notes,
                            medications: (rx.prescription_medications || []).map((m: any) => ({ name: m.medication_name || m.name, dosage: m.dosage, frequency: m.frequency, duration: m.duration })),
                          },
                          currentOrg?.org_name,
                        )
                      }
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </section>

            <Separator />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimated total</span>
              <span className="text-lg font-bold">{naira(total)}</span>
            </div>

            <div className="grid gap-2">
              <Button className="bg-secondary hover:bg-secondary/90" onClick={sendToBilling} disabled={completeItems.isPending}>
                <Receipt className="h-4 w-4 mr-2" /> Send to billing
              </Button>
              <Button variant="outline" onClick={() => setRecallOpen(true)}>
                <CalendarPlus className="h-4 w-4 mr-2" /> Book next appointment
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Done for now</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {patientId && (
        <>
          <CreateInvoiceDialog
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            preselectedPatientId={patientId}
            preselectedTreatmentIds={invoiceTreatmentIds.length ? invoiceTreatmentIds : undefined}
          />
          <CreatePrescriptionDialog open={rxOpen} onOpenChange={setRxOpen} preselectedPatientId={patientId} />
          <BookAppointmentDialog open={recallOpen} onOpenChange={setRecallOpen} preselectedPatientId={patientId} />
        </>
      )}
    </>
  );
}

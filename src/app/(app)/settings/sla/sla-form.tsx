"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { TicketPriority } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { saveSlaTargets } from "./actions";

// Minimal inline priority label — NOT the shared PriorityChip component (that component is
// built by plan 02-06, which this plan does not depend on and may not exist in this
// worktree/wave yet). Token classes mirror the UI-SPEC PriorityChip table exactly so the
// visual result matches once 02-06 lands.
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};
const PRIORITY_CLASSES: Record<TicketPriority, string> = {
  LOW: "border border-border text-muted-foreground",
  NORMAL: "border border-border text-foreground",
  HIGH: "bg-warning/10 text-warning border border-warning/20",
  URGENT: "bg-destructive/10 text-destructive border border-destructive/20",
};

const rowSchema = z.object({
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  firstResponseHours: z.number().positive("Must be greater than 0"),
  resolutionHours: z.number().positive("Must be greater than 0"),
});

const formSchema = z.object({
  rows: z.array(rowSchema).length(4),
});

type FormValues = z.infer<typeof formSchema>;

interface SlaFormRow {
  priority: TicketPriority;
  firstResponseHours: number;
  resolutionHours: number;
}

interface SlaFormProps {
  initialRows: SlaFormRow[];
}

export function SlaForm({ initialRows }: SlaFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { rows: initialRows },
  });

  async function onSubmit(values: FormValues) {
    const result = await saveSlaTargets(values.rows).catch(() => null);
    if (result?.ok) {
      toast.success("SLA targets saved.");
    } else {
      toast.error("Failed to save SLA targets. Please try again.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="divide-y divide-border rounded-lg border border-border/70">
          {initialRows.map((row, index) => (
            <div key={row.priority} className="flex flex-wrap items-center gap-4 p-4">
              <input type="hidden" {...form.register(`rows.${index}.priority`)} />
              <Badge className={cn("w-20 justify-center", PRIORITY_CLASSES[row.priority])}>
                {PRIORITY_LABELS[row.priority]}
              </Badge>

              <FormField
                control={form.control}
                name={`rows.${index}.firstResponseHours`}
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormLabel className="w-36 shrink-0 text-[13px] font-normal text-muted-foreground">
                      First response (hours)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        className="w-24"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name={`rows.${index}.resolutionHours`}
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormLabel className="w-36 shrink-0 text-[13px] font-normal text-muted-foreground">
                      Resolution (hours)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        className="w-24"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          ))}
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Save SLA Targets
        </Button>
      </form>
    </Form>
  );
}

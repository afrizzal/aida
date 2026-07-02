"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { PriorityChip } from "@/components/tickets/priority-chip";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { TicketPriority } from "@/generated/prisma/client";
import { saveSlaTargets } from "./actions";

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
              <PriorityChip priority={row.priority} className="w-20 justify-center" />

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

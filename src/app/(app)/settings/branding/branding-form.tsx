"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MAX_WORKSPACE_NAME_LENGTH } from "@/lib/branding/settings";
import { saveBranding } from "./actions";

const formSchema = z.object({
  workspaceName: z
    .string()
    .max(
      MAX_WORKSPACE_NAME_LENGTH,
      `Workspace name must be ${MAX_WORKSPACE_NAME_LENGTH} characters or fewer.`,
    ),
});

type FormValues = z.infer<typeof formSchema>;

interface BrandingFormProps {
  initialWorkspaceName: string;
  orgName: string;
  canEdit: boolean;
}

/**
 * Settings > Branding tab's client form — mirrors EmailSettingsForm's/SlaForm's
 * react-hook-form + zod + Server Action + toast shape. D-16 name-only scope: exactly one
 * field. The preview block reproduces sidebar.tsx's brand mark verbatim so an admin sees the
 * result before saving.
 */
export function BrandingForm({ initialWorkspaceName, orgName, canEdit }: BrandingFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { workspaceName: initialWorkspaceName },
  });

  const previewName = form.watch("workspaceName")?.trim() || orgName;

  async function onSubmit(values: FormValues) {
    const result = await saveBranding({ workspaceName: values.workspaceName }).catch(() => null);
    if (result?.ok) {
      toast.success("Branding saved.");
    } else {
      toast.error(result?.error ?? "Failed to save branding. Please try again.");
    }
  }

  return (
    <Card className="border-border/70 p-4 shadow-sm">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="workspaceName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[13px] font-normal text-muted-foreground">
                  Workspace name
                </FormLabel>
                <FormControl>
                  <Input
                    maxLength={MAX_WORKSPACE_NAME_LENGTH}
                    placeholder={orgName}
                    disabled={!canEdit}
                    {...field}
                  />
                </FormControl>
                <p className="text-[12px] text-muted-foreground">
                  Shown in the sidebar, on your public request page, on your public status page, and
                  as the from-name on outbound email.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar px-4 py-3">
            <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary shadow-sm">
              <Sparkles className="size-4 text-sidebar-primary-foreground" />
            </div>
            <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground">
              {previewName}
            </span>
          </div>

          {canEdit ? (
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Only workspace admins can change branding.
            </p>
          )}
        </form>
      </Form>
    </Card>
  );
}

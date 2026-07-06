"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { EmailSettingsInput } from "./actions";
import { saveEmailSettings } from "./actions";
import { EmailHealthLine } from "./email-health-line";
import { TestConnectionButton } from "./test-connection-button";

const formSchema = z.object({
  fromAddress: z.string().email("Valid email address is required"),
  imapHost: z.string().min(1, "Required"),
  imapPort: z.string().min(1, "Required"),
  imapSecure: z.boolean(),
  imapUser: z.string().min(1, "Required"),
  imapPassword: z.string().optional(),
  smtpHost: z.string().min(1, "Required"),
  smtpPort: z.string().min(1, "Required"),
  smtpSecure: z.boolean(),
  smtpUser: z.string().min(1, "Required"),
  smtpPassword: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface EmailSettingsFormProps {
  initial: Omit<EmailSettingsInput, "imapPassword" | "smtpPassword">;
  health: { lastPollAt: string | null; lastPollError: string | null };
}

/**
 * The Email tab's client form — IMAP/SMTP/from-address fields + save, mirroring SlaForm's
 * react-hook-form + zod + Server Action + toast shape exactly. Password fields always start
 * blank: plan 02's saveEmailSettings treats an empty password as "keep existing stored value",
 * so the decrypted password is never round-tripped into this form.
 */
export function EmailSettingsForm({ initial, health }: EmailSettingsFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { ...initial, imapPassword: "", smtpPassword: "" },
  });

  async function onSubmit(values: FormValues) {
    const result = await saveEmailSettings(values).catch(() => null);
    if (result?.ok) {
      toast.success("Email settings saved.");
    } else {
      toast.error("Failed to save email settings. Please try again.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4 rounded-lg border border-border/70 p-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            IMAP (Inbound)
          </p>

          <EmailHealthLine {...health} />

          <div className="space-y-4">
            <FormField
              control={form.control}
              name="imapHost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Host
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imapPort"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Port
                  </FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="993" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imapSecure"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Use SSL/TLS
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imapUser"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Username
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="imapPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Password
                  </FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <TestConnectionButton kind="imap" getValues={() => form.getValues() as EmailSettingsInput} />
        </div>

        <div className="space-y-4 rounded-lg border border-border/70 p-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            SMTP (Outbound)
          </p>

          <div className="space-y-4">
            <FormField
              control={form.control}
              name="smtpHost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Host
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="smtpPort"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Port
                  </FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="587" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="smtpSecure"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Use SSL/TLS
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="smtpUser"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Username
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="smtpPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[13px] font-normal text-muted-foreground">
                    Password
                  </FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <TestConnectionButton kind="smtp" getValues={() => form.getValues() as EmailSettingsInput} />
        </div>

        <FormField
          control={form.control}
          name="fromAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[13px] font-normal text-muted-foreground">
                From address
              </FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <p className="text-[12px] text-muted-foreground">
                The address customers see and reply to. Must match your SMTP account or an
                address it&apos;s authorized to send as.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save email settings
        </Button>
      </form>
    </Form>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { HoneypotField } from "@/components/public/honeypot-field";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";

const requestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email address is required"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(1, "Message is required"),
});

type RequestFormValues = z.infer<typeof requestSchema>;

type IntakeResult = { ok: boolean; token: string | null };

export function RequestForm() {
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { name: "", email: "", subject: "", message: "" },
  });
  const { isSubmitting } = form.formState;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);

  // Client-side pre-check only (UX convenience) — the server always re-validates
  // size + does real byte-sniffed MIME detection via `file-type` (never trust this).
  function validateFiles(files: FileList | null): boolean {
    if (!files || files.length === 0) {
      setFileNames([]);
      setFileError(null);
      return true;
    }
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setFileError(`"${file.name}" is larger than 10MB.`);
        return false;
      }
      if (file.type && !ALLOWED_MIME.has(file.type)) {
        setFileError(`"${file.name}" is not an allowed file type.`);
        return false;
      }
    }
    setFileError(null);
    setFileNames(Array.from(files).map((f) => f.name));
    return true;
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    validateFiles(event.target.files);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const { files } = event.dataTransfer;
    if (fileInputRef.current) fileInputRef.current.files = files;
    validateFiles(files);
  }

  async function onSubmit(_values: RequestFormValues, event?: { target?: EventTarget }) {
    if (fileError) return;
    setRateLimited(false);

    const formEl = event?.target as HTMLFormElement | undefined;
    if (!formEl) return;
    // The native form already carries name/email/subject/message (registered by
    // react-hook-form onto these inputs), the honeypot field, and any selected
    // files — one FormData covers the whole multipart POST.
    const body = new FormData(formEl);

    const res = await fetch("/api/public/intake", { method: "POST", body });

    if (res.status === 429) {
      setRateLimited(true);
      return;
    }
    if (!res.ok) {
      form.setError("root", { message: "Something went wrong. Please try again." });
      return;
    }

    const data = (await res.json()) as IntakeResult;
    setResult(data);
  }

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-[18px] font-semibold">Request received</h2>
        <p className="text-[14px] text-muted-foreground">
          We've sent a confirmation with a link to track your request.
        </p>
        {result.token && (
          <Button asChild className="w-full">
            <a href={`/status/${result.token}`}>View status</a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 space-y-1">
        <h1 className="text-[18px] font-semibold tracking-tight">Submit a request</h1>
        <p className="text-[14px] text-muted-foreground">
          Tell us what's going on and we'll get back to you.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <HoneypotField />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="Jane Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Subject</FormLabel>
                <FormControl>
                  <Input placeholder="Brief summary of your issue" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-[120px]"
                    placeholder="Describe your issue in detail..."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-2">
            <span className="text-[14px] font-medium leading-none">Attachments (optional)</span>
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="w-full cursor-pointer rounded-lg border-2 border-dashed border-border p-4 text-center text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {fileNames.length > 0 ? (
                <span>{fileNames.join(", ")}</span>
              ) : (
                <span>Drag files here, or click to attach (max 10MB each)</span>
              )}
            </button>
            {fileError && <p className="text-[12px] text-destructive">{fileError}</p>}
          </div>

          {rateLimited && (
            <p className="text-[13px] text-destructive">
              You've submitted a few requests recently. Please wait a bit before trying again.
            </p>
          )}

          {form.formState.errors.root && (
            <p className="text-[14px] text-destructive">{form.formState.errors.root.message}</p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Request
          </Button>
        </form>
      </Form>
    </>
  );
}

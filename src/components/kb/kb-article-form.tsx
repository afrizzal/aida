"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { createKbArticleAction, updateKbArticleAction } from "@/app/(app)/kb/actions";
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

const formSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(120, "Title must be at most 120 characters"),
  bodyMarkdown: z.string().min(1, "Body is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface KbArticleFormProps {
  mode: "create" | "edit";
  articleId?: string;
  initial?: { title: string; bodyMarkdown: string };
}

/**
 * Authoring form for create + edit — always routes writes through the admin-gated
 * createKbArticleAction/updateKbArticleAction (kb/actions.ts), which delegate every
 * chunk/embed concern to lib/kb/create-article (05-03). Mirrors sla-form.tsx's
 * react-hook-form + zod/v4 + shadcn Form shape.
 */
export function KbArticleForm({ mode, articleId, initial }: KbArticleFormProps) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial ?? { title: "", bodyMarkdown: "" },
  });

  async function onSubmit(values: FormValues) {
    if (mode === "create") {
      const result = await createKbArticleAction(values).catch(() => null);
      if (!result?.ok || !result.id) {
        toast.error("Couldn't create the article. Try again.");
        return;
      }
      toast.success("Article created.");
      router.push(`/kb/${result.id}`);
      return;
    }

    if (!articleId) return;
    const result = await updateKbArticleAction(articleId, values).catch(() => null);
    if (!result?.ok) {
      toast.error("Couldn't save the article. Try again.");
      return;
    }
    toast.success("Article saved.");
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="How to reset your password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="bodyMarkdown"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Body (Markdown)</FormLabel>
              <FormControl>
                <Textarea
                  className="min-h-[240px] text-[13px]"
                  placeholder={"# Heading\n\nWrite the article body in Markdown…"}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {mode === "create" ? "Create article" : "Save changes"}
          </Button>
          <p className="text-[12px] text-muted-foreground">
            Saving will (re)embed this article in the background.
          </p>
        </div>
      </form>
    </Form>
  );
}

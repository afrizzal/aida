"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
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
import { authClient } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.string().email("Valid email address is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  showSetupComplete?: boolean;
}

export function LoginForm({ showSetupComplete }: LoginFormProps) {
  const router = useRouter();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const { isSubmitting } = form.formState;

  // Show setup-complete success toast once on mount when redirected from /setup
  useEffect(() => {
    if (showSetupComplete) {
      toast.success("Workspace created. Sign in to continue.");
    }
  }, [showSetupComplete]);

  async function onSubmit(values: LoginFormValues) {
    const { error } = await authClient.signIn.email(
      { email: values.email, password: values.password },
      { throw: false },
    );

    if (error) {
      if (
        error.status === 401 ||
        error.status === 403 ||
        error.code === "INVALID_EMAIL_OR_PASSWORD"
      ) {
        form.setError("email", { message: "" }); // red border only on email
        form.setError("password", {
          message: "Invalid email or password. Please check your credentials and try again.",
        });
        return;
      }
      // Unexpected / server error
      form.setError("root", {
        message: "Something went wrong. Please try again or check /api/health.",
      });
      return;
    }

    router.push("/tickets");
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </Form>
  );
}

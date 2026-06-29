"use server";

import { redirect } from "next/navigation";
import { z } from "zod/v4";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const setupSchema = z
  .object({
    orgName: z.string().min(1, "Workspace name is required"),
    slug: z
      .string()
      .min(1, "URL slug is required")
      .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers, and hyphens"),
    adminName: z.string().min(1, "Your name is required"),
    email: z.string().email("Valid email address is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SetupInput = z.infer<typeof setupSchema>;
export type SetupResult = { error: string } | null;

export async function completeSetup(input: SetupInput): Promise<SetupResult> {
  // Server-side validation — never trust the client
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return { error: firstError?.message ?? "Invalid input. Please check all fields." };
  }

  const { orgName, slug, adminName, email, password } = parsed.data;

  // Race guard: if another request already completed setup, bail out
  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    return { error: "Setup has already been completed. Please sign in." };
  }

  // 1. Create the admin user
  const signUpResponse = await auth.api.signUpEmail({
    body: { name: adminName, email, password },
  });

  if (!signUpResponse?.user?.id) {
    return { error: "Failed to create admin account. The email may already be in use." };
  }

  const userId = signUpResponse.user.id;

  // 2. Create the organization (system action — userId bypasses allowUserToCreateOrganization: false)
  const orgResponse = await auth.api.createOrganization({
    body: { name: orgName, slug, userId },
  });

  if (!orgResponse?.id) {
    return { error: "Failed to create workspace. The URL slug may already be taken." };
  }

  // 3. Mark setup as complete globally
  await prisma.systemSetting.upsert({
    where: { key: "setupComplete" },
    update: { value: "true" },
    create: { key: "setupComplete", value: "true" },
  });

  redirect("/login?setup=complete");
}

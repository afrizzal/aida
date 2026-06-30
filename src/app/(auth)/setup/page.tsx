import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { SetupForm } from "./setup-form";

// Always server-render: reads DB at request time to check user count
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const userCount = await prisma.user.count();
  if (userCount > 0) redirect("/login");

  return (
    <Card className="w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Set up AIDA</CardTitle>
        <CardDescription>
          Create your workspace to get started. You can invite team members after setup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SetupForm />
      </CardContent>
    </Card>
  );
}

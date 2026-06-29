import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { LoginForm } from "./login-form";

// Always server-render: reads DB at request time to redirect to /setup if needed
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ setup?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const userCount = await prisma.user.count();
  if (userCount === 0) redirect("/setup");

  const params = await searchParams;
  const showSetupComplete = params.setup === "complete";

  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold">Sign in to AIDA</CardTitle>
      </CardHeader>
      <CardContent>
        <LoginForm showSetupComplete={showSetupComplete} />
      </CardContent>
    </Card>
  );
}

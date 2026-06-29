import { getScopedDb } from "@/lib/session";
import { AiToggle } from "./ai-toggle";

export default async function SettingsPage() {
  const { db } = await getScopedDb();

  const setting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  // Default false (D-18): AI is off until explicitly enabled by the operator
  const aiEnabled = setting?.value === "true";

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">AI Features</h1>
      <AiToggle defaultEnabled={aiEnabled} />
    </div>
  );
}

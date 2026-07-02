import { getScopedDb } from "@/lib/session";
import { CustomFieldManager } from "./custom-field-manager";

export default async function CustomFieldsPage() {
  const { db } = await getScopedDb();

  const definitions = await db.customFieldDefinition.findMany({ orderBy: { position: "asc" } });

  const rows = definitions.map((d) => ({
    id: d.id,
    label: d.label,
    type: d.type,
    options: Array.isArray(d.options) ? (d.options as string[]) : [],
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">Custom Fields</h1>
      <CustomFieldManager fields={rows} />
    </div>
  );
}

import { requirePageAccess } from "@/lib/page-access";
import { CustomFieldManager } from "./custom-field-manager";

export default async function CustomFieldsPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { db } = await requirePageAccess();

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

import { UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AssigneeAvatar({
  name,
  size = "sm",
}: {
  name?: string | null;
  size?: "sm" | "default";
}) {
  if (!name) {
    return (
      <div
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border"
        title="Unassigned"
      >
        <UserPlus className="size-3 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Avatar className={size === "sm" ? "size-6" : "size-8"}>
      <AvatarFallback className="bg-primary/10 text-[12px] font-medium text-primary">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

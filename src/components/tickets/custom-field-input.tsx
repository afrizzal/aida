"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { CustomFieldType } from "@/generated/prisma/client";

export interface CustomFieldInputDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
}

export type CustomFieldValue = string | number | boolean | null | undefined;

interface CustomFieldInputProps {
  definition: CustomFieldInputDefinition;
  value: CustomFieldValue;
  onChange: (value: CustomFieldValue) => void;
}

/**
 * Type-dispatching input for a single custom-field value. Presentational only — no data
 * fetching, no page coupling — so it can be reused verbatim in the ticket reading pane
 * (plan 09) for editing per-ticket CustomFieldValue rows.
 */
export function CustomFieldInput({ definition, value, onChange }: CustomFieldInputProps) {
  switch (definition.type) {
    case "TEXT":
      return (
        <Input
          aria-label={definition.label}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "NUMBER":
      return (
        <Input
          type="number"
          aria-label={definition.label}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      );

    case "CHECKBOX":
      return (
        <Checkbox
          aria-label={definition.label}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      );

    case "DATE":
      return (
        <Input
          type="date"
          aria-label={definition.label}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "SELECT": {
      const options = definition.options ?? [];
      const selected = typeof value === "string" ? value : "";

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="justify-between"
              aria-label={definition.label}
            >
              {selected || "Select…"}
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
            <DropdownMenuRadioGroup value={selected} onValueChange={(v) => onChange(v)}>
              {options.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {option}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    default:
      return null;
  }
}

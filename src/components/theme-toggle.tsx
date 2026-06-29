"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Guard against hydration mismatch — only render icon after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Render a blank placeholder with the same dimensions to avoid layout shift
    return <Button variant="ghost" size="icon" disabled aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";
  const tooltipLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={tooltipLabel}
          >
            {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

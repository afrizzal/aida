"use client";

// The command palette's shell state (Phase 11, AIDA-49, D-11, D-12, UI-SPEC Surface 4). Mounted
// once by the (app) layout around the sidebar, top bar and page; it owns the one command registry
// (src/lib/commands/registry.ts), builds the command context from the route and URL parameters
// only, registers the global commands, and renders the palette dialog once.
//
// Global command ids, referred to by the keyboard key table (11-08): nav.tickets, nav.contacts,
// nav.kb, nav.insights, nav.settings, create.ticket and view:{viewId}. Other modules add theirs
// through useRegisterCommands (the inbox's views.save; 11-08's ticket-page and list commands;
// Phase 16, AIDA-86).
//
// The keyboard dispatcher (src/components/keyboard/keyboard-dispatcher.tsx, 11-08) is mounted
// here once; this provider holds its pending chord and the help modal's open state.
//
// The views list comes from the layout, which read it through sidebarViewsOrEmpty
// (src/lib/saved-views/ui-state.ts): only the viewer's own private views and the organization's
// shared views reach the client, and a removed member gets empty lists, never a thrown
// MEMBERSHIP_ENDED (11-05, T-11-32).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type DependencyList,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommandPalette } from "@/components/command-palette";
import { ChordHint } from "@/components/keyboard/chord-hint";
import { KeyboardDispatcher } from "@/components/keyboard/keyboard-dispatcher";
import { KeyboardHelpDialog } from "@/components/keyboard/keyboard-help-dialog";
import {
  type Command,
  type CommandContext,
  type CommandIcon,
  type CommandRegistry,
  createCommandRegistry,
} from "@/lib/commands/registry";
import type { ChordState } from "@/lib/keyboard/dispatch";
import type { SidebarViews } from "@/lib/saved-views/ui-state";

interface CommandsValue {
  /** Whether the palette dialog is open. */
  open: boolean;
  setOpen(open: boolean): void;
  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
  registry: CommandRegistry;
  context: CommandContext;
  /**
   * The new-ticket dialog registers its open function while mounted; create.ticket calls it, or
   * goes to /tickets?new=1 when none is registered (UI-SPEC Assumption 11). Returns unregister.
   */
  registerNewTicketOpener(open: () => void): () => void;
  /** Whether the keyboard shortcuts help modal is open (11-08, UI-SPEC 5e). */
  helpOpen: boolean;
  setHelpOpen(open: boolean): void;
  openHelp(): void;
  /** The pending g chord of the keyboard dispatcher, or null (11-08, UI-SPEC 5d). */
  chord: ChordState | null;
}

const CommandsContext = createContext<CommandsValue | null>(null);

export function useCommands(): CommandsValue {
  const value = useContext(CommandsContext);
  if (!value) throw new Error("useCommands must be used inside CommandProvider");
  return value;
}

/**
 * Registers commands while the calling component is mounted and removes them on unmount. The
 * commands are registered again whenever a value in deps changes. A duplicate id throws.
 */
export function useRegisterCommands(commands: readonly Command[], deps: DependencyList): void {
  const { registry } = useCommands();
  const latest = useRef(commands);
  latest.current = commands;
  // The caller states the dependencies of its commands in deps; the commands are read from the
  // ref, so the effect always registers the latest ones.
  useEffect(() => {
    const unregister = latest.current.map((command) => registry.register(command));
    return () => {
      for (const remove of unregister) remove();
    };
  }, [registry, ...deps]);
}

const TICKET_ROUTE = /^\/tickets\/([^/]+)\/?$/;

/** The command context: the route and the URL parameters only, never the DOM (D-11). */
function buildContext(pathname: string, query: string): CommandContext {
  const match = TICKET_ROUTE.exec(pathname);
  const searchParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(query)) searchParams[key] = value;
  return { pathname, ticketId: match ? decodeURIComponent(match[1]) : null, searchParams };
}

/** The five sidebar routes, in sidebar order (src/components/sidebar.tsx). */
const NAVIGATION: {
  id: string;
  label: string;
  href: string;
  icon: CommandIcon;
  keywords: string[];
}[] = [
  { id: "nav.tickets", label: "Tickets", href: "/tickets", icon: "inbox", keywords: ["inbox"] },
  {
    id: "nav.contacts",
    label: "Contacts",
    href: "/contacts",
    icon: "users",
    keywords: ["customers", "people"],
  },
  {
    id: "nav.kb",
    label: "Knowledge Base",
    href: "/kb",
    icon: "book-open",
    keywords: ["articles", "kb"],
  },
  {
    id: "nav.insights",
    label: "Insight",
    href: "/insights",
    icon: "lightbulb",
    keywords: ["insights", "reports"],
  },
  {
    id: "nav.settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    keywords: ["preferences"],
  },
];

function inSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface CommandProviderProps {
  /** The viewer's own private views and the organization's shared views (AIDA-47, D-12). */
  views: SidebarViews;
  children: React.ReactNode;
}

export function CommandProvider({ views, children }: CommandProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [open, setOpen] = useState(false);
  const [registry] = useState(createCommandRegistry);
  const newTicketOpener = useRef<(() => void) | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [chord, setChord] = useState<ChordState | null>(null);

  const context = useMemo(() => buildContext(pathname, query), [pathname, query]);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((current) => !current), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  const registerNewTicketOpener = useCallback((openDialog: () => void) => {
    newTicketOpener.current = openDialog;
    return () => {
      if (newTicketOpener.current === openDialog) newTicketOpener.current = null;
    };
  }, []);

  // Go to, Create and Help: registered for the life of the shell.
  useEffect(() => {
    const commands: Command[] = NAVIGATION.map((item, index) => ({
      id: item.id,
      label: item.label,
      group: "navigation",
      keywords: item.keywords,
      order: index,
      icon: item.icon,
      // The current section is hidden (UI-SPEC 4c).
      when: (ctx) => !inSection(ctx.pathname, item.href),
      run: () => router.push(item.href),
    }));
    commands.push({
      id: "create.ticket",
      label: "Create ticket",
      group: "create",
      keywords: ["new ticket", "add"],
      order: 0,
      icon: "plus",
      when: () => true,
      run: () => {
        const openDialog = newTicketOpener.current;
        if (openDialog) openDialog();
        else router.push("/tickets?new=1");
      },
    });
    // Help: the palette closes before a command runs, so the help modal never stacks on it.
    commands.push({
      id: "help.shortcuts",
      label: "Show keyboard shortcuts",
      group: "help",
      keywords: ["keyboard", "shortcuts", "keys", "help"],
      order: 0,
      icon: "keyboard",
      when: () => true,
      run: () => setHelpOpen(true),
    });
    const unregister = commands.map((command) => registry.register(command));
    return () => {
      for (const remove of unregister) remove();
    };
  }, [registry, router]);

  // Views: private first, then shared, each in the server's position, name, id order.
  useEffect(() => {
    const listed = [
      ...views.private.map((view) => ({ view, hint: "Private" })),
      ...views.shared.map((view) => ({ view, hint: "Shared" })),
    ];
    const unregister = listed.map(({ view, hint }, index) =>
      registry.register({
        id: `view:${view.id}`,
        label: view.name,
        group: "views",
        keywords: ["view", hint.toLowerCase()],
        order: index,
        hint,
        icon: "list-filter",
        when: () => true,
        run: () => router.push(view.href),
      }),
    );
    return () => {
      for (const remove of unregister) remove();
    };
  }, [registry, router, views]);

  const value = useMemo<CommandsValue>(
    () => ({
      open,
      setOpen,
      openPalette,
      closePalette,
      togglePalette,
      registry,
      context,
      registerNewTicketOpener,
      helpOpen,
      setHelpOpen,
      openHelp,
      chord,
    }),
    [
      open,
      openPalette,
      closePalette,
      togglePalette,
      registry,
      context,
      registerNewTicketOpener,
      helpOpen,
      openHelp,
      chord,
    ],
  );

  return (
    <CommandsContext.Provider value={value}>
      {children}
      <KeyboardDispatcher setChord={setChord} openHelp={openHelp} />
      <CommandPalette open={open} onOpenChange={setOpen} registry={registry} context={context} />
      <KeyboardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ChordHint pending={chord !== null} />
    </CommandsContext.Provider>
  );
}

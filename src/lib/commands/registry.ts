// The client command registry (Phase 11, AIDA-49, D-11). Every module adds its commands here:
// the shell's Go to, Create and Views commands, the inbox's save-view command, the keyboard
// plan's ticket-page and list commands (11-08), and Phase 16's commands (AIDA-86).
//
// Rules:
// - A command has a stable id; registering an id that is already registered throws and the
//   existing command stays.
// - Context comes from the route and page state (pathname, the ticket id of a /tickets/{id}
//   route, the URL parameters), never from inspecting the DOM.
// - Groups always come out in COMMAND_GROUP_ORDER; inside a group commands sort by order, then
//   id, so the mount order of the registering components never changes what the palette shows.
// - hidden marks a command bound only to a key: the palette never lists it, while visible()
//   still returns it for the keyboard dispatcher.
//
// Plain TypeScript: no React, no DOM, so the unit tests run in the node environment.

export type CommandGroup = "this-ticket" | "tickets" | "views" | "navigation" | "create" | "help";

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "this-ticket",
  "tickets",
  "views",
  "navigation",
  "create",
  "help",
];

/** Icon names the palette maps to Lucide icons; the registry holds no component. */
export type CommandIcon =
  | "inbox"
  | "users"
  | "book-open"
  | "lightbulb"
  | "settings"
  | "plus"
  | "list-filter"
  | "bookmark-plus"
  | "keyboard"
  | "user-plus"
  | "circle-dot"
  | "tag"
  | "reply"
  | "sticky-note";

export interface CommandContext {
  pathname: string;
  /** The id of a /tickets/{id} route, else null. */
  ticketId: string | null;
  /** The current URL parameters as a plain record. */
  searchParams: Record<string, string>;
}

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  keywords: readonly string[];
  order: number;
  when(context: CommandContext): boolean;
  run(context: CommandContext): void;
  /** A short word shown at the right of the item, for example "Private" or "Shared". */
  hint?: string;
  /** Bound only to a key: never listed by the palette, still returned by visible(). */
  hidden?: boolean;
  icon?: CommandIcon;
}

export interface CommandRegistry {
  /** Adds a command; returns a function that removes exactly this command. */
  register(command: Command): () => void;
  unregister(id: string): void;
  /** Every registered command, in display order. */
  list(): Command[];
  /** Commands whose when(context) holds, in display order, hidden ones included. */
  visible(context: CommandContext): Command[];
  /** What the palette lists: visible, not hidden, then filterCommands(query). */
  paletteCommands(context: CommandContext, query: string): Command[];
  /** For React's useSyncExternalStore: called after every register and unregister. */
  subscribe(listener: () => void): () => void;
  /** Changes on every register and unregister. */
  getVersion(): number;
}

const GROUP_RANK = new Map<CommandGroup, number>(
  COMMAND_GROUP_ORDER.map((group, index) => [group, index]),
);

function compareCommands(a: Command, b: Command): number {
  const byGroup = (GROUP_RANK.get(a.group) ?? 0) - (GROUP_RANK.get(b.group) ?? 0);
  if (byGroup !== 0) return byGroup;
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Case-insensitive substring match on the label or any keyword. An empty (or blank) query
 * returns the commands unchanged.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...commands];
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  );
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();
  const listeners = new Set<() => void>();
  let version = 0;

  function notify() {
    version += 1;
    for (const listener of listeners) listener();
  }

  function list(): Command[] {
    return [...commands.values()].sort(compareCommands);
  }

  function visible(context: CommandContext): Command[] {
    return list().filter((command) => command.when(context));
  }

  return {
    register(command) {
      if (commands.has(command.id)) {
        throw new Error(`A command with the id "${command.id}" is already registered.`);
      }
      commands.set(command.id, command);
      notify();
      return () => {
        // Removes only this instance, never a later command registered under the same id.
        if (commands.get(command.id) === command) {
          commands.delete(command.id);
          notify();
        }
      };
    },
    unregister(id) {
      if (commands.delete(id)) notify();
    },
    list,
    visible,
    paletteCommands(context, query) {
      return filterCommands(
        visible(context).filter((command) => !command.hidden),
        query,
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion() {
      return version;
    },
  };
}

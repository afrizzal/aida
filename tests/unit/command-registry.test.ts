// Phase 11, plan 11-07: the command registry (AIDA-49, D-11). Plain TypeScript, no DOM.
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_GROUP_ORDER,
  type Command,
  type CommandContext,
  type CommandGroup,
  createCommandRegistry,
  filterCommands,
} from "@/lib/commands/registry";

const CONTEXT: CommandContext = { pathname: "/tickets", ticketId: null, searchParams: {} };

function command(id: string, overrides: Partial<Command> = {}): Command {
  return {
    id,
    label: id,
    group: "navigation",
    keywords: [],
    order: 0,
    when: () => true,
    run: () => {},
    ...overrides,
  };
}

const ids = (commands: readonly Command[]) => commands.map((c) => c.id);

describe("command registry", () => {
  it("register returns an unregister function that removes only that command", () => {
    const registry = createCommandRegistry();
    const unregisterA = registry.register(command("a"));
    registry.register(command("b"));
    expect(ids(registry.list())).toEqual(["a", "b"]);

    unregisterA();
    expect(ids(registry.list())).toEqual(["b"]);

    registry.unregister("b");
    expect(registry.list()).toEqual([]);
  });

  it("rejects a duplicate id and keeps the first command", () => {
    const registry = createCommandRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(command("nav.tickets", { label: "Tickets", run: first }));

    expect(() =>
      registry.register(command("nav.tickets", { label: "Other", run: second })),
    ).toThrow(/nav\.tickets/);

    const [kept] = registry.list();
    expect(kept.label).toBe("Tickets");
    kept.run(CONTEXT);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("a stale unregister function does not remove a command registered again under its id", () => {
    const registry = createCommandRegistry();
    const unregisterOld = registry.register(command("a", { label: "old" }));
    unregisterOld();
    registry.register(command("a", { label: "new" }));

    unregisterOld();
    expect(registry.list().map((c) => c.label)).toEqual(["new"]);
  });

  it("visible keeps only commands whose when(context) holds", () => {
    const registry = createCommandRegistry();
    registry.register(command("on-ticket", { when: (ctx) => ctx.ticketId !== null }));
    registry.register(
      command("off-tickets", { when: (ctx) => !ctx.pathname.startsWith("/tickets") }),
    );
    registry.register(command("always"));

    expect(ids(registry.visible(CONTEXT))).toEqual(["always"]);
    expect(
      ids(registry.visible({ pathname: "/tickets/t1", ticketId: "t1", searchParams: {} })),
    ).toEqual(["always", "on-ticket"]);
    expect(
      ids(registry.visible({ pathname: "/contacts", ticketId: null, searchParams: {} })),
    ).toEqual(["always", "off-tickets"]);
  });

  it("orders groups by COMMAND_GROUP_ORDER and, inside a group, by order then id, whatever the mount order", () => {
    expect(COMMAND_GROUP_ORDER).toEqual([
      "this-ticket",
      "tickets",
      "views",
      "navigation",
      "create",
      "help",
    ]);

    const entries: [string, CommandGroup, number][] = [
      ["help.shortcuts", "help", 0],
      ["create.ticket", "create", 0],
      ["nav.settings", "navigation", 5],
      ["nav.contacts", "navigation", 2],
      ["view:b", "views", 1],
      ["view:a", "views", 1],
      ["views.save", "views", -1],
      ["ticket.assign", "this-ticket", 0],
      ["search.extra", "tickets", 0],
    ];
    const forward = createCommandRegistry();
    for (const [id, group, order] of entries) forward.register(command(id, { group, order }));
    const backward = createCommandRegistry();
    for (const [id, group, order] of [...entries].reverse()) {
      backward.register(command(id, { group, order }));
    }

    const expected = [
      "ticket.assign",
      "search.extra",
      "views.save",
      "view:a",
      "view:b",
      "nav.contacts",
      "nav.settings",
      "create.ticket",
      "help.shortcuts",
    ];
    expect(ids(forward.visible(CONTEXT))).toEqual(expected);
    expect(ids(backward.visible(CONTEXT))).toEqual(expected);
    expect(ids(backward.paletteCommands(CONTEXT, ""))).toEqual(expected);
  });

  it("filterCommands matches the query case-insensitively in the label or any keyword", () => {
    const commands = [
      command("nav.kb", { label: "Knowledge Base", keywords: ["articles", "docs"] }),
      command("nav.contacts", { label: "Contacts", keywords: ["customers"] }),
      command("create.ticket", { label: "Create ticket", keywords: ["new"] }),
    ];

    expect(ids(filterCommands(commands, "base"))).toEqual(["nav.kb"]);
    expect(ids(filterCommands(commands, "KNOWLEDGE"))).toEqual(["nav.kb"]);
    expect(ids(filterCommands(commands, "Docs"))).toEqual(["nav.kb"]);
    expect(ids(filterCommands(commands, "custom"))).toEqual(["nav.contacts"]);
    expect(ids(filterCommands(commands, "t"))).toEqual(["nav.kb", "nav.contacts", "create.ticket"]);
    expect(filterCommands(commands, "~")).toEqual([]);
  });

  it("filterCommands returns every command unchanged for an empty query", () => {
    const commands = [command("b"), command("a")];
    expect(filterCommands(commands, "")).toEqual(commands);
    expect(filterCommands(commands, "   ")).toEqual(commands);
  });

  it("returns both commands when two share a label, and each runs its own handler", () => {
    const registry = createCommandRegistry();
    const privateRun = vi.fn();
    const sharedRun = vi.fn();
    registry.register(command("view:p", { group: "views", label: "Escalations", run: privateRun }));
    registry.register(command("view:s", { group: "views", label: "Escalations", run: sharedRun }));

    const found = registry.paletteCommands(CONTEXT, "escalations");
    expect(ids(found)).toEqual(["view:p", "view:s"]);

    found[1].run(CONTEXT);
    expect(sharedRun).toHaveBeenCalledTimes(1);
    expect(privateRun).not.toHaveBeenCalled();
  });

  it("never lists a hidden command in the palette, while visible still returns it for the keyboard", () => {
    const registry = createCommandRegistry();
    registry.register(command("list.next", { group: "tickets", label: "Next", hidden: true }));
    registry.register(command("nav.contacts", { label: "Contacts" }));

    expect(ids(registry.visible(CONTEXT))).toEqual(["list.next", "nav.contacts"]);
    expect(ids(registry.paletteCommands(CONTEXT, ""))).toEqual(["nav.contacts"]);
    expect(ids(registry.paletteCommands(CONTEXT, "next"))).toEqual([]);
  });

  it("notifies subscribers on register and unregister until they unsubscribe", () => {
    const registry = createCommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.getVersion();

    const unregister = registry.register(command("a"));
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getVersion()).not.toBe(before);

    unsubscribe();
    registry.register(command("b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

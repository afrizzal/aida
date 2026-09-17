# Keyboard shortcuts

AIDA can be driven from the keyboard. Shortcuts work whenever you are not typing in a field:
keys typed into an input, a text area, a reply or a note always stay in that field, and keys
pressed inside an open dialog, menu or picker are left to that dialog, menu or picker.

The one exception is the command palette: press `⌘K` on Apple devices or `Ctrl+K` on other
systems to open or close it from anywhere in the app, also from inside a field. It does not open
while another dialog is open, or while a menu or picker has focus (close it with `Esc` first).

Press `?` at any time (outside a field) to see this list in the app.

This list and the in-app help are generated from the same key table
(`src/lib/keyboard/keymap.ts`); a test fails when the two differ.

## General

| Keys | Action |
|------|--------|
| `⌘K / Ctrl+K` | Open or close the command palette |
| `?` | Show keyboard shortcuts |
| `Esc` | Close a dialog, cancel a key sequence, or clear the selection |

## Go to

Press `g`, then the second letter within one second. A `g` sequence expires after one second,
and it is cancelled by `Esc`, by any other key, by leaving the window or by moving to another
page.

| Keys | Action |
|------|--------|
| `g then t` | Go to Tickets |
| `g then c` | Go to Contacts |
| `g then k` | Go to Knowledge Base |
| `g then i` | Go to Insight |
| `g then s` | Go to Settings |

## Ticket list

These keys work on the inbox (`/tickets`) and next to an open ticket (`/tickets/{id}`). `j`
and `k` move through the tickets already loaded in the list; they stop at the first and last
loaded ticket and never load more.

| Keys | Action |
|------|--------|
| `j` | Move to the next ticket |
| `k` | Move to the previous ticket |
| `Enter` | Open the highlighted ticket |
| `x` | Select or unselect the highlighted ticket |

## Ticket page

These keys work on an open ticket (`/tickets/{id}`). The same actions are in the command
palette's "This ticket" group.

| Keys | Action |
|------|--------|
| `a` | Assign the ticket |
| `s` | Change the status |
| `t` | Add a tag |
| `r` | Reply to the customer |
| `n` | Write an internal note |

## Screen readers

How the single-letter shortcuts behave together with screen readers has not been verified yet.
If a screen reader's own single-letter keys clash with these, use the command palette or the
on-screen controls instead.

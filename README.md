# Cursor Sidebar

A port of Cursor's sidebar to BB, with four view modes: group chats by project,
status, environment or date.

Chats nest under the chat that spawned them, pinned chats gather in one block,
and standalone chats file into folders. The view settings live in the plugin's
own database on the BB server, so uninstalling the plugin removes them and
leaves your threads alone.

## Grouping

![The same chats grouped by Projects, Updated, Status and Environment](docs/media/grouping-demo.webp)

Sample chats, grouped four ways. The [mp4 is here](docs/media/grouping-demo.mp4)
if your browser will not play the WebP.

## The view menu

| Control | What it changes |
| --- | --- |
| **Grouping** | Projects, Updated, Status or Environment. One at a time, never stacked |
| **Chat order** | By last activity, or by status |
| **Project order** | By hand, or by worst status and then by the project used most recently. Projects grouping only |
| **Group order** | Most recent first, or the grouping's own default order |
| **Show** | Updated time, model, environment, machine and the pull request mark |
| **Status filter** | Needs your input, Failed, Working, Unread, Idle |
| **Environment filter** | Which environments appear, including chats with none |
| **Expand All / Collapse All** | Every section and group at once |
| **Mark All as Read** | Every loaded chat that is unread |

The three order controls live under Ordering and the two filters live under
Filters.

The menu button shows a warning mark when a view change has not reached the
server. The notice inside the menu has a Retry button.

## Rows

A row's second line names the model its thread last ran, after the provider's
logo and with the reasoning level: `Opus 5.5 high`, `Sol 6.1 xhigh`. Codex
names put the variant first so both providers read alike. Branch names are
not shown.

While a turn runs, the time on the right turns green and counts how long that
turn has been going (`<1m`, `12m`, `1h 5m`). Idle rows keep their age.
Background work left running after a turn ends does not count as a turn.

The feed BB gives sidebars has neither fact, so the plugin's server reads them:
the thread's resolved execution options, which BB takes from its latest turn,
and the latest `turn/started` event of a working thread. Rows on screen ask in
one batched call, and ask again only when their thread starts or ends a turn.

## Decisions

The inbox chip beside **Active** opens the decision queue from the
[Opsdesk](https://github.com/peterkimpk1/bb-plugin-opsdesk) plugin: every open
Tasks task labelled `decision` or `approval`, across every Opsdesk project,
earliest due first. Its count is everything waiting on you.

Each card shows the task key (it opens the task in Tasks), the due date or
when the thread went ahead with the default, the question and the default
pick. Click the question for the context and the task it blocks. **Accept
default**, **Answer…**, **Approve** and **Decline…** go through
Opsdesk, which comments your answer on the task, closes it, and sends the
answer to the thread named on the task's `Asker:` line.

If that thread was not told (the task names no asker, the asker is archived,
Opsdesk could not confirm the task just before sending, or the send hit an
error or was cut off), the card turns into **Not delivered** instead of
disappearing. Your answer is already recorded. **Retry** asks Opsdesk to send
it again; it never rewrites the answer, and it sends only while the answer
still stands. A send that hit an error or was cut off may still have arrived,
so retrying one can send it twice; the card says so. **Let go** leaves it
undelivered. These cards count toward the chip until one or the other.

Decisions and Active each replace the list, so one turns the other off, and
picking Threads or Bots returns to that tab. The queue refreshes every two
minutes, when the window comes back into view, and when the list opens.
Without Opsdesk the chip is hidden.

## Mobile

Touch uses the same list. A phone has no hover, so gestures carry the actions
instead.

| | Do this |
| --- | --- |
| Open a chat | Tap the row |
| Fold a project | Tap its name |
| Pin a chat | Swipe the row left |
| Archive a chat | Swipe the row right |
| Move a chat or a project | Hold until the row lifts, then drag |
| Open the actions menu | Hold until the row lifts, then let go without moving |
| Reorder a project without dragging | Hold the heading, then pick Move up or Move down. Project order Manual only |

A swipe has to travel 72px to commit. Anything shorter eases the row back.

While a row is lifted, or a swipe is locked sideways, the plugin holds the list
still so the gesture wins over the scroll. A plain vertical drag still scrolls
the list.

Letting go of a lifted row without moving opens its menu, and that menu holds
Expand children or Collapse children for a chat that has any. A lifted drag
drops where you leave it: a folder heading files the chat, the middle of another
chat in the same project nests it, and a project heading between two others
reorders the projects.

The pin and archive icons stay hidden on touch. Nothing reveals them without
hover, and the 44px targets a phone needs do not fit in a row, so a swipe or
the actions menu does that work instead.

## Bots tab

A Threads | Bots switch sits at the top of the list. Threads is the view
described above. Bots lists the bots from the
[Bots Sidebar](https://github.com/tobi/bb-bots-sidebar) plugin, in its order.
Each window remembers which tab it shows.

| | What it does |
| --- | --- |
| **Bot row** | Avatar colour and initial, name and role. A spinner on the avatar while any of its conversations works |
| **Needs you count** | Conversations of that bot waiting on your input, or with an unread failure |
| **Click the bot** | Opens its main conversation, or the first in its order |
| **Chevron** | Shows its conversations, newest activity first, with child threads nested. These are the Threads rows, so open, pin, archive and the actions menu work the same |
| **+** | Starts a conversation through Bots Sidebar, so the new thread belongs to the bot |

A conversation belongs to a bot when Bots Sidebar bound it to that bot, or when
its nearest bound parent was. Bots Sidebar must be installed and running. This
plugin reads it through its own server, because a plugin's frontend can only
call its own RPC. Without Bots Sidebar, the tab says so and the Threads tab is
unchanged.

## Requirements

BB 0.42 or newer. The plugin fills BB's experimental thread-list slot, which
replaces BB's own thread list. Turn it off with `bb plugin disable cursor-sidebar`.

## Install

```sh
bb plugin install git:https://github.com/wy3z/bb-plugin-cursor-sidebar.git
bb plugin reload cursor-sidebar
```

## Development

```sh
npm run typecheck          # tsc --noEmit
npm test                   # in-process sidebar tab acceptance check
npm run build              # bb plugin build writes dist/
bb plugin reload cursor-sidebar
```

The acceptance check mounts the registered Cursor Sidebar in jsdom with the
SDK's frontend harness. It selects Projects through the view menu, then checks
that pins, folders, selection, row order and expansion state survive Threads /
Bots switches. Every fixture bot must retain its character SVG (including the
working pose) while a remount's avatar request is pending, empty or rejected.
It uses fixture RPC replies, with no running BB instance or browser.

## License

MIT. Portions adapted from bb-plugin-thread-inbox. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

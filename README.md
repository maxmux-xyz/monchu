# Monchu

My heavily opinionated personal agent, built to route and delegate endeavors: one input stream of consciousness in, separate workstreams out.

**How it works:** you talk to one light front agent about anything. It routes each ask to a standing background worker that owns that line of work (a repository, a machine, your notes) and tracks your endeavors as goals, so the chat stays free.
Conversations, workers, and goals are durable: they are built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable) and survive restarts and crashes.

It is shaped around one person's way of working: subscription models only (ChatGPT/Codex, and Claude via Claude Code), a terminal UI, and plain Markdown files as its manual, soul, and memory. It is shared as is and may change without notice.

## Quick start

You need Node 22.19+ and a ChatGPT or Claude Pro/Max subscription. Secrets (API keys and logins agents use by name, never seeing them) also need [fnox](https://fnox.jdx.dev) on PATH: the bundled `fnox` plugin keeps their values, and any other store can replace it as a plugin. Install the newest build of `main` as a global `monchu` command, the same way on macOS, Linux, Windows, and Android (Termux):

```sh
npm install -g --allow-remote=root https://github.com/jorgeavaldez/monchu/releases/download/edge/monchu.tgz
monchu
```

To update, type `/update` in Monchu (or `/update <version>` for a [tagged release](https://github.com/jorgeavaldez/monchu/releases)): it installs the release and restarts on it. With Monchu quit, `monchu update` does the same. `npm uninstall -g monchu` removes the command but keeps the home. [docs/setup.md](docs/setup.md#updating) also covers running your own checkout with `npm link`.

1. Monchu creates its home at `~/.monchu`. Set `MONCHU_HOME` to use a different directory.
2. Run `/login` and pick a provider. With Codex or Claude Code, Monchu uses its models; with OpenCode or OpenRouter (API keys), pick models with `/model` and Ctrl+S.
3. For secrets, install [fnox](https://fnox.jdx.dev) (`mise use -g fnox`, or its own installer). Monchu makes its own fnox config and age key in `~/.monchu/secrets/` and never reads yours.
4. Ask Monchu to use the `onboard` skill to learn about you from what's already on the machine.

[docs/setup.md](docs/setup.md) covers logins, configuration, MCP servers, and running on several devices; [docs/plugins.md](docs/plugins.md) how to add your own tools and hooks as private plugins. [docs/internals.md](docs/internals.md) covers how Monchu works. `/help` lists the commands.

## Directory agents

The desktop web client has a live session tree, chat, and an owned-directory file preview. The header shows the selected session's repository. Use **+ Open** to open an existing work directory with `instruction.md`, choosing its repository, directory type, and head or worker role. Use **Browse** beside a path to navigate folders on the machine running Monchu, search the current folder by name, then **Use this folder** to fill it. The directory instructions supply the assignment; the source checkout is optional under Advanced. Existing conversations stay intact and can be assigned a directory explicitly when their legacy workers and jobs have been closed.

Directory types are currently fixed: `task`, `product`, `design`, `experimental`, `data-science`, `recurring`, and `recruiting`. Each supplies maintenance rules. Opening a session reads existing instructions and leaves directory files untouched. Create new work through chat using the applicable task skill. Task planning leaves `progress.md` empty; product trackers have no catch-all progress file. A recurring directory does not schedule a job.

**Directories** scans a folder you choose for directories containing `instruction.md`, including ones with no agent. Select a row to resume its live agent or open a new session. The last browsed folder stays in this browser. Hidden folders, `node_modules`, and symlink folders are excluded; a partial scan is labeled and asks for a narrower folder.

Ask a head in chat to open independent work. Its `start_session` tool opens another normal conversation beneath it in the tree. Heads can create heads or workers; workers cannot spawn. The tree records provenance: children have their own lifetime, and parents receive no automatic reports or completion notifications. Each live session owns a distinct record directory; task and experimental sessions also need distinct source checkouts. File previews are read-only, restricted to the owned directory, and limited to 256 KiB of UTF-8 text.

## Development

You need npm 12.2+ and [mise](https://mise.jdx.dev).

```sh
mise run install
mise run check   # typecheck, lint, format, knip, tests
mise run build
npm link         # make `monchu` run this checkout's build
mise run smoke   # offline TUI with scripted models
mise run e2e     # the real entry point end to end: every tool, plugin kind, worker, root, reload, restart, the TUI
mise run web:check  # the web client in a real browser: journeys, gates, metrics
mise run pack    # the installable tarball CI attaches to releases
```

To run the full gate on another machine (say, a Linux box when your own can't run every tool), clone this repository there with jj and mise, then call `scripts/gate.sh REV` over SSH, or stream an unpushed working copy in: `jj file list | tar -cf - -T - | ssh HOST CLONE/scripts/gate.sh -`. It runs `check` and `build` one gate at a time, reports every failure, and keeps the logs.

Code rules are in [AGENTS.md](AGENTS.md).

## Contributing

This is my personal project. Fork it and make it yours. Pull requests are welcome to try, but they probably won't be read or merged. There is no issue tracker.

## License

MIT, see [LICENSE](LICENSE). Parts are ported from other MIT projects (Pi, pi-fff, pi-claude-bridge, strip-ansi); [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) credits them.

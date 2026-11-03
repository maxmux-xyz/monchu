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

The desktop web client has a live session tree, chat, and an owned-directory file preview. The header shows the selected session's repository. Use **+ Open** to open an existing work directory with `instruction.md`, choosing its repository, directory type, and head or worker role. `/model` and `/thinking` change the selected session. Turn on **Make default for heads/workers** inside either picker to also save that role's choice for future sessions. Use **Browse** beside a path to navigate folders on the machine running Monchu, search the current folder by name, then **Use this folder** to fill it. The directory instructions supply the assignment; the source checkout is optional under Advanced. Existing conversations stay intact and can be assigned a directory explicitly when their legacy workers and jobs have been closed.

New sessions default to **New worktree**. Choose a starting **Branch** to create a separate source checkout: a detached Git worktree or a jj workspace. The bundled `worktrees` plugin supplies this support; no fetch or environment setup runs. Uncommitted changes in the source checkout are not copied. Turn the option off to use the repository or an existing source checkout under Advanced. The owned record directory stays in place. Checkouts live under `<home>/worktrees`, survive restarts, and remain on disk when a session is archived; Monchu does not delete them automatically.

Drag the session tree's right edge to resize it, or focus the divider and use the arrow keys. The toggle beside **Chat** hides or restores the tree at its chosen width, giving chat and files the full window.

Select text in a file preview, then **Ask agent** to put the exact selection and source file path into the current session's chat draft. Existing draft text stays intact. Add your question or annotation and press Enter to send it. Human notes have no quote action. HTML files open in a sandboxed **Preview** with inline CSS and SVG. Switch to **Source** to inspect or quote the markup. The preview blocks scripts, forms, embedded frames, and external subresources.

Directory types are currently fixed: `task`, `product`, `design`, `experimental`, `data-science`, `recurring`, and `recruiting`. Each supplies maintenance rules. Opening a session reads existing instructions and leaves directory files untouched. Create new work through chat using the applicable task skill. Task planning leaves `progress.md` empty; product trackers have no catch-all progress file. A recurring directory does not schedule a job.

The right pane has **Files** and **Human notes**. Each session has its own scratchpad. Edits save automatically to the server; the footer shows Saving…, Saved, or a failure with Retry. Notes restore after clearing browser data, reloads, and server restarts. Existing browser notes upload when first opened. Human notes use a human-login-only web endpoint and are excluded from agent context, tools, and owned files. The server keeps plaintext notes under its private runtime home; unrestricted host file/shell access can still read those files. Each note is limited to 1 MiB.

**Directories** scans a folder you choose for directories containing `instruction.md`, including ones with no agent. Select a row to resume its live agent or open a new session. The last browsed folder stays in this browser. Hidden folders, `node_modules`, and symlink folders are excluded; a partial scan is labeled and asks for a narrower folder.

Ask a head in chat to propose a subthread. **Review & open** lets you edit its initial prompt, model, thinking level, role, directory and checkout. The thread appears beneath its parent while workspace setup runs, and a failed setup can be retried from Files. The sidebar displays thread names in lowercase kebab-case. A head can also use `start_session` for a directly authorized handoff. Heads can create heads or workers; workers cannot spawn. The tree records provenance: children have their own lifetime, and parents receive no automatic reports or completion notifications. Each live session owns a distinct record directory; task and experimental sessions also need distinct source checkouts. File previews are read-only, restricted to the owned directory, and limited to 256 KiB of UTF-8 text.

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

Control this checkout's built web server without an attached terminal:

```sh
mise run server -- up
mise run server -- status
mise run server -- restart
mise run server -- down
```

Run `mise run build` first; these commands reuse the existing build and `MONCHU_HOME` (default `~/.monchu`). Configure the web client in the home's `web.json` before starting. Startup waits for the core and web listener; shutdown is graceful. Logs append to `<home>/run/server.log`.

To run the full gate on another machine (say, a Linux box when your own can't run every tool), clone this repository there with jj and mise, then call `scripts/gate.sh REV` over SSH, or stream an unpushed working copy in: `jj file list | tar -cf - -T - | ssh HOST CLONE/scripts/gate.sh -`. It runs `check` and `build` one gate at a time, reports every failure, and keeps the logs.

Code rules are in [AGENTS.md](AGENTS.md).

## Contributing

This is my personal project. Fork it and make it yours. Pull requests are welcome to try, but they probably won't be read or merged. There is no issue tracker.

## License

MIT, see [LICENSE](LICENSE). Parts are ported from other MIT projects (Pi, pi-fff, pi-claude-bridge, strip-ansi); [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) credits them.

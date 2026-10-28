/** The page: who's working, the shown conversation, its queue, and the editor or whatever answer it waits for. */
import { signal, useSignal } from "@preact/signals";
import { systemNoticeSummary } from "../api/notices.ts";
import { contextUsage, presentation, type QueuedItem } from "../ui/state.ts";
import { TopBar } from "./bar.tsx";
import { ClientPanel, InstallOffer } from "./client.tsx";
import { Editor } from "./editor.tsx";
import { MODE } from "./keys.tsx";

import { Close } from "./panel.tsx";
import { entering, SecretForm, SecretRequests, SecretsPanel } from "./secrets.tsx";
import { SendingRows, sendingAny } from "./sending.tsx";
import { run } from "./commands.ts";
import {
  ask,
  choice,
  client,
  connection,
  linkError,
  editing,
  loginStatus,
  panel,
  shown,
  view,
  whole,
  roots,
  rootId,
  directoriesShown,
} from "./state.ts";
import { Transcript } from "./transcript.tsx";
import { Sessions, directoryForm, assignSessionDirectory } from "./sessions.tsx";
import { useEffect } from "preact/hooks";

const lists = signal<typeof import("./panels.tsx") | undefined>(undefined);
function WorkPanel() {
  const error = useSignal("");
  useEffect(() => {
    void import("./panels.tsx")
      .then((module) => {
        lists.value = module;
      })
      .catch((failure: unknown) => {
        error.value = failure instanceof Error ? failure.message : String(failure);
      });
  }, []);
  const loaded = lists.value;
  return loaded === undefined ? (
    <main class="transcript">{error.value || "Loading…"}</main>
  ) : panel.value === "goals" ? (
    <loaded.GoalsPanel />
  ) : (
    <loaded.JobsPanel />
  );
}

const directoryPanels = signal<typeof import("./panels.tsx").DirectoryPanels | undefined>(
  undefined,
);
const directoryLoadError = signal("");

function DirectoryPanel({ catalog = false }: { catalog?: boolean }) {
  const owned = roots.value.find((item) => item.id === rootId.value)?.directory;
  const form = directoryForm.value;
  useEffect(() => {
    if (directoryPanels.peek() !== undefined || (!owned && !form && !catalog)) return;
    void import("./panels.tsx")
      .then((module) => {
        directoryPanels.value = module.DirectoryPanels;
      })
      .catch((error: unknown) => {
        directoryLoadError.value = error instanceof Error ? error.message : String(error);
      });
  }, [owned, form, catalog]);
  const Loaded = directoryPanels.value;
  return Loaded ? (
    <Loaded catalog={catalog} />
  ) : (
    <aside
      class={catalog ? "directory-catalog" : "directory-files"}
      aria-label={catalog ? "Directories" : "Owned directory files"}
    >
      <header>
        <strong>Owned files</strong>
      </header>
      <div class="directory-empty">
        {directoryLoadError.value ? (
          <p role="alert">{directoryLoadError.value}. Reload to retry.</p>
        ) : owned || form || catalog ? (
          <p>Loading…</p>
        ) : (
          <>
            <p>This session has no owned directory.</p>
            <button
              type="button"
              onClick={assignSessionDirectory}
              disabled={rootId.value === undefined}
            >
              Assign directory
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function Ask() {
  const current = ask.value;
  const value = useSignal("");
  if (current === undefined) return null;
  const input = {
    autoComplete: "off",
    spellcheck: false,
    ...(current.placeholder === undefined ? {} : { placeholder: current.placeholder }),
    value: value.value,
    ref: (element: HTMLInputElement | null) => element?.focus(),
    onInput: (event: { currentTarget: HTMLInputElement }) => {
      value.value = event.currentTarget.value;
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") current.cancel();
    },
  };
  return (
    <form
      class="ask"
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.value;
        value.value = "";
        current.answer(text);
      }}
    >
      <label for="ask">{current.title}</label>
      <div class="row">
        {current.secret ? (
          <input id="ask" type="password" {...input} />
        ) : (
          <input id="ask" type="text" {...input} />
        )}
        <button type="submit" class="icon" aria-label="ok" title="ok (Enter)">
          ›
        </button>
        <Close label="cancel" onClose={() => current.cancel()} />
      </div>
    </form>
  );
}

function Login() {
  const status = loginStatus.value;
  if (status === undefined) return null;
  return (
    <div class="offer login" role="status">
      <span>
        {status.message}
        {status.code === undefined ? null : <code>{status.code}</code>}
      </span>
      {status.url === undefined ? null : (
        <a href={status.url} target="_blank" rel="noreferrer noopener">
          open
        </a>
      )}
      <Close label="cancel the sign-in" onClose={() => run("login.cancel")} />
    </div>
  );
}

const LINK = {
  connecting: "connecting",
  live: "connected",
  lost: "reconnecting",
  updating: "reconnecting · installing an update",
  gone: "disconnected · tap to reload",
};

/** The link to the core as one dot: green while it answers, hollow while it redials, red once it's gone. */
function LinkDot() {
  const state = connection.value;
  if (state === "gone")
    return (
      <button
        class="link"
        data-state="gone"
        aria-label={LINK.gone}
        title={LINK.gone}
        onClick={() => location.reload()}
      >
        ● {LINK.gone}
      </button>
    );
  return (
    <span
      class="link"
      data-state={state}
      role="status"
      aria-label={LINK[state]}
      title={LINK[state]}
    >
      {state === "live" ? "●" : `○ ${LINK[state]}`}
    </span>
  );
}

/** A user's home directory at the start of a path, on Linux, macOS, Termux and Windows; the page has no other way to know it. */
const HOME =
  /^(\/home\/[^/]+|\/Users\/[^/]+|\/root|\/data\/data\/com\.termux\/files\/home|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/;

/** Tokens compactly: 900, 42k, 1.2M. */
function tokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1e6) return `${Math.round(count / 1000)}k`;
  return `${(count / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Whether the status bar's details are open above it. */
const details = signal(false);

function Footer() {
  const state = view(shown.value)?.value;
  const root = view(undefined)?.value;
  if (state === undefined) return null;
  const live = presentation(state);
  const model =
    live.provider === undefined
      ? undefined
      : client().model({ provider: live.provider, modelId: live.model });
  const meter = (value: typeof state) => {
    const usage = contextUsage(value);
    const window = model?.contextWindow;
    const fill =
      usage.context === undefined || window === undefined ? undefined : usage.context / window;
    return { usage, fill };
  };
  const { usage, fill } = meter(state);
  const level = fill === undefined ? "" : fill > 0.9 ? "red" : fill > 0.7 ? "yellow" : "";
  const name = live.provider === undefined ? live.model : `${live.provider}/${live.model}`;
  const thinking = model?.reasoning === true ? (live.thinkingLevel ?? "off") : undefined;
  const dir = live.cwd?.replace(HOME, "~");
  const base = dir?.split(/[/\\]/).findLast(Boolean) ?? dir ?? "";
  const open = details.value;
  const percent = fill === undefined ? "?" : `${Math.round(fill * 100)}%`;
  const meterTitle = usage.compacted ? "compacted: unknown until the next reply" : "context used";
  const rows: [string, string][] = [
    ["dir", dir ?? "?"],
    ["model", thinking === undefined ? name : `${name} · ${thinking}`],
    [
      "context",
      `${usage.context === undefined ? "?" : tokens(usage.context)} / ${
        model?.contextWindow === undefined ? "?" : tokens(model.contextWindow)
      } · ${percent}${usage.compacted ? " · compacted, next reply measures it" : ""}`,
    ],
    [
      "tokens",
      `↑${tokens(usage.input)} ↓${tokens(usage.output)} R${tokens(usage.cacheRead)} W${tokens(usage.cacheWrite)}`,
    ],
  ];
  if (shown.value !== undefined && root !== undefined) {
    const size = contextUsage(root).context;
    rows.push(["root", size === undefined ? "?" : tokens(size)]);
  }
  rows.push(["link", LINK[connection.value]]);
  return (
    <>
      {open ? (
        <dl class="status" id="status">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>
                <bdi>{value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <footer
        class="footer"
        style={{
          "--fill": `${Math.round(Math.min(1, fill ?? 0) * 100)}%`,
          "--meter": level === "" ? "var(--muted)" : `var(--${level})`,
        }}
      >
        <button
          class={`more${open ? " on" : ""}`}
          aria-expanded={open}
          aria-controls="status"
          aria-label={`status details: ${dir ?? ""}`}
          title={live.cwd}
          onClick={() => (details.value = !open)}
        >
          <span aria-hidden="true">{open ? "▾" : "▴"}</span> <bdi>{base}</bdi>
        </button>
        <span class="meta">
          <span class={level} title={meterTitle}>
            {percent}
          </span>{" "}
          <span title={name}>{live.model}</span>
          {thinking === undefined ? "" : ` ${thinking}`}
        </span>
        <LinkDot />
      </footer>
    </>
  );
}

/**
 * One queued message. The terminal's Alt+Q panel, in place: a tap opens it in the editor, and its buttons switch its
 * mode or delete it. Writes and notices that aren't the user's words stay as they are.
 */
function QueueRow({ item }: { item: QueuedItem }) {
  const open = editing.value?.id === item.id;
  const editable = item.mode !== "write" && systemNoticeSummary(item.text) === undefined;
  const line = item.text.split("\n")[0] ?? "";
  if (item.mode === "write") return <li class={item.mode}>write · {line}</li>;
  const other = item.mode === "steer" ? "follow-up" : "steer";
  return (
    <li class={`${item.mode}${open ? " here" : ""}`}>
      {editable ? (
        <button
          class="text"
          aria-label={`edit: ${line}`}
          disabled={editing.value !== undefined}
          onClick={() => run("queue.open", item)}
        >
          {line}
        </button>
      ) : (
        <span class="text">{line}</span>
      )}
      <button
        class="icon"
        aria-label={`${item.mode === "steer" ? "steer" : "follow-up"}, make it ${other}`}
        title={`${item.mode === "steer" ? "steer" : "follow-up"} · tap for ${other}`}
        onClick={() =>
          run("queue.change", item.id, {
            kind: "mode",
            mode: item.mode === "steer" ? "followUp" : "steer",
          })
        }
      >
        {MODE[item.mode]}
      </button>
      <button
        class="icon"
        aria-label="delete it"
        title="delete it (Del in the terminal's queue)"
        disabled={open}
        onClick={() => run("queue.change", item.id, { kind: "delete" })}
      >
        ✕
      </button>
    </li>
  );
}

/** The queued messages, then the ones still on their way to the core. */
function Queue() {
  const state = view(shown.value)?.value;
  const queue = state === undefined ? [] : presentation(state).queue;
  if (queue.length === 0 && !sendingAny()) return null;
  return (
    <ul class="queue" aria-label="queued">
      {queue.map((item) => (
        <QueueRow key={item.id} item={item} />
      ))}
      <SendingRows />
    </ul>
  );
}

export function App() {
  const state = view(shown.value)?.value;
  const active = roots.value.find((item) => item.id === rootId.value);
  return (
    <>
      {active?.directory === undefined ? (
        <header class="hidden">
          <h1>Sessions</h1>
        </header>
      ) : (
        <header class="session-repository">
          <h1>{active.directory.repoPath}</h1>
        </header>
      )}
      <div class="compact-navigation">
        <TopBar />
      </div>
      <div class="session-layout">
        <Sessions />
        {directoriesShown.value ? (
          <DirectoryPanel catalog />
        ) : (
          <>
            <div class="chat-pane">
              <div class="chat-toolbar" role="region" aria-label="Session status">
                <strong>Chat</strong>
                <span>
                  {active?.error
                    ? "! failed"
                    : active?.status === "working"
                      ? "● working"
                      : active?.needsInput
                        ? "? needs you"
                        : "○ idle"}
                </span>
              </div>
              {panel.value === "client" ? (
                <ClientPanel />
              ) : panel.value === "secrets" ? (
                <SecretsPanel />
              ) : panel.value === "goals" || panel.value === "jobs" ? (
                <WorkPanel />
              ) : state === undefined ? (
                <main class="transcript">
                  connecting…{linkError.value ? ` ${linkError.value}` : ""}
                </main>
              ) : (
                <>
                  <Transcript
                    key={state.conversation.id}
                    view={whole(shown.value)?.value ?? state}
                    front={shown.value === undefined}
                  />
                </>
              )}
              <Queue />
              <Login />
              <InstallOffer />
              <SecretRequests />
              {/* A pick opens over the editor, which stays to filter it. */}
              {choice.value === undefined && ask.value !== undefined ? (
                <Ask />
              ) : choice.value === undefined && entering.value !== undefined ? (
                <SecretForm />
              ) : (
                <Editor />
              )}
              <Footer />
            </div>
            <DirectoryPanel />
          </>
        )}
      </div>
    </>
  );
}

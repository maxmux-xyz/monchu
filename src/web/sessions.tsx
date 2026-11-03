import { signal, useSignal, type Signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import {
  type DirectoryCatalog,
  type ManagedDirectory,
  type FolderListing,
} from "../api/directories.ts";
import type { RootSummary } from "../api/client.ts";
import { run } from "./commands.ts";
import { client, directoriesShown, rootId, roots } from "./state.ts";

export const directoryBrowser = {
  folder: signal(localStorage.getItem("directory-root") ?? ""),
  catalog: signal<DirectoryCatalog | undefined>(undefined),
  busy: signal(false),
  error: signal(""),
};

export async function browseDirectories() {
  const { folder, catalog, busy, error } = directoryBrowser;
  if (busy.value || !folder.value.trim()) return;
  busy.value = true;
  error.value = "";
  catalog.value = undefined;
  try {
    const result = await client().discoverDirectories(folder.value.trim());
    catalog.value = result;
    folder.value = result.root;
    localStorage.setItem("directory-root", result.root);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}

export const directoryCandidate = signal<ManagedDirectory | undefined>(undefined);

export const directoryForm = signal<"new" | "assign" | "branch" | undefined>(undefined);
export const branchProposal = signal<{ id: string; input: unknown } | undefined>(undefined);

export function DirectoryInput(props: {
  label: string;
  name: string;
  value: Signal<string>;
  base?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLElement>(null);
  const request = useRef(0);
  const query = useSignal("");
  const open = useSignal(false);
  const busy = useSignal(false);
  const error = useSignal("");
  const listing = useSignal<FolderListing | undefined>(undefined);
  async function load(path: string, search?: string) {
    const id = ++request.current;
    query.value = search ?? "";
    if (search === undefined) listing.value = undefined;
    busy.value = true;
    error.value = "";
    try {
      const result = await client().browseFolders(path, props.base || undefined, search);
      if (id === request.current) listing.value = result;
    } catch (failure) {
      if (id === request.current)
        error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (id === request.current) {
        busy.value = false;
        if (open.value && search === undefined) picker.current?.focus();
      }
    }
  }
  const current = listing.value;
  return (
    <div
      class="directory-input"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open.value) {
          event.stopPropagation();
          open.value = false;
          input.current?.focus();
        }
      }}
    >
      <label htmlFor={props.name}>{props.label}</label>
      <div class="directory-input-line">
        <input
          ref={input}
          id={props.name}
          name={props.name}
          required={props.required}
          placeholder={props.placeholder}
          value={props.value.value}
          onInput={(event) => {
            props.value.value = event.currentTarget.value;
          }}
        />
        <button
          type="button"
          aria-label={`Browse ${props.label}`}
          aria-expanded={open.value}
          disabled={busy.value}
          onClick={() => {
            open.value = !open.value;
            if (open.value) void load(props.value.value.trim() || (props.base ? "." : "~"));
          }}
        >
          Browse
        </button>
      </div>
      {open.value ? (
        <section
          ref={picker}
          tabIndex={-1}
          class="folder-picker"
          aria-label={`Choose ${props.label}`}
        >
          <div class="folder-navigation">
            <button
              type="button"
              disabled={busy.value}
              onClick={() => {
                void load("~");
              }}
            >
              Home
            </button>
            <button
              type="button"
              disabled={busy.value || current?.parent === undefined}
              onClick={() => {
                if (current?.parent) void load(current.parent);
              }}
            >
              Up
            </button>
            <button
              type="button"
              aria-label={`Close ${props.label} picker`}
              onClick={() => {
                open.value = false;
                input.current?.focus();
              }}
            >
              ✕
            </button>
          </div>
          {current ? <div class="folder-path">{current.path}</div> : null}
          {current ? (
            <input
              type="search"
              aria-label="Search folders"
              placeholder="Search folders…"
              value={query.value}
              onInput={(event) => {
                void load(current.path, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          ) : null}
          {error.value ? <p role="alert">{error.value}</p> : null}
          {busy.value ? (
            <p role="status">Loading…</p>
          ) : current ? (
            <>
              <ul>
                {current.folders.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => {
                        void load(`${current.path}/${name}`);
                      }}
                    >
                      {name}/
                    </button>
                  </li>
                ))}
              </ul>
              {current.folders.length === 0 ? (
                <p>{query.value ? "No matching folders" : "No subfolders"}</p>
              ) : null}
              {current.more ? <p>First 200 matches shown. Refine your search.</p> : null}
              <button
                type="button"
                onClick={() => {
                  props.value.value = current.path;
                  open.value = false;
                  input.current?.focus();
                }}
              >
                Use this folder
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export const humanNotesShown = signal(false);
// Human-only web endpoint; never expose these notes through agent clients or tools.
type HumanNote = { text: Signal<string>; status: Signal<string>; loaded: boolean; saving: boolean };
const humanNotes = new Map<string, HumanNote>();
const notesUrl = (id: string) => `/human-notes.txt?session=${encodeURIComponent(id)}`;
const notesKey = (id: string) => `monchu:human-notes:${id}`;

function cacheNote(id: string, text: string) {
  try {
    localStorage.setItem(notesKey(id), text);
  } catch {
    /* The server remains the durable copy. */
  }
}

async function saveNote(id: string, note: HumanNote) {
  note.status.value = "Saving…";
  if (note.saving) return;
  note.saving = true;
  try {
    for (;;) {
      const text = note.text.peek();
      const response = await fetch(notesUrl(id), { method: "PUT", body: text, redirect: "error" });
      if (!response.ok) {
        note.status.value = response.status === 413 ? "Too large (max 1 MiB)" : "Save failed";
        return;
      }
      if (note.text.peek() === text) {
        note.status.value = "Saved";
        return;
      }
    }
  } catch {
    note.status.value = "Save failed";
  } finally {
    note.saving = false;
  }
}

async function loadNote(id: string, note: HumanNote) {
  note.status.value = "Loading…";
  try {
    note.text.value = localStorage.getItem(notesKey(id)) ?? "";
  } catch {
    /* Browser storage is optional. */
  }
  try {
    const response = await fetch(notesUrl(id), { cache: "no-store", redirect: "error" });
    if (!response.ok) {
      note.status.value = "Load failed";
      return;
    }
    const text = response.status === 204 ? null : await response.text();
    note.loaded = true;
    if (text === null && note.text.peek()) {
      await saveNote(id, note);
      return;
    }
    note.text.value = text ?? "";
    cacheNote(id, note.text.peek());
    note.status.value = "Saved";
  } catch {
    note.status.value = "Load failed";
  }
}

export function DirectoryHeader({
  refresh,
  disabled,
}: {
  refresh?: () => void;
  disabled?: boolean;
}) {
  return (
    <header>
      <nav class="directory-tabs" aria-label="Right pane">
        <button
          type="button"
          aria-pressed={!humanNotesShown.value}
          onClick={() => {
            humanNotesShown.value = false;
          }}
        >
          Files
        </button>
        <button
          type="button"
          aria-pressed={humanNotesShown.value}
          onClick={() => {
            humanNotesShown.value = true;
          }}
        >
          Human notes
        </button>
      </nav>
      {refresh ? (
        <button
          type="button"
          class="icon"
          aria-label="Refresh files"
          disabled={disabled}
          onClick={refresh}
        >
          ⟲
        </button>
      ) : null}
    </header>
  );
}

export function HumanNotes() {
  const session = roots.value.find((item) => item.id === rootId.value);
  const id = session ? `${session.id}:${session.createdAt}` : undefined;
  let note = id === undefined ? undefined : humanNotes.get(id);
  if (id !== undefined && note === undefined) {
    note = { text: signal(""), status: signal("Loading…"), loaded: false, saving: false };
    humanNotes.set(id, note);
    void loadNote(id, note);
  }
  const current = note;
  const status = current?.status.value ?? "Choose a session";
  const failed = current !== undefined && !["Loading…", "Saving…", "Saved"].includes(status);
  return (
    <aside
      class="directory-files human-notes"
      aria-label="Human notes"
      onKeyDown={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.stopPropagation();
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.stopPropagation();
        if (event.dataTransfer?.files.length) event.preventDefault();
      }}
    >
      <DirectoryHeader />
      <textarea
        aria-label="Human notes"
        aria-describedby="human-notes-status"
        readOnly={!current?.loaded}
        value={current?.text.value ?? ""}
        onInput={(event) => {
          if (current === undefined || id === undefined || !current.loaded) return;
          current.text.value = event.currentTarget.value;
          cacheNote(id, current.text.peek());
          void saveNote(id, current);
        }}
      />
      <p id="human-notes-status" role={failed ? "alert" : "status"}>
        {status}
        {failed && current && id ? (
          <button
            type="button"
            onClick={() => {
              void (current.loaded ? saveNote(id, current) : loadNote(id, current));
            }}
          >
            Retry
          </button>
        ) : null}
      </p>
    </aside>
  );
}

export function assignSessionDirectory(): void {
  directoryCandidate.value = undefined;
  directoryForm.value = "assign";
}

export function sessionStatus(session?: RootSummary): string {
  return session?.error
    ? "! failed"
    : session?.preparing
      ? "● preparing workspace"
      : session?.status === "working"
        ? "● working"
        : session?.needsInput
          ? "? needs you"
          : "○ idle";
}

export function threadLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "new-session"
  );
}

export function Sessions({ children }: { children: ComponentChildren }) {
  const all = roots.value.filter(
    (session) => session.directory !== undefined || session.label !== "",
  );
  const visible = new Set(all.filter((item) => !item.archived).map((item) => item.id));
  for (const item of all.filter((each) => visible.has(each.id))) {
    for (let parent = item.spawnedBy; parent !== undefined && !visible.has(parent);) {
      visible.add(parent);
      parent = all.find((each) => each.id === parent)?.spawnedBy;
    }
  }
  function rows(parent?: string) {
    return all
      .filter(
        (item) =>
          visible.has(item.id) &&
          (item.spawnedBy === parent ||
            (parent === undefined && !all.some((each) => each.id === item.spawnedBy))),
      )
      .map((item) => (
        <li key={item.id}>
          <button
            type="button"
            class={`session-row${item.id === rootId.value ? " on" : ""}`}
            aria-current={item.id === rootId.value}
            title={`${threadLabel(item.label)} · ${item.directory?.agentRole ?? "unassigned"} · ${item.error ?? sessionStatus(item).slice(2)}${item.unread ? " · unread output" : ""}`}
            onClick={() => {
              run("root.switch", item.id);
            }}
          >
            <span
              class={item.status === "working" ? "session-running" : ""}
              aria-label={sessionStatus(item).slice(2)}
            >
              {sessionStatus(item)[0]}
            </span>
            <span class={item.unread ? "session-name unread-output" : "session-name"}>
              {threadLabel(item.label)} - {item.directory?.directoryType ?? "unassigned"}
            </span>
            {item.unread ? (
              <span class="session-unread" aria-label="Unread output">
                ●
              </span>
            ) : null}
          </button>
          {all.some((each) => visible.has(each.id) && each.spawnedBy === item.id) ? (
            <ul>{rows(item.id)}</ul>
          ) : null}
        </li>
      ));
  }
  return (
    <nav id="sessions" class="sessions" aria-label="Live agent sessions">
      {children}
      <header>
        <button
          type="button"
          class={directoriesShown.value ? "on" : ""}
          aria-label="Directories"
          aria-pressed={directoriesShown.value}
          onClick={() => {
            directoriesShown.value = !directoriesShown.value;
          }}
        >
          Directories
        </button>
        <button
          type="button"
          onClick={() => {
            directoryCandidate.value = undefined;
            directoryForm.value = "new";
          }}
        >
          + Open
        </button>
      </header>
      <ul>{rows()}</ul>
    </nav>
  );
}

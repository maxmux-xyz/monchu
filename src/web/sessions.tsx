import { signal, useSignal, type Signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  DIRECTORY_TYPES,
  type DirectoryType,
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

export const directoryForm = signal<"new" | "assign" | undefined>(undefined);

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

export function SessionOptions({ type }: { type: DirectoryType }) {
  const selectedType = useSignal<string>(type);
  const selectedRole = useSignal("head");
  return (
    <div class="session-fields">
      <label>
        Directory type
        <select
          name="directoryType"
          value={selectedType.value}
          onChange={(event) => {
            selectedType.value = event.currentTarget.value;
          }}
        >
          {DIRECTORY_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label>
        Agent role
        <select
          name="agentRole"
          value={selectedRole.value}
          onChange={(event) => {
            selectedRole.value = event.currentTarget.value;
          }}
        >
          <option>head</option>
          <option>worker</option>
        </select>
      </label>
    </div>
  );
}

export function assignSessionDirectory(): void {
  directoryCandidate.value = undefined;
  directoryForm.value = "assign";
}

function sessionStatus(session: RootSummary): string {
  return session.error ? "!" : session.status === "working" ? "●" : session.needsInput ? "?" : "○";
}

export function Sessions() {
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
            title={`${item.label || "New session"} · ${item.directory?.agentRole ?? "unassigned"} · ${item.error ?? item.status}`}
            onClick={() => {
              run("root.switch", item.id);
            }}
          >
            <span aria-label={item.error ?? (item.needsInput ? "needs you" : item.status)}>
              {sessionStatus(item)}
            </span>
            <span>
              {item.label || "New session"} - {item.directory?.directoryType ?? "unassigned"}
            </span>
          </button>
          {all.some((each) => visible.has(each.id) && each.spawnedBy === item.id) ? (
            <ul>{rows(item.id)}</ul>
          ) : null}
        </li>
      ));
  }
  return (
    <nav class="sessions" aria-label="Live agent sessions">
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

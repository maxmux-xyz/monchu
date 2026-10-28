import { signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { DirectoryFile, DirectoryListing } from "../api/directories.ts";
import { presentation } from "../ui/state.ts";
import { Markdown } from "./markdown.tsx";
import { assignSessionDirectory } from "./sessions.tsx";
import { client, connection, rootId, roots, shown, view } from "./state.ts";

const browsing = signal<Record<string, { folder: string; file: string | undefined }>>({});

export function Files() {
  const id = rootId.value;
  const active = roots.value.find((item) => item.id === id);
  const owned = active?.directory?.ownedDirectory;
  const current = id === undefined ? undefined : browsing.value[id];
  const folder = current?.folder ?? "";
  const file = current?.file;
  const state = view(shown.value)?.value;
  const running = state === undefined ? false : presentation(state).busy;
  const refreshed = useSignal(0);
  const listing = useSignal<{ root: string; data: DirectoryListing } | undefined>(undefined);
  const opened = useSignal<{ root: string; data: DirectoryFile } | undefined>(undefined);
  const error = useSignal("");
  const fileError = useSignal("");
  const busy = useSignal(false);
  function select(folder: string, file: string | undefined) {
    if (id !== undefined) browsing.value = { ...browsing.value, [id]: { folder, file } };
  }
  useEffect(() => {
    if (id === undefined || owned === undefined) return;
    let cancelled = false;
    busy.value = true;
    error.value = "";
    void client()
      .listDirectory(id, folder)
      .then((data) => {
        if (cancelled) return;
        listing.value = { root: id, data };
        if (browsing.peek()[id]?.file === undefined) {
          const first =
            data.entries.find((entry) => entry.name === "instruction.md" && !entry.directory) ??
            data.entries.find((entry) => !entry.directory);
          if (first)
            browsing.value = {
              ...browsing.peek(),
              [id]: { folder, file: folder ? `${folder}/${first.name}` : first.name },
            };
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) error.value = failure instanceof Error ? failure.message : String(failure);
      })
      .finally(() => {
        if (!cancelled) busy.value = false;
      });
    return () => {
      cancelled = true;
    };
  }, [id, owned, folder, running, refreshed.value, connection.value]);
  useEffect(() => {
    fileError.value = "";
    if (id === undefined || file === undefined || owned === undefined) return;
    let cancelled = false;
    void client()
      .readDirectoryFile(id, file)
      .then((data) => {
        if (!cancelled) opened.value = { root: id, data };
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          fileError.value = failure instanceof Error ? failure.message : String(failure);
      });
    return () => {
      cancelled = true;
    };
  }, [id, owned, file, running, refreshed.value, connection.value]);
  const listed = listing.value;
  const loaded = opened.value;
  const entries =
    listed !== undefined && listed.root === id && listed.data.path === folder
      ? listed.data
      : undefined;
  const document =
    loaded !== undefined && loaded.root === id && loaded.data.path === file
      ? loaded.data
      : undefined;
  return (
    <aside class="directory-files" aria-label="Owned directory files">
      <header>
        <strong>Owned files</strong>
        <button
          type="button"
          class="icon"
          aria-label="Refresh files"
          disabled={!owned || busy.value}
          onClick={() => {
            refreshed.value++;
          }}
        >
          ⟲
        </button>
      </header>
      {owned === undefined ? (
        <div class="directory-empty">
          <p>This session has no owned directory.</p>
          <button type="button" onClick={assignSessionDirectory} disabled={id === undefined}>
            Assign directory
          </button>
        </div>
      ) : (
        <>
          <div class="directory-path">{owned}</div>
          {folder ? (
            <button
              type="button"
              class="directory-up"
              onClick={() => select(folder.split("/").slice(0, -1).join("/"), undefined)}
            >
              ‹ {folder}
            </button>
          ) : null}
          <nav class="directory-list" aria-label="Directory contents">
            {entries?.entries.map((entry) => {
              const path = folder ? `${folder}/${entry.name}` : entry.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  class={file === path ? "on" : ""}
                  onClick={() =>
                    select(entry.directory ? path : folder, entry.directory ? undefined : path)
                  }
                >
                  {entry.directory ? "› " : ""}
                  {entry.name}
                </button>
              );
            })}
            {entries?.more ? <span>First 200 entries shown.</span> : null}
          </nav>
          {error.value || active?.error ? (
            <p class="directory-error" role="alert">
              {error.value || active?.error}
            </p>
          ) : null}
          <section class="directory-document" aria-live="polite">
            {fileError.value ? (
              <p role="alert">{fileError.value}</p>
            ) : document ? (
              <>
                <div class="directory-filename">{document.path}</div>
                {/\.md$/i.test(document.path) ? (
                  <Markdown text={document.text} />
                ) : (
                  <pre>{document.text}</pre>
                )}
              </>
            ) : (
              <p>{file === undefined ? "Choose a file." : "Loading…"}</p>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

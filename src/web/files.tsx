import { signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { DirectoryFile, DirectoryListing } from "../api/directories.ts";
import { presentation } from "../ui/state.ts";
import { Markdown } from "./markdown.tsx";
import { assignSessionDirectory, DirectoryHeader } from "./sessions.tsx";
import { run } from "./commands.ts";
import {
  client,
  connection,
  draft,
  notice,
  rootId,
  roots,
  setDraft,
  shown,
  view,
} from "./state.ts";

const htmlFile = /\.html?$/i;
const browsing = signal<Record<string, { folder: string; file: string | undefined }>>({});

function selectionChanged(): void {
  document.dispatchEvent(new Event("selectionchange"));
}

function quoteKey(event: KeyboardEvent): void {
  if (!event.altKey || event.key !== "Enter" || event.isComposing || event.repeat) return;
  const button = document.querySelector<HTMLButtonElement>(".directory-ask, .chat-ask");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.click();
}

function renderHtml(shell: HTMLIFrameElement | null, text: string, selectable = false): boolean {
  const frame = shell?.contentDocument?.querySelector("iframe");
  if (!frame) return false;
  if (selectable) {
    // Same-origin lets the app read selection. The sandbox still denies scripts.
    frame.sandbox.add("allow-same-origin");
    frame.onload = () => {
      const doc = frame.contentDocument;
      doc?.addEventListener("selectionchange", selectionChanged);
      doc?.addEventListener("scroll", selectionChanged, true);
      doc?.addEventListener("keydown", quoteKey);
    };
  }
  const html =
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="frame-src 'none'">` + text;
  if (frame.srcdoc !== html) frame.srcdoc = html;
  return true;
}

function openHtml(id: string, path: string): void {
  const tab = window.open("", "_blank");
  if (!tab) {
    notice("Preview pop-up blocked", "warning");
    return;
  }
  tab.opener = null;
  const page = tab.document;
  page.title = path;
  const shell = page.createElement("iframe");
  shell.title = path;
  shell.style.cssText = "width:100%;height:98vh";
  shell.setAttribute("sandbox", "allow-same-origin");
  shell.src = "/file-preview.html";
  shell.onload = async () => {
    try {
      const file = await client().readDirectoryFile(id, path);
      if (!renderHtml(shell, file.text)) shell.replaceWith("Preview unavailable");
    } catch (error) {
      shell.replaceWith(String(error));
    }
  };
  page.body.append(shell);
}

function HtmlPreview({ document }: { document: DirectoryFile }) {
  const source = useSignal(false);
  const unavailable = useSignal(false);
  const shell = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    renderHtml(shell.current, document.text, true);
  }, [document.text, source.value]);
  return (
    <>
      <div class="html-preview-controls">
        <button
          type="button"
          aria-pressed={!source.value}
          onClick={() => {
            unavailable.value = false;
            source.value = false;
          }}
        >
          Preview
        </button>
        <button
          type="button"
          aria-pressed={source.value}
          onClick={() => {
            source.value = true;
            queueMicrotask(selectionChanged);
          }}
        >
          Source
        </button>
      </div>
      {source.value ? (
        <div class="file-preview">
          <pre>{document.text}</pre>
        </div>
      ) : unavailable.value ? (
        <p role="alert">Preview unavailable. Open Source.</p>
      ) : (
        <iframe
          class="html-preview"
          ref={shell}
          src="/file-preview.html"
          title={document.path}
          sandbox="allow-same-origin"
          onLoad={() => (unavailable.value = !renderHtml(shell.current, document.text, true))}
        />
      )}
    </>
  );
}

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
  const retrying = useSignal(false);
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
    <aside class="directory-files" aria-label="Files">
      <DirectoryHeader
        disabled={!owned || busy.value}
        refresh={() => {
          refreshed.value++;
        }}
      />
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
              const html = !entry.directory && htmlFile.test(path);
              return (
                <button
                  key={entry.name}
                  type="button"
                  class={file === path ? "on" : ""}
                  onDblClick={html && id !== undefined ? () => openHtml(id, path) : undefined}
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
              {active?.preparing && active.error && id
                ? (active.directory?.codeDirectory !== active.directory?.repoPath
                    ? [false, true]
                    : [false]
                  ).map((useExisting) => (
                    <button
                      key={String(useExisting)}
                      type="button"
                      disabled={retrying.value}
                      onClick={async () => {
                        retrying.value = true;
                        try {
                          await client().retrySessionSetup(id, useExisting);
                        } catch (failure) {
                          error.value =
                            failure instanceof Error ? failure.message : String(failure);
                        } finally {
                          retrying.value = false;
                        }
                      }}
                    >
                      {useExisting ? "Use existing checkout" : "Retry"}
                    </button>
                  ))
                : null}
            </p>
          ) : null}
          <section class="directory-document" aria-live="polite">
            {fileError.value ? (
              <p role="alert">{fileError.value}</p>
            ) : document ? (
              <>
                <div class="directory-filename">{document.path}</div>
                {htmlFile.test(document.path) ? (
                  <HtmlPreview key={`${id}:${document.path}`} document={document} />
                ) : (
                  <div class="file-preview">
                    {/\.md$/i.test(document.path) ? (
                      <Markdown text={document.text} />
                    ) : (
                      <pre>{document.text}</pre>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>{file === undefined ? "Choose a file." : "Loading…"}</p>
            )}
          </section>
          {document ? <QuoteSelection path={`${owned}/${document.path}`} /> : null}
        </>
      )}
    </aside>
  );
}

export function QuoteSelection({ path }: { path?: string }) {
  const id = rootId.value;
  const position = useSignal<{ left: number; top: number }>();
  const selector = path ? ".file-preview" : ".transcript .assistant > .md";
  function selected() {
    const selection = getSelection();
    if (selection?.rangeCount === 1) {
      const node = selection.getRangeAt(0).commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      if (element?.isConnected && element.closest(selector)) return selection;
    }
    if (!path) return undefined;
    const shell = document.querySelector<HTMLIFrameElement>(".html-preview");
    const doc = shell?.contentDocument?.querySelector("iframe")?.contentDocument;
    return doc?.URL === "about:srcdoc" ? doc.getSelection() : undefined;
  }
  useEffect(() => {
    const changed = () => {
      const selection = selected();
      if (!selection?.rangeCount || !selection.toString().trim()) {
        position.value = undefined;
        return;
      }
      const range = selection.getRangeAt(0);
      const box = range.getBoundingClientRect();
      const shell = document.querySelector<HTMLIFrameElement>(".html-preview");
      const frame = shell?.contentDocument?.querySelector("iframe");
      const inHtml = frame?.contentDocument === range.startContainer.ownerDocument;
      const x = inHtml
        ? (shell?.getBoundingClientRect().left ?? 0) + (frame?.getBoundingClientRect().left ?? 0)
        : 0;
      const y = inHtml
        ? (shell?.getBoundingClientRect().top ?? 0) + (frame?.getBoundingClientRect().top ?? 0)
        : 0;
      position.value = {
        left: box.right + x,
        top: box.bottom + y + 4 < innerHeight - 40 ? box.bottom + y + 4 : box.top + y - 36,
      };
    };
    changed();
    document.addEventListener("selectionchange", changed);
    window.addEventListener("scroll", changed, true);
    window.addEventListener("resize", changed);
    if (!path) document.addEventListener("keydown", quoteKey, true);
    return () => {
      document.removeEventListener("selectionchange", changed);
      window.removeEventListener("scroll", changed, true);
      window.removeEventListener("resize", changed);
      if (!path) document.removeEventListener("keydown", quoteKey, true);
    };
  }, [path, selector]);
  const at = position.value;
  return at ? (
    <button
      class={path ? "directory-ask" : "chat-ask"}
      type="button"
      style={{ "--quote-x": `${at.left}px`, "--quote-y": `${at.top}px` }}
      title="Ask about selected text (Alt+Enter)"
      aria-keyshortcuts="Alt+Enter"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const selection = selected();
        const text = selection?.toString() ?? "";
        if (
          !text.trim() ||
          rootId.peek() !== id ||
          (path && shown.peek() !== undefined) ||
          !document.querySelector('.editor textarea[aria-label="message"]')
        )
          return;
        setDraft(
          `${path ? `From ${path}` : "From the answer"}:\n> ${text.replaceAll("\n", "\n> ")}\n\n${draft.value}`,
        );
        selection?.removeAllRanges();
        run("prompt");
      }}
    >
      Ask agent
    </button>
  ) : null;
}

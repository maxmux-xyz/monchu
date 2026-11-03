import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { DirectoryCatalog } from "../api/directories.ts";
import { matching, Menu, type MenuItem } from "./menu.tsx";
import { directoryBrowser, directoryForm, threadLabel } from "./sessions.tsx";
import { client, rootId, roots } from "./state.ts";

const composer = '.editor textarea[aria-label="message"]';
const mention = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;

export function ProductMentions() {
  const query = useSignal<{ text: string; left: number; width: number; bottom: number }>();
  const selected = useSignal(0);
  const discovered = useSignal<DirectoryCatalog>();
  const failure = useSignal("");
  const products = roots.value.filter((root) => root.directory?.directoryType === "product");
  const firstPath = products[0]?.directory?.ownedDirectory;
  const scan = directoryBrowser.folder.value.trim() || firstPath?.replace(/[/\\][^/\\]+$/, "");
  useEffect(() => {
    query.value = undefined;
  }, [rootId.value]);
  const open = query.value !== undefined;
  useEffect(() => {
    if (
      !open ||
      !scan ||
      directoryBrowser.catalog.peek()?.root === scan ||
      discovered.peek()?.root === scan
    )
      return;
    let current = true;
    failure.value = "";
    void client()
      .discoverDirectories(scan)
      .then(
        (catalog) => {
          if (current) discovered.value = catalog;
        },
        (error: unknown) => {
          if (current) failure.value = String(error);
        },
      );
    return () => {
      current = false;
    };
  }, [open, scan]);

  const rows = useComputed(() => {
    const search = query.value?.text;
    if (search === undefined) return [];
    const byPath = new Map<string, string>();
    const catalog = directoryBrowser.catalog.value;
    for (const entry of (catalog?.root === scan ? catalog : discovered.value)?.directories ?? [])
      if (entry.directoryType === "product") byPath.set(entry.path, entry.name);
    for (const root of roots.value) {
      const directory = root.directory;
      if (directory?.directoryType === "product" && !byPath.has(directory.ownedDirectory))
        byPath.set(directory.ownedDirectory, root.label);
    }
    return matching(
      [...byPath].map(([id, name]) => ({
        id,
        label: `@${threadLabel(name)}`,
        detail: id,
      })),
      search,
    ).slice(0, 8);
  });

  function take(item: MenuItem) {
    const area = document.activeElement;
    if (!(area instanceof HTMLTextAreaElement) || !area.matches(composer)) return;
    const end = area.selectionStart;
    const token = mention.exec(area.value.slice(0, end))?.[1];
    if (token === undefined) return;
    area.setRangeText(
      `${item.label} (product directory: ${item.id}) `,
      end - token.length - 1,
      end,
      "end",
    );
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }

  useEffect(() => {
    const update = () => {
      const area = document.activeElement;
      const text =
        area instanceof HTMLTextAreaElement &&
        area.matches(composer) &&
        !area.value.startsWith("/") &&
        area.selectionStart === area.selectionEnd &&
        !directoryForm.peek()
          ? mention.exec(area.value.slice(0, area.selectionStart))?.[1]
          : undefined;
      if (text === undefined || !(area instanceof HTMLTextAreaElement)) {
        query.value = undefined;
        return;
      }
      const { left, top, width } = area.getBoundingClientRect();
      if (query.peek()?.text !== text) selected.value = 0;
      query.value = { text, left, width, bottom: innerHeight - top };
    };
    const key = (event: KeyboardEvent) => {
      if (
        !query.peek() ||
        !document.activeElement?.matches(composer) ||
        event.isComposing ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      const options = rows.peek();
      if (event.key === "Escape") query.value = undefined;
      else if (options.length && (event.key === "ArrowUp" || event.key === "ArrowDown"))
        selected.value =
          (selected.peek() + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      else if ((event.key === "Tab" || event.key === "Enter") && !event.shiftKey) {
        const item = options[Math.min(selected.peek(), options.length - 1)];
        if (!item) return;
        take(item);
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const moved = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") update();
    };
    document.addEventListener("input", update);
    document.addEventListener("click", update);
    document.addEventListener("focusin", update);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", moved);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("input", update);
      document.removeEventListener("click", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("keyup", moved);
      window.removeEventListener("resize", update);
    };
  }, []);

  const anchor = query.value;
  return anchor && !directoryForm.value ? (
    <div
      class="product-mentions"
      role="region"
      aria-label="Product mentions"
      style={{
        "--mention-left": `${anchor.left}px`,
        "--mention-width": `${anchor.width}px`,
        "--mention-bottom": `${anchor.bottom}px`,
      }}
    >
      <Menu
        label="Product directories"
        items={rows.value}
        query={anchor.text}
        selected={Math.min(selected.value, rows.value.length - 1)}
        empty={failure.value || "No matching product directories"}
        onTake={take}
      />
    </div>
  ) : null;
}

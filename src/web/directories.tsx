import { useEffect } from "preact/hooks";
import { run } from "./commands.ts";
import { roots } from "./state.ts";
import {
  directoryBrowser,
  browseDirectories,
  directoryCandidate,
  directoryForm,
  DirectoryInput,
} from "./sessions.tsx";

export function Directories() {
  const { folder, catalog, busy, error } = directoryBrowser;
  useEffect(() => {
    void browseDirectories();
  }, []);
  const listed = catalog.value;
  const entries = listed?.directories ?? [];
  return (
    <main class="directory-catalog" aria-label="Directories">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void browseDirectories();
        }}
      >
        <DirectoryInput label="Folder" name="directoryRoot" required value={folder} />
        <button type="submit" disabled={busy.value}>
          {busy.value ? "Scanning…" : "Scan"}
        </button>
      </form>
      {error.value ? <p role="alert">{error.value}</p> : null}
      <ul>
        {entries.map((item) => {
          const owner = roots.value.find(
            (session) => !session.archived && session.directory?.ownedDirectory === item.path,
          );
          return (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => {
                  if (owner) {
                    run("root.switch", owner.id);
                  } else {
                    directoryCandidate.value = item;
                    directoryForm.value = "new";
                  }
                }}
              >
                <span>
                  {item.name}
                  <small>{item.path}</small>
                </span>
                <span>
                  {owner?.directory?.directoryType ?? item.directoryType ?? "untyped"} ·{" "}
                  {owner ? "Resume" : "Open"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {listed?.more ? <p>Partial scan; choose a subfolder.</p> : null}
    </main>
  );
}

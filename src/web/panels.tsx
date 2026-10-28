import { RootsNew, RootsSheet, ROOTS } from "./roots.tsx";
import { useSignal } from "@preact/signals";
import { DIRECTORY_TYPES, type NewSession } from "../api/directories.ts";
import { randomId } from "../api/ids.ts";
import { run } from "./commands.ts";
import { client, rootId, roots } from "./state.ts";
import { directoryForm, directoryCandidate, DirectoryInput, SessionOptions } from "./sessions.tsx";
import { Files } from "./files.tsx";
import { Directories } from "./directories.tsx";

function SessionForm({ mode }: { mode: "new" | "assign" }) {
  const active = roots.value.find((item) => item.id === rootId.value);
  const candidate = directoryCandidate.value;
  const source =
    candidate === undefined
      ? active
      : (roots.value.find((item) => item.directory?.ownedDirectory === candidate.path) ?? active);
  const repository = useSignal(source?.directory?.repoPath ?? "");
  const owned = useSignal(candidate?.path ?? "");
  const checkout = useSignal("");
  const at = rootId.value;
  const busy = useSignal(false);
  const error = useSignal("");
  const request = useSignal(randomId());
  return (
    <section
      class="session-form"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "assign" ? "Assign directory" : "Open directory"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busy.value) directoryForm.value = undefined;
        }
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy.value) return;
          const fields = new FormData(event.currentTarget);
          const text = (name: string) => {
            const value = fields.get(name);
            return typeof value === "string" ? value.trim() : "";
          };
          const directoryType = DIRECTORY_TYPES.find((type) => type === text("directoryType"));
          if (directoryType === undefined) {
            error.value = "Choose a type";
            return;
          }
          const input: NewSession = {
            name: text("name"),
            agentRole: text("agentRole") === "worker" ? "worker" : "head",
            directoryType,
            repoPath: text("repoPath"),
            codeDirectory: text("codeDirectory") || text("repoPath"),
            ownedDirectory: text("ownedDirectory"),
          };
          busy.value = true;
          error.value = "";
          try {
            if (mode === "assign") {
              if (at === undefined) throw new Error("No session selected");
              await client().assignDirectory(at, input);
            } else {
              const id = await client().createSession(input, request.value);
              run("root.switch", id);
            }
            directoryForm.value = undefined;
          } catch (failure) {
            error.value = failure instanceof Error ? failure.message : String(failure);
          } finally {
            busy.value = false;
          }
        }}
      >
        <header role="presentation">
          <strong>{mode === "assign" ? "Assign directory" : "Open directory"}</strong>
          <button
            type="button"
            disabled={busy.value}
            onClick={() => {
              directoryForm.value = undefined;
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <label>
          Name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={candidate?.name ?? (mode === "assign" ? active?.label : "")}
            autoFocus
          />
        </label>
        <SessionOptions type={candidate?.directoryType ?? "product"} />
        <DirectoryInput label="Repository" name="repoPath" required value={repository} />
        <DirectoryInput
          label="Directory"
          name="ownedDirectory"
          required
          value={owned}
          base={repository.value}
        />
        <details>
          <summary>Advanced</summary>
          <DirectoryInput
            label="Source checkout"
            name="codeDirectory"
            placeholder="Same as repository"
            value={checkout}
            base={repository.value}
          />
        </details>
        {error.value ? <p role="alert">{error.value}</p> : null}
        <div class="session-form-actions">
          <button
            type="button"
            disabled={busy.value}
            onClick={() => {
              directoryForm.value = undefined;
            }}
          >
            Cancel
          </button>
          <button type="submit" disabled={busy.value}>
            {busy.value ? "Opening…" : mode === "assign" ? "Assign directory" : "Open"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function DirectoryPanels({ catalog = false }: { catalog?: boolean }) {
  return (
    <>
      {catalog ? <Directories /> : <Files />}
      {directoryForm.value === undefined ? null : (
        <SessionForm key={`${directoryForm.value}:${rootId.value}`} mode={directoryForm.value} />
      )}
    </>
  );
}

import { WorkersSheet, WORKERS } from "./workers.tsx";
import { PinsSheet, PINS } from "./pins.tsx";

export const SHEETS = {
  roots: { View: RootsSheet, spec: ROOTS, Primary: RootsNew },
  workers: { View: WorkersSheet, spec: WORKERS, Primary: undefined },
  pins: { View: PinsSheet, spec: PINS, Primary: undefined },
};

export { GoalsPanel, JobsPanel } from "./lists.tsx";

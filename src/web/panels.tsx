import { RootsNew, RootsSheet, ROOTS } from "./roots.tsx";
import { Check } from "typebox/value";
import type { ModelChoice } from "../api/client.ts";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
  DIRECTORY_TYPES,
  SESSION_THINKING_LEVELS,
  SessionInput,
  type NewSession,
  type CheckoutBranches,
  type DirectoryType,
} from "../api/directories.ts";
import { randomId } from "../api/ids.ts";
import { run } from "./commands.ts";
import { client, rootId, roots } from "./state.ts";
import {
  branchProposal,
  directoryForm,
  directoryCandidate,
  DirectoryInput,
  humanNotesShown,
  HumanNotes,
} from "./sessions.tsx";
import { Files, QuoteSelection } from "./files.tsx";
import { Directories } from "./directories.tsx";
import { ProductMentions } from "./product-mentions.tsx";

function SessionOptions({ type, role }: { type: DirectoryType; role?: NewSession["agentRole"] }) {
  return (
    <div class="session-fields">
      <label>
        Directory type
        <select name="directoryType">
          {DIRECTORY_TYPES.map((option) => (
            <option key={option} selected={option === type}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        Agent role
        <select name="agentRole">
          <option selected={role !== "worker"}>head</option>
          <option selected={role === "worker"}>worker</option>
        </select>
      </label>
    </div>
  );
}

function SessionForm({ mode }: { mode: "new" | "assign" | "branch" }) {
  const active = roots.value.find((item) => item.id === rootId.value);
  const proposal = mode === "branch" ? branchProposal.value : undefined;
  const seed = Check(SessionInput, proposal?.input) ? proposal.input : undefined;
  const candidate = mode === "branch" ? undefined : directoryCandidate.value;
  const source =
    candidate === undefined
      ? active
      : (roots.value.find((item) => item.directory?.ownedDirectory === candidate.path) ?? active);
  const repository = useSignal(seed?.repoPath ?? source?.directory?.repoPath ?? "");
  const owned = useSignal(seed?.ownedDirectory ?? candidate?.path ?? "");
  const checkout = useSignal(seed?.codeDirectory ?? "");
  const worktree = useSignal(mode !== "assign");
  const branches = useSignal<CheckoutBranches | undefined>(undefined);
  const branch = useSignal("");
  const branchError = useSignal("");
  useEffect(() => {
    branches.value = undefined;
    branch.value = "";
    branchError.value = "";
    const path = repository.value.trim();
    if (!worktree.value || !path) return;
    let current = true;
    const timer = setTimeout(() => {
      void client()
        .checkoutBranches(path)
        .then(
          (value) => {
            if (!current) return;
            branches.value = value;
            branch.value = value.current;
          },
          (failure: unknown) => {
            if (current)
              branchError.value = failure instanceof Error ? failure.message : String(failure);
          },
        );
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [repository.value, worktree.value]);
  const at = rootId.value;
  const busy = useSignal(false);
  const error = useSignal("");
  const request = useSignal(proposal === undefined ? randomId() : `branch:${at}:${proposal.id}`);
  const choices = useSignal<ModelChoice | undefined>(undefined);
  useEffect(() => {
    if (mode !== "branch" || at === undefined) return;
    let active = true;
    void client()
      .root(at)
      .modelChoice()
      .then((choice) => {
        if (active) choices.value = choice;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [at, mode]);
  return (
    <section
      class="session-form"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === "assign"
          ? "Assign directory"
          : mode === "branch"
            ? "Open subthread"
            : "Open directory"
      }
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
          if (worktree.value && (!branches.value || !branch.value)) {
            error.value = "Choose an available starting branch";
            return;
          }
          const input: NewSession = {
            name: text("name"),
            ...(mode === "branch" ? { brief: text("brief") } : {}),
            agentRole: text("agentRole") === "worker" ? "worker" : "head",
            directoryType,
            repoPath: text("repoPath"),
            codeDirectory: text("codeDirectory") || text("repoPath"),
            ownedDirectory: text("ownedDirectory"),
            ...(worktree.value && branches.value !== undefined
              ? { worktree: { provider: branches.value.provider, branch: branch.value } }
              : {}),
          };
          busy.value = true;
          error.value = "";
          try {
            if (mode === "assign") {
              if (at === undefined) throw new Error("No session selected");
              await client().assignDirectory(at, input);
            } else {
              const selected = text("model");
              const model = selected ? choices.value?.models[Number(selected)] : undefined;
              const thinkingLevel = SESSION_THINKING_LEVELS.find(
                (level) => level === text("thinking"),
              );
              const id = await client().createSession(
                input,
                request.value,
                mode === "branch" && at !== undefined
                  ? {
                      parent: at,
                      ...(model === undefined
                        ? {}
                        : { model: { provider: model.provider, modelId: model.id } }),
                      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
                    }
                  : undefined,
              );
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
          <strong>
            {mode === "assign"
              ? "Assign directory"
              : mode === "branch"
                ? "Open subthread"
                : "Open directory"}
          </strong>
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
            defaultValue={seed?.name ?? candidate?.name ?? (mode === "assign" ? active?.label : "")}
            autoFocus
          />
        </label>
        <SessionOptions
          type={seed?.directoryType ?? candidate?.directoryType ?? "product"}
          role={seed?.agentRole ?? "head"}
        />
        {mode === "branch" ? (
          <>
            <label>
              Initial prompt
              <textarea name="brief" rows={5} required defaultValue={seed?.brief} />
            </label>
            <label>
              Model
              <select name="model">
                <option value="">
                  Inherit parent{choices.value?.model ? ` · ${choices.value.model.name}` : ""}
                </option>
                {choices.value?.models.map((model, index) => (
                  <option key={index} value={index}>
                    {model.provider} / {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Thinking
              <select name="thinking">
                <option value="">
                  Inherit parent{choices.value ? ` · ${choices.value.thinkingLevel}` : ""}
                </option>
                {SESSION_THINKING_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <DirectoryInput label="Repository" name="repoPath" required value={repository} />
        <DirectoryInput
          label="Directory"
          name="ownedDirectory"
          required
          value={owned}
          base={repository.value}
        />
        {mode !== "assign" ? (
          <fieldset class="checkout-options" disabled={busy.value}>
            <legend>Local checkout</legend>
            <label>
              New worktree
              <input
                type="checkbox"
                name="worktree"
                checked={worktree.value}
                onChange={(event) => {
                  worktree.value = event.currentTarget.checked;
                }}
              />
            </label>
            {worktree.value ? (
              <label>
                Branch
                <select
                  name="branch"
                  required
                  value={branch.value}
                  disabled={branches.value === undefined}
                  onChange={(event) => {
                    branch.value = event.currentTarget.value;
                  }}
                >
                  {branches.value === undefined ? (
                    <option value="">
                      {branchError.value
                        ? "Unavailable"
                        : repository.value.trim()
                          ? "Loading…"
                          : "Choose a repository"}
                    </option>
                  ) : null}
                  {branches.value?.branches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {worktree.value && branchError.value ? <p role="alert">{branchError.value}</p> : null}
          </fieldset>
        ) : null}
        {worktree.value ? null : (
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
        )}
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
          <button
            type="submit"
            disabled={busy.value || (worktree.value && (!branches.value || !branch.value))}
          >
            {busy.value
              ? "Opening…"
              : mode === "assign"
                ? "Assign directory"
                : mode === "branch"
                  ? "Open subthread"
                  : "Open"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function DirectoryPanels({ catalog = false }: { catalog?: boolean }) {
  return (
    <>
      {catalog ? <Directories /> : humanNotesShown.value ? <HumanNotes /> : <Files />}
      {!catalog && (
        <>
          <QuoteSelection />
          <ProductMentions />
        </>
      )}
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

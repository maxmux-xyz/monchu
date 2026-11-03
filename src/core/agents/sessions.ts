import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  configure,
  defineExtension,
  defineTask,
  defineTool,
  hook,
  ToolTask,
  type ConversationId,
  type Extension,
  type Tx,
} from "@earendil-works/pi-durable";
import {
  SessionInput,
  type BranchOptions,
  type NewSession,
  type SessionDirectory,
} from "../../api/directories.ts";
import { shortId } from "../../api/ids.ts";
import type { MonchuConfig } from "../config.ts";
import type { CheckoutProvider } from "../../plugin.ts";
import { readDirectoryFile, resolveSession } from "../directories.ts";
import { preloadGroups } from "../tools/tool-search.ts";
import { FrontPicks, rootRecord, RootsDoc, type RootRecord } from "./root-records.ts";

export const SESSION_INSTRUCTIONS =
  "You are a directory-owning coding agent, directly available to the human in this session. Maintain your owned work records according to their directory rules, and do authorized work in the source checkout. A head may start_session when the human asks for independent work; a worker cannot spawn agents. Spawning is fire and forget: never wait for, monitor, collect reports from, or automatically message children or parents. Do not use legacy worker-routing tools. Your final answer belongs here. When waiting for a human decision, start your final answer with 'ask: ' so this session shows that it needs input. Keep the chat responsive and distinguish accepted work from completed work.";

export function checkDirectoryOwner(
  roots: readonly RootRecord[],
  input: SessionDirectory,
  preparing = false,
): void {
  const live = roots.filter((item) => !item.archived);
  if (live.some((item) => item.directory?.ownedDirectory === input.ownedDirectory))
    throw new Error("This directory already has a live session; resume it instead");
  if (
    !preparing &&
    (input.directoryType === "task" || input.directoryType === "experimental") &&
    live.some(
      (item) =>
        !item.checkoutPending &&
        item.directory?.codeDirectory === input.codeDirectory &&
        (item.directory.directoryType === "task" ||
          item.directory.directoryType === "experimental"),
    )
  )
    throw new Error("A code-writing session already owns this checkout; use a separate checkout");
}

function kickoff(home: string, providers: ReadonlyMap<string, CheckoutProvider>) {
  return defineTask<
    NewSession & { checkoutRequest?: string; scaffold?: true },
    { phase: "prepare" } | { phase: "submit" },
    null
  >({
    name: "monchu.session-kickoff",
    version: 1,
    initial: () => ({ phase: "prepare" }),
    phases: {
      prepare: async (task, runtime, context) => {
        const requestId = task.input.checkoutRequest;
        if (task.input.scaffold) {
          const directory = task.input.ownedDirectory;
          await mkdir(directory, { recursive: true });
          if ((await realpath(directory)) !== directory)
            throw new Error("The workspace path changed during setup");
          await writeFile(
            join(directory, "instruction.md"),
            `# ${task.input.name}\n\n${task.input.brief ?? ""}\n`,
            { flag: "wx" },
          ).catch((error: unknown) => {
            if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
              throw error;
          });
        }
        const prepared =
          requestId === undefined
            ? undefined
            : await resolveSession(task.input, home, { home, providers, requestId });
        await readDirectoryFile(task.input.ownedDirectory, "instruction.md");
        await runtime.commit(async (tx) => {
          if (prepared !== undefined) {
            const state = await tx.doc(RootsDoc);
            const root = rootRecord(state, runtime.conversationId);
            if (root?.directory === undefined) throw new Error("Session directory is missing");
            checkDirectoryOwner(
              state.roots.filter((item) => item.id !== root.id),
              prepared,
            );
            root.directory.codeDirectory = prepared.codeDirectory;
            delete root.checkoutPending;
            await configure(tx, root.id, { cwd: prepared.codeDirectory });
          }
          return { status: "running", checkpoint: { phase: "submit" } };
        }, context);
      },
      submit: async (task, runtime, context) => {
        const conversation = await runtime.conversation(runtime.conversationId, context);
        if (conversation === undefined) throw new Error("Session conversation is missing");
        await conversation.submit(
          {
            type: "input",
            content:
              task.input.brief ??
              "Read instruction.md and the current files in your owned directory. Summarize the current state and next step. Ask before starting new work.",
            requestId: `session-brief:${task.input.checkoutRequest ?? task.id}`,
          },
          context,
        );
        await runtime.commit(async (tx) => {
          if (task.input.checkoutRequest !== undefined) {
            const root = rootRecord(await tx.doc(RootsDoc), runtime.conversationId);
            if (root !== undefined) delete root.preparing;
          }
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }, context);
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });
}

export const Kickoff = kickoff("", new Map());

export async function resolveSessionForOpen(input: NewSession, base: string, branch = false) {
  const { worktree, ...directory } = input;
  const resolved = await resolveSession(directory, base, undefined, branch);
  return worktree === undefined ? resolved : { ...resolved, worktree };
}

export async function createSession(
  tx: Tx,
  input: NewSession & { scaffold?: true },
  requestId: string,
  config: MonchuConfig,
  extensions: readonly Extension[],
  preload: readonly string[],
  parent?: ConversationId,
  picks?: Pick<BranchOptions, "model" | "thinkingLevel">,
): Promise<ConversationId> {
  if (!requestId.trim()) throw new Error("A request ID is required");
  const state = await tx.doc(RootsDoc);
  if (parent !== undefined && rootRecord(state, parent)?.directory?.agentRole !== "head")
    throw new Error("Only a directory-bound head can spawn a session");
  const previous = state.roots.find((item) => item.requestId === requestId);
  if (previous !== undefined) return previous.id;
  const preparing = input.worktree !== undefined || input.scaffold === true;
  checkDirectoryOwner(state.roots, input, input.worktree !== undefined);
  const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
  const role = input.agentRole === "head" ? config.front : config.worker;
  await configure(tx, conversation.id, {
    cwd: input.codeDirectory,
    model: picks?.model ?? { provider: role.provider, modelId: role.modelId },
    thinkingLevel: picks?.thinkingLevel ?? role.thinkingLevel,
    instructions: SESSION_INSTRUCTIONS,
    extensions: { add: extensions },
  });
  if (picks?.model !== undefined || picks?.thinkingLevel !== undefined) {
    const state = await tx.doc(FrontPicks, conversation.id);
    state.model = picks.model !== undefined;
    state.thinkingLevel = picks.thinkingLevel !== undefined;
  }
  await preloadGroups(tx, conversation.id, preload);
  const startupTask = await tx.createTask(
    Kickoff,
    preparing ? { ...input, checkoutRequest: requestId } : input,
    {
      conversationId: conversation.id,
      ownership: { kind: "conversation" },
    },
  );
  state.roots.push({
    id: conversation.id,
    label: input.name,
    named: true,
    createdAt: Date.now(),
    requestId,
    directory: {
      repoPath: input.repoPath,
      codeDirectory: input.codeDirectory,
      ownedDirectory: input.ownedDirectory,
      directoryType: input.directoryType,
      agentRole: input.agentRole,
    },
    startupTask,
    ...(preparing ? { preparing: true } : {}),
    ...(input.worktree === undefined ? {} : { checkoutPending: true }),
    ...(parent === undefined ? {} : { spawnedBy: parent }),
  });
  return conversation.id;
}

const CREW_TOOLS = new Set([
  "start_worker",
  "message_worker",
  "worker_status",
  "close_workers",
  "reopen_worker",
  "post_update",
  "user_messages",
  "stop_worker",
  "list_roots",
  "message_root",
  "hand_off_worker",
  "job",
]);

export function createSessions(
  config: () => MonchuConfig,
  extensions: readonly Extension[],
  preload: readonly string[],
  home: string,
  providers: ReadonlyMap<string, CheckoutProvider>,
) {
  return defineExtension({
    name: "monchu.sessions",
    tasks: [kickoff(home, providers)],
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if (
            call.name !== "propose_subthread" &&
            call.name !== "start_session" &&
            !CREW_TOOLS.has(call.name)
          )
            return;
          const roots = await api.snapshot(RootsDoc, context);
          const directory =
            roots === undefined ? undefined : rootRecord(roots, api.conversationId)?.directory;
          if (call.name === "start_session" || call.name === "propose_subthread") {
            if (directory?.agentRole !== "head")
              return { block: "Only a directory-bound head can spawn a session" };
            return;
          }
          if (directory !== undefined)
            return {
              block:
                "Directory sessions work independently. Use start_session from a head; legacy crew routing and jobs are unavailable.",
            };
        },
      }),
    ],
    tools: [
      defineTool({
        name: "start_session",
        description:
          "Head agents only: open an independent directory-bound head or worker for work the human authorized. Choose an existing, distinct owned work directory with instruction.md. Create new work through the applicable task skill first. An optional brief becomes the initial message. Use a separate source checkout when another task already writes there. Returns acceptance, never waits for the answer, and never reports results to this session. Workers cannot spawn. Directory types: task, product, design, experimental, data-science, recurring, recruiting.",
        parameters: SessionInput,
        replay: "safe",
        executionMode: "sequential",
        execute: async (args, api, context) => {
          const current = await api.agent(context);
          const requestId = `session:${api.taskId}:${api.callId}`;
          const previous = (await api.snapshot(RootsDoc, context))?.roots.find(
            (item) => item.requestId === requestId,
          );
          if (previous !== undefined)
            return {
              output: [
                {
                  type: "text",
                  text: `Opened ${previous.label} (${shortId(previous.id)}). It runs independently and is available directly in the session tree.`,
                },
              ],
            };
          const input = await resolveSessionForOpen(args, current.cwd ?? ".");
          const id = await api.commit(
            (tx) =>
              createSession(
                tx,
                input,
                requestId,
                config(),
                extensions,
                preload,
                api.conversationId,
              ),
            context,
          );
          return {
            output: [
              {
                type: "text",
                text: `Opened ${input.name} (${shortId(id)}). It runs independently and is available directly in the session tree.`,
              },
            ],
          };
        },
      }),
    ],
  });
}

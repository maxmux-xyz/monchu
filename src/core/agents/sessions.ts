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
import { SessionInput, type NewSession, type SessionDirectory } from "../../api/directories.ts";
import { shortId } from "../../api/ids.ts";
import type { MonchuConfig } from "../config.ts";
import { readDirectoryFile, resolveSession } from "../directories.ts";
import { preloadGroups } from "../tools/tool-search.ts";
import { rootRecord, RootsDoc, type RootRecord } from "./root-records.ts";

export const SESSION_INSTRUCTIONS =
  "You are a directory-owning coding agent, directly available to the human in this session. Maintain your owned work records according to their directory rules, and do authorized work in the source checkout. A head may start_session when the human asks for independent work; a worker cannot spawn agents. Spawning is fire and forget: never wait for, monitor, collect reports from, or automatically message children or parents. Do not use legacy worker-routing tools. Your final answer belongs here. When waiting for a human decision, start your final answer with 'ask: ' so this session shows that it needs input. Keep the chat responsive and distinguish accepted work from completed work.";

export function checkDirectoryOwner(roots: readonly RootRecord[], input: SessionDirectory): void {
  const live = roots.filter((item) => !item.archived);
  if (live.some((item) => item.directory?.ownedDirectory === input.ownedDirectory))
    throw new Error("This directory already has a live session; resume it instead");
  if (
    (input.directoryType === "task" || input.directoryType === "experimental") &&
    live.some(
      (item) =>
        item.directory?.codeDirectory === input.codeDirectory &&
        (item.directory.directoryType === "task" ||
          item.directory.directoryType === "experimental"),
    )
  )
    throw new Error("A code-writing session already owns this checkout; use a separate checkout");
}

const Kickoff = defineTask<NewSession, { phase: "prepare" } | { phase: "submit" }, null>({
  name: "monchu.session-kickoff",
  version: 1,
  initial: () => ({ phase: "prepare" }),
  phases: {
    prepare: async (task, runtime, context) => {
      await readDirectoryFile(task.input.ownedDirectory, "instruction.md");
      await runtime.commit(() => ({ status: "running", checkpoint: { phase: "submit" } }), context);
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
          requestId: `session-brief:${task.id}`,
        },
        context,
      );
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        context,
      );
    },
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export async function createSession(
  tx: Tx,
  input: NewSession,
  requestId: string,
  config: MonchuConfig,
  extensions: readonly Extension[],
  preload: readonly string[],
  parent?: ConversationId,
): Promise<ConversationId> {
  if (!requestId.trim()) throw new Error("A request ID is required");
  const state = await tx.doc(RootsDoc);
  if (parent !== undefined && rootRecord(state, parent)?.directory?.agentRole !== "head")
    throw new Error("Only a directory-bound head can spawn a session");
  const previous = state.roots.find((item) => item.requestId === requestId);
  if (previous !== undefined) return previous.id;
  checkDirectoryOwner(state.roots, input);
  const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
  const role = input.agentRole === "head" ? config.front : config.worker;
  await configure(tx, conversation.id, {
    cwd: input.codeDirectory,
    model: { provider: role.provider, modelId: role.modelId },
    thinkingLevel: role.thinkingLevel,
    instructions: SESSION_INSTRUCTIONS,
    extensions: { add: extensions },
  });
  await preloadGroups(tx, conversation.id, preload);
  const startupTask = await tx.createTask(Kickoff, input, {
    conversationId: conversation.id,
    ownership: { kind: "conversation" },
  });
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
) {
  return defineExtension({
    name: "monchu.sessions",
    tasks: [Kickoff],
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if (call.name !== "start_session" && !CREW_TOOLS.has(call.name)) return;
          const roots = await api.snapshot(RootsDoc, context);
          const directory =
            roots === undefined ? undefined : rootRecord(roots, api.conversationId)?.directory;
          if (call.name === "start_session") {
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
          const input = await resolveSession(args, current.cwd ?? ".");
          const id = await api.commit(
            (tx) =>
              createSession(
                tx,
                input,
                `session:${api.taskId}:${api.callId}`,
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

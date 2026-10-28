import { defineExtension, section } from "@earendil-works/pi-durable";
import { open, opendir, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DIRECTORY_TYPES } from "../api/directories.ts";
import type {
  DirectoryCatalog,
  DirectoryFile,
  DirectoryListing,
  FolderListing,
  DirectoryType,
  NewSession,
  SessionDirectory,
} from "../api/directories.ts";
import { rootRecord, RootsDoc } from "./agents/root-records.ts";
import { resolveDirectory } from "./workdir.ts";

const RULES: Record<DirectoryType, string> = {
  task: "Deliver a bounded change. Define scope and Done When in instruction.md. Complete plan.md before implementation; leave progress.md empty until implementation begins. Then keep current state, next step, blockers, and verification current. Follow staged → ready → in-progress → verify → archive. Staged work needs human approval to start. Merged is not deployed or verified. Preserve the folder name when moving it.",
  product:
    "Maintain an ongoing product area. instruction.md defines scope, sources, file map, and retirement. Keep goals, requirements, current behavior, feature notes, smoke evidence, and history in separate files when useful. Do not create a catch-all progress.md. Direct code implementation belongs in a separate task. Keep each fact in one place and retire superseded claims.",
  design:
    "Deliver a reviewed proposal, not a merge. Maintain instruction.md, progress.md, and proposal or decision files as needed. Keep problem, constraints, options, tradeoffs, and review decisions current. Stay in design until accepted or abandoned. Do not start implementation without an explicit human request.",
  experimental:
    "Investigate optional work. Maintain instruction.md, progress.md, and useful experiment evidence. State the question and conclusion. Do not automatically promote optional work onto the implementation path. Retire the experiment when it has an answer or the human drops it.",
  "data-science":
    "Answer a bounded analysis question. Maintain instruction.md and progress.md; put the answer in result.md or artifacts when useful. Preserve methods, evidence, limitations, and conclusions. Implementation and recurring follow-ups need explicit authorization and separate directories linked to this analysis.",
  recurring:
    "Maintain a standing loop in one stable directory. instruction.md defines cadence, per-run outputs, and retirement. progress.md tracks the last run, next run, and blockers. Put each run in runs/<date>/. A finished run does not finish the loop. Retire it only when the human asks. This directory type does not itself schedule any job.",
  recruiting:
    "Maintain one tracker per open role or requisition. instruction.md defines the role, scope, hiring stages, owners, sources, and closing condition. pipeline.md owns candidates, current stage, next action, owner, and last update. Keep candidate data minimal and assessments job-related. Update material transitions; retire the tracker when the role is closed and remaining actions are resolved.",
};

export async function resolveSession(input: NewSession, base: string): Promise<NewSession> {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("A session needs a name of at most 80 characters");
  if (input.brief !== undefined && !input.brief.trim())
    throw new Error("An initial message cannot be blank");
  if (!Object.hasOwn(RULES, input.directoryType)) throw new Error("Unknown directory type");
  if (input.agentRole !== "head" && input.agentRole !== "worker")
    throw new Error("Unknown agent role");
  const repoPath = await realpath(await resolveDirectory(input.repoPath, base));
  const codeDirectory = await realpath(await resolveDirectory(input.codeDirectory, repoPath));
  if (!input.ownedDirectory.trim()) throw new Error("An owned directory is required");
  const ownedDirectory = await realpath(await resolveDirectory(input.ownedDirectory, repoPath));
  const instruction = await readDirectoryFile(ownedDirectory, "instruction.md").catch(() => {
    throw new Error(
      "Choose an existing directory with a readable instruction.md. Create new work through chat using the task skill first.",
    );
  });
  if (!instruction.text.trim()) throw new Error("The directory's instruction.md is empty");
  return { ...input, name, repoPath, codeDirectory, ownedDirectory };
}

export async function browseFolders(
  path: string,
  home: string,
  base?: string,
  query = "",
): Promise<FolderListing> {
  const relativePath = !isAbsolute(path) && path !== "~" && !path.startsWith("~/");
  const start = base !== undefined && relativePath ? await resolveDirectory(base, home) : home;
  const folder = await realpath(await resolveDirectory(path, start));
  const search = query.trim().toLowerCase();
  const folders = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes(search))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const parent = dirname(folder);
  return {
    path: folder,
    ...(parent === folder ? {} : { parent }),
    folders: folders.slice(0, 200),
    more: folders.length > 200,
  };
}

export async function discoverDirectories(path: string, base: string): Promise<DirectoryCatalog> {
  const root = await realpath(await resolveDirectory(path, base));
  const directories: DirectoryCatalog["directories"] = [];
  const pending = [root];
  let visited = 0;
  let entries = 0;
  let more = false;
  while (pending.length && visited < 2000 && entries < 20_000 && directories.length < 200) {
    const current = pending.pop();
    if (current === undefined) break;
    visited++;
    let instruction = false;
    for await (const entry of await opendir(current)) {
      if (++entries > 20_000) {
        more = true;
        break;
      }
      if (entry.name === "instruction.md" && entry.isFile()) instruction = true;
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        if (pending.length + visited < 2000) pending.push(join(current, entry.name));
        else more = true;
      }
    }
    if (instruction) {
      const file = await readDirectoryFile(current, "instruction.md");
      const name = (/^#\s+(.+)$/m.exec(file.text)?.[1]?.trim() || basename(current)).slice(0, 80);
      const directoryType = current
        .split(sep)
        .toReversed()
        .map((part) =>
          ["staged", "ready", "in-progress", "verify"].includes(part)
            ? ("task" as const)
            : DIRECTORY_TYPES.find((type) => type === part),
        )
        .find((type) => type !== undefined);
      directories.push({
        path: current,
        name,
        ...(directoryType === undefined ? {} : { directoryType }),
      });
    }
  }
  return {
    root,
    directories: directories.sort((left, right) => left.name.localeCompare(right.name)),
    more: more || pending.length > 0,
  };
}

async function within(directory: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error("Use a path relative to the owned directory");
  const root = await realpath(directory);
  const candidate = await realpath(resolve(root, path));
  const part = relative(root, candidate);
  if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part))
    throw new Error("Path is outside the owned directory");
  return candidate;
}

export async function listDirectory(directory: string, path: string): Promise<DirectoryListing> {
  const entries = await readdir(await within(directory, path), { withFileTypes: true });
  const sorted = entries
    .filter((entry) => !entry.isSymbolicLink())
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
  return {
    path,
    entries: sorted
      .slice(0, 200)
      .map((entry) => ({ name: entry.name, directory: entry.isDirectory() })),
    more: sorted.length > 200,
  };
}

export async function readDirectoryFile(directory: string, path: string): Promise<DirectoryFile> {
  const handle = await open(await within(directory, path), "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Not a regular file");
    if (info.size > 256 * 1024) throw new Error("File exceeds the 256 KiB preview limit");
    const bytes = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 256 * 1024) throw new Error("File exceeds the 256 KiB preview limit");
    const data = bytes.subarray(0, bytesRead);
    if (data.includes(0)) throw new Error("Binary files cannot be previewed");
    return { path, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
  } finally {
    await handle.close();
  }
}

function directoryInstructions(directory: SessionDirectory): string {
  return `Directory type: ${directory.directoryType}\n${RULES[directory.directoryType]}\nDeduplicate before creating work. Keep material decisions, current state, and next steps current. Do not create INDEX, DONE, LOCK, or EXIT markers. The human's instructions and repository rules take precedence. Never edit another agent's owned directory. Keep the bound directory at its current path while this session is live; propose lifecycle moves to the human.`;
}

export const Directories = defineExtension({
  name: "monchu.directories",
  sections: [
    section("directory", async (input, context) => {
      const roots = await input.read.snapshot(RootsDoc, context);
      const directory =
        roots === undefined ? undefined : rootRecord(roots, input.conversationId)?.directory;
      if (directory === undefined) return "No owned work directory assigned.";
      const instructions = await readDirectoryFile(directory.ownedDirectory, "instruction.md")
        .then((file) => file.text)
        .catch(
          (error: unknown) =>
            `Cannot read directory instructions: ${error instanceof Error ? error.message : String(error)}. Tell the user; do not substitute another directory.`,
        );
      return `${directoryInstructions(directory)}\nRepository: ${directory.repoPath}\nSource checkout: ${directory.codeDirectory}\nOwned records: ${directory.ownedDirectory}\n\n${instructions}`;
    }),
  ],
});

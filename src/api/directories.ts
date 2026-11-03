import { Type } from "typebox";

export const DIRECTORY_TYPES = [
  "task",
  "product",
  "design",
  "experimental",
  "data-science",
  "recurring",
  "recruiting",
] as const;

export type DirectoryType = (typeof DIRECTORY_TYPES)[number];

export type SessionDirectory = {
  repoPath: string;
  codeDirectory: string;
  ownedDirectory: string;
  directoryType: DirectoryType;
  agentRole: "head" | "worker";
};

export type CheckoutBranches = { provider: string; branches: string[]; current: string };

export type NewSession = SessionDirectory & {
  name: string;
  brief?: string;
  worktree?: { provider: string; branch: string };
};

export const SessionInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    brief: Type.Optional(Type.String({ minLength: 1 })),
    agentRole: Type.Enum(["head", "worker"]),
    directoryType: Type.Enum(DIRECTORY_TYPES),
    repoPath: Type.String({ minLength: 1 }),
    codeDirectory: Type.String({ minLength: 1 }),
    ownedDirectory: Type.String({ minLength: 1 }),
    worktree: Type.Optional(
      Type.Object(
        {
          provider: Type.String({ minLength: 1 }),
          branch: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SESSION_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const BranchOptions = Type.Object({
  parent: Type.String({ minLength: 1 }),
  model: Type.Optional(Type.Object({ provider: Type.String(), modelId: Type.String() })),
  thinkingLevel: Type.Optional(Type.Enum(SESSION_THINKING_LEVELS)),
});
export type BranchOptions = import("typebox").Static<typeof BranchOptions>;

export type DirectoryListing = {
  path: string;
  entries: { name: string; directory: boolean }[];
  more: boolean;
};

export type DirectoryFile = { path: string; text: string };

export type ManagedDirectory = { path: string; name: string; directoryType?: DirectoryType };
export type DirectoryCatalog = { root: string; directories: ManagedDirectory[]; more: boolean };

export type FolderListing = {
  path: string;
  parent?: string;
  folders: string[];
  more: boolean;
};

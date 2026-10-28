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

export type NewSession = SessionDirectory & { name: string; brief?: string };

export const SessionInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    brief: Type.Optional(Type.String({ minLength: 1 })),
    agentRole: Type.Enum(["head", "worker"]),
    directoryType: Type.Enum(DIRECTORY_TYPES),
    repoPath: Type.String({ minLength: 1 }),
    codeDirectory: Type.String({ minLength: 1 }),
    ownedDirectory: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

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

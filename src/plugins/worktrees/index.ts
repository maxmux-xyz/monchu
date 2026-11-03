import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { definePlugin } from "../../plugin.ts";

const exec = promisify(execFile);

async function run(command: string, cwd: string, args: string[]): Promise<string> {
  const result = await exec(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 512 * 1024,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function jjRepository(path: string): Promise<string> {
  const repo = join(path, ".jj", "repo");
  return realpath(
    (await stat(repo)).isDirectory()
      ? repo
      : resolve(path, ".jj", (await readFile(repo, "utf8")).trim()),
  );
}

export default definePlugin((monchu) => {
  monchu.registerCheckouts({
    async branches(repoPath) {
      if (existsSync(join(repoPath, ".jj"))) {
        const names = await run("jj", repoPath, [
          "--ignore-working-copy",
          "--no-pager",
          "bookmark",
          "list",
          "-T",
          'if(present && !conflict, name ++ "\\n")',
        ]);
        return { branches: ["@", ...names.split("\n").filter(Boolean)], current: "@" };
      }
      if (!existsSync(join(repoPath, ".git"))) return;
      const names = await run("git", repoPath, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ]);
      const current = await run("git", repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      return { branches: [...new Set([current, ...names.split("\n").filter(Boolean)])], current };
    },
    async create(repoPath, path, branch) {
      const jj = existsSync(join(repoPath, ".jj"));
      if (existsSync(path)) {
        if (!existsSync(join(path, jj ? ".jj" : ".git")))
          throw new Error("The session checkout path is not a registered checkout");
        const source = jj
          ? await jjRepository(repoPath)
          : await realpath(
              await run("git", repoPath, [
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
              ]),
            );
        const target = jj
          ? await jjRepository(path)
          : await realpath(
              await run("git", path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
            );
        if (source !== target)
          throw new Error("The session checkout belongs to another repository");
        return;
      }
      if (jj) {
        // Resolve before workspace add snapshots the source, so dirty source files are never copied.
        const revision = await run("jj", repoPath, [
          "--ignore-working-copy",
          "--no-pager",
          "log",
          "--no-graph",
          "--revision",
          branch === "@" ? "@" : JSON.stringify(branch),
          "-T",
          "commit_id",
        ]);
        await run("jj", repoPath, [
          "--no-pager",
          "workspace",
          "add",
          "--name",
          basename(path),
          "--revision",
          revision,
          "--",
          path,
        ]);
      } else {
        await run("git", repoPath, ["worktree", "add", "--detach", path, branch]);
      }
    },
  });
});

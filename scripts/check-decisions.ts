import { execFileSync } from "node:child_process";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Runs git but returns "" instead of throwing (e.g. on an unborn branch). */
function gitSafe(...args: string[]): string {
  try {
    return git(...args);
  } catch {
    return "";
  }
}

const commits = gitSafe("log", "--since=6 hours ago", "--format=%H")
  .split("\n")
  .filter(Boolean);

if (commits.length === 0) {
  console.log("No commits in the last six hours; decision cadence check skipped.");
  process.exit(0);
}

const oldest = commits.at(-1)!;
// The root commit has no parent, so diff against the empty tree instead of `<oldest>^`.
const parent = gitSafe("rev-parse", "--verify", "--quiet", `${oldest}^`);
const base = parent || git("hash-object", "-t", "tree", "/dev/null");

const changedFiles = git("diff", "--name-only", base, "HEAD")
  .split("\n")
  .filter(Boolean);
const domainChanged = changedFiles.some((path) => path.startsWith("packages/domain/"));
const decisionsChanged = changedFiles.some((path) => /^docs\/decisions\/\d{4}-/.test(path));

if (domainChanged && !decisionsChanged) {
  console.error(
    "Domain code changed without a contemporaneous ADR in docs/decisions. " +
      "Run scripts/adr.sh and document the decision honestly.",
  );
  process.exit(1);
}

console.log("Decision cadence check passed.");

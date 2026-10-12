import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function openEditor(filePath: string): void {
  const editor = process.env.EDITOR ?? process.env.VISUAL;

  if (!editor) {
    throw new Error("No editor configured. Set $EDITOR or $VISUAL.");
  }

  const result = spawnSync(editor, [filePath], {
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Editor exited with code ${result.status}`);
  }
}

let envLoaded = false;
/** Load the .env file of the current directory once, if it exists */
export function loadEnv() {
  if (envLoaded) return;
  envLoaded = true;
  if (existsSync(".env")) process.loadEnvFile(".env");
}

/** Log line that says which database and migration are used */
export function describeTarget(database: string | undefined, migrationPath?: string, direction?: string) {
  let text = `Using ${database ?? "no database"} as database target`;
  if (direction) text += ` for direction ${direction}`;
  if (migrationPath) text += `${direction ? " and" : ""} migration: ${migrationPath.substring(migrationPath.lastIndexOf("/") + 1)}`;
  return text;
}

/**
 * Timestamp for new file names: YYYYMMDDHHmmssSSS in UTC. Has no ":" so the
 * names are valid on Windows, and sorts after the old ISO names
 * (2025-01-01T...), so existing files keep running first.
 */
export function fileTimestamp(date: Date = new Date()) {
  return date.toISOString().replace(/[-:T.Z]/g, "");
}

/** Removes the timestamp prefix of a migration or seed file name (new and old formats) */
export function stripTimestamp(name: string) {
  return name.replace(/^(\d{17}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(\.\d+)?Z?)-/, "");
}

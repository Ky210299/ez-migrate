import { existsSync } from "node:fs";
import type { Config } from "./types";
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

/** Read the connection data from the environment variables named in envKeys */
export function connectionDataFromEnv(envKeys: Config["envKeys"]) {
  loadEnv();
  const { env: ENV } = process;
  const port = ENV[envKeys.port];
  return {
    host: ENV[envKeys.host],
    user: ENV[envKeys.user],
    password: ENV[envKeys.password],
    port: port ? Number(port) : undefined,
    database: ENV[envKeys.database],
  };
}

/** Log line that says which database and migration are used */
export function describeTarget(database: string | undefined, migrationPath?: string, direction?: string) {
  let text = `Using ${database ?? "no database"} as database target`;
  if (direction) text += ` for direction ${direction}`;
  if (migrationPath) text += `${direction ? " and" : ""} migration: ${migrationPath.substring(migrationPath.lastIndexOf("/") + 1)}`;
  return text;
}

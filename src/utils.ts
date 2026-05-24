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

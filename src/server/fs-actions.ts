import { dirname } from "node:path";
import { json } from "./http";

export async function openInFileManager(
  path: string,
  reveal: boolean,
): Promise<Response> {
  let command: string[];
  if (process.platform === "darwin") {
    command = reveal ? ["open", "-R", path] : ["open", path];
  } else if (process.platform === "win32") {
    command = reveal ? ["explorer", `/select,${path}`] : ["explorer", path];
  } else {
    command = ["xdg-open", reveal ? dirname(path) : path];
  }

  try {
    const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    const timeout = setTimeout(() => proc.kill(), 4_000);
    await proc.exited;
    clearTimeout(timeout);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not open the system file manager." }, 500);
  }
}

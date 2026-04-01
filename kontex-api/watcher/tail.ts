import chokidar from "chokidar"
import { createReadStream } from "fs"
import { stat } from "fs/promises"
import * as path from "path"
import * as os from "os"
import { parseLine, ParsedEvent } from "./parser"

const CLAUDE_LOG_DIR = path.join(os.homedir(), ".claude", "projects")

export interface TailOptions {
  onEvent: (event: ParsedEvent, filePath: string) => void
  onNewFile: (filePath: string) => void
}

export function startWatcher(options: TailOptions): () => void {
  const watcher = chokidar.watch(`${CLAUDE_LOG_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  })

  const filePositions = new Map<string, number>()

  watcher.on("add", (filePath: string) => {
    filePositions.set(filePath, 0)
    options.onNewFile(filePath)
    readNewLines(filePath, filePositions, options.onEvent)
  })

  watcher.on("change", (filePath: string) => {
    readNewLines(filePath, filePositions, options.onEvent)
  })

  return () => { watcher.close() }
}

function readNewLines(
  filePath: string,
  positions: Map<string, number>,
  onEvent: (event: ParsedEvent, filePath: string) => void
): void {
  const start = positions.get(filePath) ?? 0

  // Check current file size first; skip if nothing new
  stat(filePath)
    .then((s) => {
      if (s.size <= start) return

      let buffer = ""
      let bytesRead = 0

      const stream = createReadStream(filePath, {
        encoding: "utf8",
        start,
      })

      stream.on("data", (chunk: string) => {
        buffer += chunk
        bytesRead += Buffer.byteLength(chunk, "utf8")
      })

      stream.on("end", () => {
        positions.set(filePath, start + bytesRead)

        const lines = buffer.split("\n")
        for (const line of lines) {
          if (!line.trim()) continue
          const event = parseLine(line)
          if (event !== null) {
            onEvent(event, filePath)
          }
        }
      })

      stream.on("error", (err: Error) => {
        console.error(`[watcher] Error reading ${filePath}:`, err.message)
      })
    })
    .catch((err: Error) => {
      console.error(`[watcher] Could not stat ${filePath}:`, err.message)
    })
}

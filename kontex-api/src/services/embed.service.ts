import { VoyageAIClient } from "voyageai"
import { QdrantClient } from "@qdrant/js-client-rest"
import { config } from "../config"
import { readBundle } from "./bundle.service"
import { db } from "../db"
import type { ContextBundle } from "../types/bundle"
import type { Snapshot, Task, Session } from "@prisma/client"

const voyage = new VoyageAIClient({ apiKey: config.VOYAGE_API_KEY })
const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY })

type SnapshotWithTaskSession = Snapshot & {
  task: Task & { session: Session }
}

function buildEmbedInput(snapshot: SnapshotWithTaskSession, bundle: ContextBundle): string {
  const filePaths = bundle.files.map(f => f.path).join(", ")
  const toolNames = bundle.toolCalls.map(t => t.tool).join(", ")
  const reasoning = bundle.reasoning ? bundle.reasoning.slice(0, 500) : ""

  return [
    `${snapshot.label} | ${snapshot.task.name} | ${snapshot.task.session.name}`,
    `Files: ${filePaths}`,
    `Tools: ${toolNames}`,
    `Reasoning: ${reasoning}`,
  ].join("\n")
}

export async function embedSnapshot(snapshotId: string): Promise<void> {
  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } },
  })
  if (!snapshot) throw new Error("Snapshot not found")

  const bundle = await readBundle(snapshot.r2Key)

  const input = buildEmbedInput(snapshot, bundle)

  const result = await voyage.embed({ input: [input], model: "voyage-code-3" })
  const vector = result.data?.[0]?.embedding
  if (!vector) throw new Error("No embedding returned from Voyage AI")

  await qdrant.upsert(config.QDRANT_COLLECTION, {
    wait: true,
    points: [
      {
        id: snapshotId,
        vector,
        payload: {
          snapshotId,
          taskId: snapshot.taskId,
          sessionId: snapshot.task.sessionId,
          userId: snapshot.task.session.userId,
          label: snapshot.label,
          source: snapshot.source,
          createdAt: snapshot.createdAt.toISOString(),
        },
      },
    ],
  })

  await db.snapshot.update({ where: { id: snapshotId }, data: { embedded: true } })
}

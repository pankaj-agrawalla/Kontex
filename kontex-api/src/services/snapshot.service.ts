import { nanoid } from "nanoid";
import { get_encoding } from "tiktoken";
import { Snapshot } from "@prisma/client";
import { db } from "../db";
import { config } from "../config";
import { redis } from "../redis";
import { writeBundle, readBundle, mergeBundle } from "./bundle.service";
import {
  ContextBundle,
  ContextFile,
  ToolCall,
  LogEvent,
} from "../types/bundle";
import { SnapshotSource } from "../types/api";

function generateId(): string {
  return nanoid(21);
}

function countTokens(bundle: ContextBundle): number {
  const enc = get_encoding("cl100k_base");

  let total = 0;

  for (const msg of bundle.messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
    total += enc.encode(text).length;
  }

  for (const file of bundle.files) {
    total += file.tokenCount;
  }

  enc.free();
  return total;
}

export async function createSnapshot(params: {
  taskId: string;
  label: string;
  bundle: ContextBundle;
  userId: string;
}): Promise<Snapshot> {
  const task = await db.task.findUnique({
    where: { id: params.taskId },
    include: { session: true },
  });
  if (!task || task.session.userId !== params.userId) {
    throw new Error("NOT_FOUND: Task not found");
  }

  const tokenTotal = params.bundle.tokenTotal || countTokens(params.bundle);

  const snapshotId = generateId();
  const bundleWithId: ContextBundle = {
    ...params.bundle,
    snapshotId,
    tokenTotal,
  };

  const r2Key = await writeBundle(snapshotId, bundleWithId);

  const snapshot = await db.snapshot.create({
    data: {
      id: snapshotId,
      taskId: params.taskId,
      label: params.label,
      tokenTotal,
      model: params.bundle.model,
      source: params.bundle.source,
      r2Key,
    },
  });

  redis
    .rpush("kontex:embed_jobs", JSON.stringify({ snapshotId: snapshot.id }))
    .catch((err: Error) => console.error("Failed to queue embed job:", err))

  return snapshot;
}

export async function getSnapshot(
  snapshotId: string,
  userId: string
): Promise<{ snapshot: Snapshot; bundle: ContextBundle }> {
  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } },
  });
  if (!snapshot || snapshot.task.session.userId !== userId) {
    throw new Error("NOT_FOUND: Snapshot not found");
  }
  const bundle = await readBundle(snapshot.r2Key);
  return { snapshot, bundle };
}

export async function rollbackToSnapshot(params: {
  snapshotId: string
  userId: string
}): Promise<{
  rollbackSnapshotId: string
  sourceSnapshotId: string
  label: string
  capturedAt: string
  tokenTotal: number
  bundle: ContextBundle
}> {
  const { snapshot, bundle } = await getSnapshot(params.snapshotId, params.userId)

  const newSnapshotId = generateId()
  const newBundle: ContextBundle = {
    ...bundle,
    snapshotId: newSnapshotId,
    capturedAt: new Date().toISOString(),
    source: snapshot.source as SnapshotSource,
    enriched: false,
    logEvents: [],
  }

  const r2Key = await writeBundle(newSnapshotId, newBundle)

  const newSnapshot = await db.snapshot.create({
    data: {
      id: newSnapshotId,
      taskId: snapshot.taskId,
      label: `Rollback to: ${snapshot.label}`,
      tokenTotal: snapshot.tokenTotal,
      model: snapshot.model,
      source: snapshot.source,
      r2Key,
    },
  })

  return {
    rollbackSnapshotId: newSnapshot.id,
    sourceSnapshotId: params.snapshotId,
    label: newSnapshot.label,
    capturedAt: newBundle.capturedAt,
    tokenTotal: newSnapshot.tokenTotal,
    bundle: newBundle,
  }
}

export async function enrichSnapshot(params: {
  snapshotId: string;
  enrichment: {
    files?: ContextFile[];
    toolCalls?: ToolCall[];
    logEvents?: LogEvent[];
    reasoning?: string;
  };
  userId: string;
}): Promise<void> {
  const snapshot = await db.snapshot.findUnique({
    where: { id: params.snapshotId },
    include: { task: { include: { session: true } } },
  });
  if (!snapshot || snapshot.task.session.userId !== params.userId) {
    throw new Error("NOT_FOUND: Snapshot not found");
  }

  const windowMs = Number(config.ENRICH_WINDOW_SECONDS) * 1000;
  const age = Date.now() - snapshot.createdAt.getTime();
  if (age > windowMs) {
    throw new Error("ENRICH_WINDOW_EXPIRED: Enrichment window has closed");
  }

  await mergeBundle(snapshot.r2Key, params.enrichment);
  await db.snapshot.update({
    where: { id: params.snapshotId },
    data: { enriched: true, enrichedAt: new Date() },
  });
}

import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "../r2";
import {
  ContextBundle,
  ContextFile,
  ToolCall,
  LogEvent,
} from "../types/bundle";

export async function writeBundle(
  snapshotId: string,
  bundle: ContextBundle
): Promise<string> {
  const key = `bundles/${snapshotId}.json`;
  const body = JSON.stringify(bundle);
  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: "application/json",
      })
    );
    return key;
  } catch (err) {
    throw new Error(`R2_WRITE_FAILED: ${(err as Error).message}`);
  }
}

export async function readBundle(r2Key: string): Promise<ContextBundle> {
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key })
    );
    const body = await res.Body?.transformToString();
    if (!body) throw new Error("Empty body from R2");
    return JSON.parse(body) as ContextBundle;
  } catch (err) {
    throw new Error(`R2_READ_FAILED: ${(err as Error).message}`);
  }
}

export async function mergeBundle(
  r2Key: string,
  enrichment: {
    files?: ContextFile[];
    toolCalls?: ToolCall[];
    logEvents?: LogEvent[];
    reasoning?: string;
  }
): Promise<void> {
  const existing = await readBundle(r2Key);
  const merged: ContextBundle = {
    ...existing,
    enriched: true,
    files: enrichment.files ?? existing.files,
    toolCalls: enrichment.toolCalls ?? existing.toolCalls,
    logEvents: [...existing.logEvents, ...(enrichment.logEvents ?? [])],
    reasoning: enrichment.reasoning ?? existing.reasoning,
  };
  await writeBundle(existing.snapshotId, merged);
}

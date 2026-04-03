import { nanoid }          from "nanoid"
import { db }              from "../db"
import { redis }           from "../redis"
import { writeBundle }     from "../services/bundle.service"
import { mapSpan, buildLabel } from "./span.mapper"
import type { FlatSpan }   from "../types/otel"
import type { ContextBundle } from "../types/bundle"

export async function processSpan(otelSpanId: string): Promise<void> {
  const raw = await db.otelSpan.findUnique({ where: { id: otelSpanId } })
  if (!raw || raw.status !== "PENDING") return

  try {
    const span: FlatSpan = {
      traceId:       raw.traceId,
      spanId:        raw.spanId,
      parentSpanId:  raw.parentSpanId ?? undefined,
      operationName: raw.operationName,
      serviceName:   raw.serviceName,
      spanKind:      raw.spanKind,
      startTime:     raw.startTime,
      endTime:       raw.endTime,
      durationMs:    raw.durationMs,
      attributes:    raw.attributes as Record<string, string | number | boolean>,
    }

    const mapped = mapSpan(span)

    // Non-LLM spans: mark processed but do not create a Snapshot.
    if (!mapped.isLlmCall) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      return
    }

    // Find the Kontex session linked to this traceId.
    const session = await db.session.findFirst({ where: { externalTraceId: raw.traceId } })

    if (!session) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      console.warn(
        `[span-processor] No session linked for traceId ${raw.traceId}. ` +
        `Pass X-Kontex-Session-Id on the /ingest request, or call POST /v1/sessions/:id/link-trace.`
      )
      return
    }

    // Find or create the auto-task for this session.
    let task = await db.task.findFirst({
      where: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
    })
    if (!task) {
      task = await db.task.create({
        data: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
      })
    }

    const snapshotId = nanoid(21)
    const label      = buildLabel(span, mapped)

    const bundle: ContextBundle = {
      snapshotId,
      taskId:     task.id,
      sessionId:  session.id,
      capturedAt: raw.startTime.toISOString(),
      model:      mapped.model,
      tokenTotal: mapped.tokenTotal,
      source:     "openllmetry",
      enriched:   true,   // OpenLLMetry spans are self-contained — no enrichment window
      files:      [],
      toolCalls:  mapped.toolCalls,
      messages:   mapped.messages,
      reasoning:  undefined,
      logEvents: [{
        type:      "openllmetry_span",
        timestamp: raw.startTime.toISOString(),
        data: {
          traceId:       raw.traceId,
          spanId:        raw.spanId,
          spanKind:      mapped.spanKind,
          operationName: raw.operationName,
          durationMs:    raw.durationMs,
          workflowName:  mapped.workflowName,
          agentName:     mapped.agentName,
          taskName:      mapped.taskName,
        },
      }],
    }

    const r2Key    = await writeBundle(snapshotId, bundle)
    const snapshot = await db.snapshot.create({
      data: {
        id:         snapshotId,
        taskId:     task.id,
        label,
        tokenTotal: mapped.tokenTotal,
        model:      mapped.model,
        source:     "openllmetry",
        r2Key,
        enriched:   true,
        enrichedAt: new Date(),
      },
    })

    await db.otelSpan.update({
      where: { id: otelSpanId },
      data:  { status: "PROCESSED", snapshotId: snapshot.id },
    })

    // Queue for Qdrant embedding (same queue as proxy snapshots)
    redis.rpush("kontex:embed_jobs", JSON.stringify({ snapshotId: snapshot.id }))
      .catch(err => console.error("[span-processor] Failed to queue embed job:", err))

  } catch (err) {
    await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "FAILED" } })
    console.error(`[span-processor] Failed to process span ${otelSpanId}:`, err)
  }
}

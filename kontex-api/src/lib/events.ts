import { redis } from "../redis"

export type KontexEvent =
  | {
      type: "snapshot.created"
      sessionId: string
      data: { snapshotId: string; label: string; tokenTotal: number; source: string; taskId: string }
    }
  | {
      type: "session.updated"
      sessionId: string
      data: { status: string }
    }
  | {
      type: "span.received"
      sessionId: string
      data: { spanId: string; spanKind: string; operationName: string }
    }

export function publishEvent(event: KontexEvent): void {
  const channel = `session:${event.sessionId}:events`
  redis.publish(channel, JSON.stringify(event))
    .catch(err => console.error("[events] Failed to publish:", err))
}

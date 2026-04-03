import { redis } from "../redis"
import { processSpan } from "../receivers/span.processor"

async function run(): Promise<void> {
  console.log("[span-worker] Started — waiting for OpenLLMetry spans")
  while (true) {
    const result = await redis.blpop("kontex:span_jobs", 0)
    if (!result) continue
    const [, raw] = result
    try {
      const { otelSpanId } = JSON.parse(raw)
      processSpan(otelSpanId).catch(err =>
        console.error("[span-worker] Error processing span:", otelSpanId, err)
      )
    } catch (err) {
      console.error("[span-worker] Malformed job payload:", raw, err)
    }
  }
}

run()

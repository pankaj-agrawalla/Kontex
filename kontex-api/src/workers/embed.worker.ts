import Redis from "ioredis"
import { config } from "../config"
import { embedSnapshot } from "../services/embed.service"

// Separate Redis instance for blocking operations (blpop)
const redis = new Redis(config.REDIS_URL)

const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function processJob(raw: string, attempt = 1): Promise<void> {
  const { snapshotId } = JSON.parse(raw) as { snapshotId: string }
  try {
    await embedSnapshot(snapshotId)
    console.log(`[embed-worker] Embedded ${snapshotId}`)
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000
      await sleep(delay)
      await processJob(raw, attempt + 1)
    } else {
      console.error(`[embed-worker] Failed after ${MAX_RETRIES} attempts:`, snapshotId, err)
    }
  }
}

async function run(): Promise<void> {
  console.log("[embed-worker] Started")
  while (true) {
    const result = await redis.blpop("kontex:embed_jobs", 0)
    if (result) {
      const [, raw] = result
      processJob(raw).catch(console.error)
    }
  }
}

run()

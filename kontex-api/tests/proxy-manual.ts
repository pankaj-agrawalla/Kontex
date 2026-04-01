/**
 * Manual proxy verification script.
 * Run: tsx tests/proxy-manual.ts
 *
 * Prerequisites:
 *   - Server running: npm run dev
 *   - ANTHROPIC_API_KEY set in environment or .env
 *   - test_key_dev seeded in DB
 */

const BASE = "http://localhost:3000"
const KONTEX_KEY = "test_key_dev"
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

if (!ANTHROPIC_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not set")
  process.exit(1)
}

async function main(): Promise<void> {
  // 1. Create a session
  console.log("Creating session...")
  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KONTEX_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "proxy-manual-test" }),
  })
  if (!sessRes.ok) {
    console.error("Failed to create session:", await sessRes.text())
    process.exit(1)
  }
  const session = await sessRes.json() as { id: string; name: string }
  console.log(`Session created: ${session.id} (${session.name})`)

  // 2. Send 3 messages through the proxy
  //    Each turn adds to the conversation history
  const conversationMessages: Array<{ role: string; content: string }> = []

  const prompts = ["Hello! What is 2 + 2?", "Now multiply that by 3.", "What is the final result?"]

  for (let i = 0; i < prompts.length; i++) {
    conversationMessages.push({ role: "user", content: prompts[i] })

    console.log(`\nTurn ${i + 1}: "${prompts[i]}"`)
    const start = Date.now()

    const res = await fetch(`${BASE}/proxy/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANTHROPIC_KEY}`,
        "X-Kontex-Api-Key": KONTEX_KEY,
        "X-Kontex-Session-Id": session.id,
        "X-Kontex-Snapshot-Trigger": "every_n_turns",
        "X-Kontex-Snapshot-N": "2",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        messages: conversationMessages,
      }),
    })

    const elapsed = Date.now() - start
    const body = await res.json() as {
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
    }

    if (!res.ok) {
      console.error("Anthropic error:", JSON.stringify(body, null, 2))
      process.exit(1)
    }

    const assistantText = body.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")

    console.log(`Response (${elapsed}ms): ${assistantText}`)
    console.log(`Tokens: ${body.usage.input_tokens} in / ${body.usage.output_tokens} out`)

    // Add assistant reply to history
    conversationMessages.push({ role: "assistant", content: assistantText })
  }

  // 3. Wait for async snapshots then print them
  console.log("\nWaiting for snapshots...")
  await new Promise((r) => setTimeout(r, 800))

  const snapshotsRes = await fetch(`${BASE}/v1/sessions/${session.id}/snapshots`, {
    headers: { Authorization: `Bearer ${KONTEX_KEY}` },
  })
  const snapshotsBody = await snapshotsRes.json() as {
    data: Array<{ id: string; label: string; source: string; tokenTotal: number; createdAt: string }>
  }

  console.log(`\nSnapshots created: ${snapshotsBody.data.length}`)
  for (const snap of snapshotsBody.data) {
    console.log(`  [${snap.createdAt}] ${snap.id}`)
    console.log(`    label: ${snap.label}`)
    console.log(`    source: ${snap.source}  tokens: ${snap.tokenTotal}`)
  }

  if (snapshotsBody.data.length === 0) {
    console.log("  (no snapshots yet — trigger may not have fired for this turn count)")
  }
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err)
  process.exit(1)
})

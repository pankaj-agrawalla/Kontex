# Kontex + OpenLLMetry Quickstart

## What you get

Every LLM call your agent makes — regardless of provider or framework — captured as an
immutable Kontex snapshot. Anthropic, OpenAI, Gemini, Bedrock, LangChain, LlamaIndex,
CrewAI, and 15+ others. Two lines of setup. Zero changes to agent logic.

## Supported providers and frameworks

LLM providers: Anthropic · OpenAI · Azure OpenAI · Amazon Bedrock · Google Gemini ·
Google VertexAI · Cohere · Mistral AI · Groq · Ollama · HuggingFace · IBM watsonx ·
Replicate · together.ai

Frameworks: LangChain (Python + JS) · LlamaIndex (Python + JS) · CrewAI ·
Haystack · Agno · Burr · LiteLLM · OpenAI Agents SDK · AWS Strands

---

## Step 1: Create a session

```bash
curl -X POST https://api.usekontex.com/v1/sessions \
  -H "Authorization: Bearer {KONTEX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent-session"}'
```

Save the returned `id` as `KONTEX_SESSION_ID`.

---

## Step 2: Install OpenLLMetry

```bash
npm install @traceloop/node-server-sdk    # Node.js
pip install traceloop-sdk                 # Python
```

---

## Step 3: Initialize before any LLM import

### Node.js

```typescript
// MUST come before any import of Anthropic, OpenAI, LangChain, etc.
import * as traceloop from "@traceloop/node-server-sdk"

traceloop.initialize({
  baseUrl: "https://api.usekontex.com",
  headers: {
    "X-Kontex-Api-Key":    process.env.KONTEX_API_KEY!,
    "X-Kontex-Session-Id": process.env.KONTEX_SESSION_ID!,
  },
  disableBatch: process.env.NODE_ENV === "development",
})

// Now import LLM libraries — they are automatically instrumented
import Anthropic from "@anthropic-ai/sdk"
```

### Python

```python
# MUST come before any import of anthropic, openai, langchain, etc.
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-agent",
    base_url="https://api.usekontex.com",
    headers={
        "X-Kontex-Api-Key":    os.environ["KONTEX_API_KEY"],
        "X-Kontex-Session-Id": os.environ["KONTEX_SESSION_ID"],
    },
    disable_batch=os.environ.get("ENV") == "development",
)

# Now import LLM libraries — they are automatically instrumented
import anthropic
```

---

## Step 4: Run your agent unchanged

Your existing agent code runs as-is. Every LLM call is captured.

---

## Step 5: Verify

```bash
curl https://api.usekontex.com/v1/sessions/{KONTEX_SESSION_ID}/snapshots \
  -H "Authorization: Bearer {KONTEX_API_KEY}"
```

You should see snapshot records with `"source": "openllmetry"`.

---

## Framework examples

### LangChain (Python)

Call `Traceloop.init()` at the top of your file, then use LangChain agents and chains
normally. Every LLM call inside chains is auto-captured.

### LangChain.js

Call `traceloop.initialize()` before importing `langchain`. Normal chain code after.

### LlamaIndex (Python)

Call `Traceloop.init()`, then use `QueryEngine`, `AgentRunner`, etc. normally.

### CrewAI

Call `Traceloop.init()`, then define `Crew`, `Agent`, `Task` normally.
Each agent's LLM calls become separate snapshots.

### Raw OpenAI SDK (Python)

Call `Traceloop.init()`, then `openai.chat.completions.create()` is auto-captured.

---

## Adding workflow structure (optional)

Wrap your own code to add semantic labels in the Kontex dashboard.

### Node.js

```typescript
import { withWorkflow, withTask, withAgent, withTool } from "@traceloop/node-server-sdk"

const result = await withWorkflow({ name: "refactor-agent" }, async () => {
  const plan = await withTask({ name: "plan" }, () => generatePlan())
  const code = await withTask({ name: "execute" }, () => writeCode(plan))
  return code
})
```

### Python

```python
from traceloop.sdk.decorators import workflow, task, agent, tool

@workflow(name="refactor-agent")
def run_agent():
    plan = generate_plan()
    return write_code(plan)

@task(name="generate-plan")
def generate_plan(): ...
```

---

## Import order is critical

OpenLLMetry patches LLM libraries at import time. If you import Anthropic or OpenAI
before calling `initialize()` / `Traceloop.init()`, the instrumentation will not activate.

**Always initialize first.**

---

## Linking traces to sessions manually

If you need to link a trace ID to a session after the fact (e.g. you didn't pass
`X-Kontex-Session-Id` on the ingest request):

```bash
curl -X POST https://api.usekontex.com/v1/sessions/{SESSION_ID}/link-trace \
  -H "Authorization: Bearer {KONTEX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"traceId": "{OTEL_TRACE_ID}"}'
```

Each session can be linked to exactly one trace ID. Create a new session for a new trace.

---

## Using the HTTP proxy instead

If you cannot modify your agent code, see [docs/quickstart.md](./quickstart.md) for the
proxy fallback. The proxy works with Anthropic-compatible APIs only.

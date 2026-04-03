import { useState } from "react"
import { Key } from "lucide-react"

export default function ApiKeyGate({ children }) {
  const [key, setKey]         = useState(localStorage.getItem("kontex_api_key") ?? "")
  const [stored, setStored]   = useState(!!localStorage.getItem("kontex_api_key"))
  const [error, setError]     = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed.startsWith("kontex_")) {
      setError("Key must start with kontex_")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `${import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"}/health`
      )
      if (!res.ok) throw new Error()
      localStorage.setItem("kontex_api_key", trimmed)
      setStored(true)
      setError("")
    } catch {
      setError("Could not reach backend. Check VITE_KONTEX_API_URL and your key.")
    } finally {
      setLoading(false)
    }
  }

  if (stored) return children

  return (
    <div className="flex items-center justify-center h-screen bg-bg">
      <div className="w-full max-w-sm border border-border rounded-md bg-surface p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 bg-teal rounded flex items-center justify-center">
            <Key size={14} className="text-bg" />
          </div>
          <div>
            <p className="font-mono font-semibold text-text">kontex</p>
            <p className="font-sans text-xs text-subtle">Enter your API key to continue</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError("") }}
            placeholder="kontex_xxxxxxxxxxxx"
            className="font-mono text-sm bg-bg border border-border rounded px-3 py-2 text-text placeholder:text-muted focus:outline-none focus:border-teal transition-colors duration-150"
          />
          {error && <p className="font-sans text-xs text-red">{error}</p>}
          <button
            type="submit"
            disabled={!key.trim() || loading}
            className="py-2 bg-teal text-bg font-sans font-medium text-sm rounded disabled:opacity-30 hover:opacity-90 transition-opacity"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>
      </div>
    </div>
  )
}

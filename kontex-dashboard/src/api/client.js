const BASE = import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"

function getKey() {
  return localStorage.getItem("kontex_api_key") ?? ""
}

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message)
    this.status  = status
    this.code    = code
    this.details = details
  }
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getKey()}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 401) {
    localStorage.removeItem("kontex_api_key")
    window.location.reload()
    throw new ApiError(401, "unauthorized", "API key invalid or expired")
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? "Request failed", body.details)
  }

  if (res.status === 204) return null
  return res.json()
}

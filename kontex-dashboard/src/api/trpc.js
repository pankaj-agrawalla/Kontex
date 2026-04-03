import { createTRPCReact } from "@trpc/react-query"
import { httpBatchLink } from "@trpc/client"

// Create the tRPC React hooks object
// No TypeScript AppRouter import needed — we use untyped client in JS
export const trpc = createTRPCReact()

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"}/trpc`,
        headers() {
          const key = localStorage.getItem("kontex_api_key") ?? ""
          return { Authorization: `Bearer ${key}` }
        },
      }),
    ],
  })
}

// Client-side simulation hook — now just a no-op since simulation runs server-side
// SSE events are handled by the store's SSE listener
export function useSimulation(enabled = true) {
  // Server-side simulation pushes events via SSE
  // Store's useEffect with subscribeSSE handles all incoming events
  // Nothing to do here anymore
}

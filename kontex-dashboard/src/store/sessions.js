import { create } from "zustand";
import { mockSessionsResponse, mockTimeline } from "../data/mock";

export const useSessionsStore = create((set, get) => ({
  sessions:         mockSessionsResponse.data,
  activeSessionId:  "sess_01",
  activeSnapshotId: null,
  // Timeline snapshots keyed by sessionId
  timelineSnapshots: { sess_01: mockTimeline },

  setSessions:     (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveSnapshot: (id) => set({ activeSnapshotId: id }),

  // Append-only: rollback creates a new snapshot, never removes existing ones
  addSnapshot: (snapshot) => {
    const sessionId = get().activeSessionId ?? "sess_01";
    set((state) => ({
      timelineSnapshots: {
        ...state.timelineSnapshots,
        [sessionId]: [...(state.timelineSnapshots[sessionId] ?? []), snapshot],
      },
    }));
  },
}));

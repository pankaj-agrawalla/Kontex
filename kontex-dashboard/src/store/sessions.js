import { create } from "zustand";

export const useSessionsStore = create((set) => ({
  activeSessionId:  null,
  activeSnapshotId: null,

  setActiveSession:  (id) => set({ activeSessionId: id }),
  setActiveSnapshot: (id) => set({ activeSnapshotId: id }),
}));

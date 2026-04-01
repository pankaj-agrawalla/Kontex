import { create } from "zustand";

export const useUiStore = create((set) => ({
  rollbackDrawerOpen: false,
  sidebarExpanded:    false,
  searchQuery:        "",

  openRollback:   () => set({ rollbackDrawerOpen: true }),
  closeRollback:  () => set({ rollbackDrawerOpen: false }),
  toggleSidebar:  () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));

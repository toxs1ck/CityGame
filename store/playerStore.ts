import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import type { Group, GroupAbility, AssignedTask, ActiveAbility, Profile } from "../types/game";

interface PlayerState {
  // Auth
  user: User | null;
  profile: Profile | null;
  authLoaded: boolean;
  // Device identity (used for guest / player flows)
  deviceId: string | null;
  // In-game player state
  myGroup: Group | null;
  myAbilities: GroupAbility[];
  myTasks: AssignedTask[];
  activeAbilities: ActiveAbility[];
  isOobPunished: boolean;
  isFrozen: boolean;
  isTrapped: boolean;

  setUser: (user: User | null) => void;
  setProfile: (profile: Profile | null) => void;
  setAuthLoaded: (val: boolean) => void;
  setDeviceId: (id: string) => void;
  setMyGroup: (group: Group | null) => void;
  setMyAbilities: (abilities: GroupAbility[]) => void;
  setMyTasks: (tasks: AssignedTask[]) => void;
  setActiveAbilities: (abilities: ActiveAbility[]) => void;
  setOobPunished: (val: boolean) => void;
  setFrozen: (val: boolean) => void;
  setTrapped: (val: boolean) => void;
  updateTaskStatus: (taskId: string, status: AssignedTask["status"]) => void;
  updateAbilityLastUsed: (abilityId: string) => void;
  reset: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  user: null,
  profile: null,
  authLoaded: false,
  deviceId: null,
  myGroup: null,
  myAbilities: [],
  myTasks: [],
  activeAbilities: [],
  isOobPunished: false,
  isFrozen: false,
  isTrapped: false,

  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setAuthLoaded: (val) => set({ authLoaded: val }),
  setDeviceId: (id) => set({ deviceId: id }),
  setMyGroup: (group) => set({ myGroup: group }),
  setMyAbilities: (abilities) => set({ myAbilities: abilities }),
  setMyTasks: (tasks) => set({ myTasks: tasks }),
  setActiveAbilities: (abilities) => set({ activeAbilities: abilities }),
  setOobPunished: (val) => set({ isOobPunished: val }),
  setFrozen: (val) => set({ isFrozen: val }),
  setTrapped: (val) => set({ isTrapped: val }),

  updateTaskStatus: (assignedTaskId, status) =>
    set((s) => ({
      myTasks: s.myTasks.map((t) =>
        t.id === assignedTaskId
          ? { ...t, status, completed_at: status === "completed" ? new Date().toISOString() : t.completed_at }
          : t
      ),
    })),

  updateAbilityLastUsed: (abilityId) =>
    set((s) => ({
      myAbilities: s.myAbilities.map((a) =>
        a.ability_id === abilityId
          ? { ...a, last_used_at: new Date().toISOString() }
          : a
      ),
    })),

  // reset clears in-game state but keeps auth and device identity
  reset: () =>
    set({
      myGroup: null,
      myAbilities: [],
      myTasks: [],
      activeAbilities: [],
      isOobPunished: false,
      isFrozen: false,
      isTrapped: false,
    }),
}));

import { create } from "zustand";
import type { GameSession, Group, GroupLocation, POI, AbilityObject, ActiveAbility } from "../types/game";

interface GameState {
  session: GameSession | null;
  groups: Group[];
  latestLocations: Map<string, GroupLocation>;
  lastFugitiveReveal: GroupLocation | null;
  pois: POI[];
  abilityObjects: AbilityObject[];
  allActiveAbilities: ActiveAbility[];

  setSession: (session: GameSession | null) => void;
  setGroups: (groups: Group[]) => void;
  updateLocation: (loc: GroupLocation) => void;
  setLastFugitiveReveal: (loc: GroupLocation | null) => void;
  setPois: (pois: POI[]) => void;
  setAbilityObjects: (objects: AbilityObject[]) => void;
  addAbilityObject: (obj: AbilityObject) => void;
  removeAbilityObject: (id: string) => void;
  setAllActiveAbilities: (abilities: ActiveAbility[]) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  session: null,
  groups: [],
  latestLocations: new Map(),
  lastFugitiveReveal: null,
  pois: [],
  abilityObjects: [],
  allActiveAbilities: [],

  setSession: (session) => set({ session }),
  setGroups: (groups) => set({ groups }),

  updateLocation: (loc) =>
    set((s) => {
      const next = new Map(s.latestLocations);
      const existing = next.get(loc.group_id);
      if (!existing || new Date(loc.recorded_at) > new Date(existing.recorded_at)) {
        next.set(loc.group_id, loc);
      }
      return { latestLocations: next };
    }),

  setLastFugitiveReveal: (loc) => set({ lastFugitiveReveal: loc }),
  setPois: (pois) => set({ pois }),
  setAbilityObjects: (objects) => set({ abilityObjects: objects }),

  addAbilityObject: (obj) =>
    set((s) => ({ abilityObjects: [...s.abilityObjects, obj] })),

  removeAbilityObject: (id) =>
    set((s) => ({ abilityObjects: s.abilityObjects.filter((o) => o.id !== id) })),

  setAllActiveAbilities: (abilities) => set({ allActiveAbilities: abilities }),

  reset: () =>
    set({
      session: null,
      groups: [],
      latestLocations: new Map(),
      lastFugitiveReveal: null,
      pois: [],
      abilityObjects: [],
      allActiveAbilities: [],
    }),
}));

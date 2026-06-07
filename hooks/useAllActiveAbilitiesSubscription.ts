import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import type { ActiveAbility } from "../types/game";

/** Subscribes to all active_abilities for the session (all groups). */
export function useAllActiveAbilitiesSubscription() {
  const { session } = useGameStore();

  useEffect(() => {
    if (!session) return;

    async function load() {
      const { data } = await supabase
        .from("active_abilities")
        .select("*, ability:ability_definitions(*)")
        .eq("session_id", session!.id);

      if (data) {
        const now = new Date();
        useGameStore.getState().setAllActiveAbilities(
          data.filter(
            (a) => !a.expires_at || new Date(a.expires_at) > now
          ) as ActiveAbility[]
        );
      }
    }

    load();

    const channel = supabase
      .channel(`all_active_abilities:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "active_abilities",
          filter: `session_id=eq.${session.id}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);
}

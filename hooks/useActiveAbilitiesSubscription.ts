import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import type { ActiveAbility } from "../types/game";

export function useActiveAbilitiesSubscription() {
  const { myGroup, setActiveAbilities } = usePlayerStore();
  const { session } = useGameStore();

  useEffect(() => {
    if (!myGroup || !session) return;

    async function load() {
      const { data } = await supabase
        .from("active_abilities")
        .select("*, ability:ability_definitions(*)")
        .eq("group_id", myGroup!.id)
        .eq("session_id", session!.id);

      if (data) {
        const now = new Date();
        const active = data.filter(
          (a) => !a.expires_at || new Date(a.expires_at) > now
        );
        setActiveAbilities(active as ActiveAbility[]);
      }
    }

    load();

    const channel = supabase
      .channel(`active_abilities:${myGroup.id}:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "active_abilities",
          filter: `group_id=eq.${myGroup.id}`,
        },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [myGroup?.id, session?.id]);
}

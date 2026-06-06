import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import type { AbilityObject } from "../types/game";

export function useAbilityObjectsSubscription() {
  const { session, setAbilityObjects, addAbilityObject, removeAbilityObject } = useGameStore();

  useEffect(() => {
    if (!session) return;

    supabase
      .from("ability_objects")
      .select("*")
      .eq("session_id", session.id)
      .then(({ data }) => {
        if (data) {
          const now = new Date();
          setAbilityObjects(
            (data as AbilityObject[]).filter(
              (o) => !o.expires_at || new Date(o.expires_at) > now
            )
          );
        }
      });

    const channel = supabase
      .channel(`ability_objects:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ability_objects",
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => addAbilityObject(payload.new as AbilityObject)
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "ability_objects",
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => removeAbilityObject((payload.old as AbilityObject).id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);
}

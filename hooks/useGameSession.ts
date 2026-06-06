import { useEffect } from "react";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import type { GameSession } from "../types/game";

export function useGameSessionSubscription(sessionId: string | null) {
  const { setSession } = useGameStore();

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`session:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const s = payload.new as GameSession;
          setSession(s);
          if (s.status === "finished") {
            router.replace("/(game)/game-over");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);
}

import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import type { GameSession } from "../types/game";

/** Subscribes to session status changes in real-time. */
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
          setSession(payload.new as GameSession);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);
}

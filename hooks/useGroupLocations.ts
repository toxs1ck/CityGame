import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { usePlayerStore } from "../store/playerStore";
import type { GroupLocation } from "../types/game";

/**
 * Subscribes to real-time group location updates for the session.
 *
 * Fugitives see seeker locations in real-time.
 * Seekers only update their map when a fugitive reveal is broadcast.
 */
export function useGroupLocations(sessionId: string | null) {
  const { updateLocation } = useGameStore();
  const { myGroup } = usePlayerStore();

  useEffect(() => {
    if (!sessionId || !myGroup) return;

    const isFugitive = myGroup.role === "fugitive";

    // Fugitives subscribe to seeker location changes in real-time
    if (isFugitive) {
      const channel = supabase
        .channel(`locations:${sessionId}:seekers`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "group_locations",
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const loc = payload.new as GroupLocation;
            // Will be filtered against known seeker groups in the store
            updateLocation(loc);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    // Seekers listen for fugitive reveal broadcasts
    const channel = supabase
      .channel(`game:${sessionId}:reveal`)
      .on("broadcast", { event: "fugitive_reveal" }, (payload) => {
        const loc = payload.payload as GroupLocation;
        useGameStore.getState().setLastFugitiveReveal(loc);
        updateLocation(loc);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, myGroup?.id, myGroup?.role]);
}

/** For GM/host: subscribe to ALL group locations in real-time. */
export function useAllGroupLocations(sessionId: string | null) {
  const { updateLocation } = useGameStore();

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`locations:${sessionId}:all`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "group_locations",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          updateLocation(payload.new as GroupLocation);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);
}

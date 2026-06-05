import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { usePlayerStore } from "../store/playerStore";
import { DEFAULT_REVEAL_INTERVAL_S } from "../constants/game";

/**
 * For the GM/host device only: broadcasts the fugitive's current location
 * to all seeker devices at the configured interval.
 */
export function useFugitiveRevealBroadcast(active: boolean) {
  const { session, groups, latestLocations } = useGameStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !session) return;

    const intervalMs =
      (session.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S) * 1000;

    const broadcast = async () => {
      const fugitiveGroup = groups.find((g) => g.role === "fugitive");
      if (!fugitiveGroup) return;

      const hasSkipPing = useGameStore
        .getState()
        .abilityObjects.some(
          (o) => o.type === "skip_ping" && o.placed_by_group_id === fugitiveGroup.id
        );
      if (hasSkipPing) return;

      const hasDarkMode = useGameStore
        .getState()
        .abilityObjects.some((o) => o.type === "dark_mode");
      if (hasDarkMode) return;

      const loc = latestLocations.get(fugitiveGroup.id);
      if (!loc) return;

      const channel = supabase.channel(`game:${session.id}:reveal`);
      await channel.send({
        type: "broadcast",
        event: "fugitive_reveal",
        payload: loc,
      });
    };

    broadcast(); // send immediately on start
    timerRef.current = setInterval(broadcast, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, session?.id, session?.settings.reveal_interval_s]);
}

/** Returns seconds until next fugitive reveal (for seeker HUD). */
export function useRevealCountdown(sessionId: string | null): number {
  const { session } = useGameStore();
  const intervalS = session?.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S;

  // This is managed purely client-side based on the last reveal timestamp.
  // Components can use the lastFugitiveReveal from the store to compute elapsed time.
  return intervalS;
}

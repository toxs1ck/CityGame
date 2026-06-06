import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { DEFAULT_REVEAL_INTERVAL_S, DEFAULT_HEADSTART_S } from "../constants/game";

/**
 * For the GM/host device only: broadcasts the fugitive's current location
 * to all seeker devices at the configured interval, after the headstart has elapsed.
 */
export function useFugitiveRevealBroadcast(active: boolean) {
  const { session, groups, latestLocations } = useGameStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !session) return;

    const intervalMs =
      (session.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S) * 1000;
    const headstartS = session.settings.headstart_s ?? DEFAULT_HEADSTART_S;
    const startedAt = session.started_at
      ? new Date(session.started_at).getTime()
      : Date.now();

    const broadcast = async () => {
      // Suppress reveals during fugitive head-start window
      const elapsedS = (Date.now() - startedAt) / 1000;
      if (elapsedS < headstartS) return;

      const fugitiveGroup = groups.find((g) => g.role === "fugitive");
      if (!fugitiveGroup) return;

      const hasSkipPing = useGameStore
        .getState()
        .abilityObjects.some(
          (o) =>
            o.type === "skip_ping" &&
            o.placed_by_group_id === fugitiveGroup.id
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

    broadcast();
    timerRef.current = setInterval(broadcast, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, session?.id, session?.settings.reveal_interval_s, session?.settings.headstart_s]);
}

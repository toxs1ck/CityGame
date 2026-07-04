import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { DEFAULT_REVEAL_INTERVAL_S, DEFAULT_HEADSTART_S } from "../constants/game";

/**
 * For the GM/host device only: broadcasts the fugitive's current location
 * to all seeker devices at the configured interval, aligned to session.started_at
 * so every restart fires at the same wall-clock moments.
 */
export function useFugitiveRevealBroadcast(active: boolean) {
  const { session } = useGameStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || !session) return;

    const intervalS = session.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S;
    const intervalMs = intervalS * 1000;
    const headstartS = session.settings.headstart_s ?? DEFAULT_HEADSTART_S;
    const startedAt = session.started_at
      ? new Date(session.started_at).getTime()
      : Date.now();

    const broadcast = async () => {
      // Always read fresh state so stale closure values don't cause missed/wrong reveals
      const { groups, latestLocations, abilityObjects } = useGameStore.getState();

      const elapsedS = (Date.now() - startedAt) / 1000;
      if (elapsedS < headstartS) return;

      const fugitiveGroup = groups.find((g) => g.role === "fugitive");
      if (!fugitiveGroup) return;

      const hasSkipPing = abilityObjects.some(
        (o) => o.type === "skip_ping" && o.placed_by_group_id === fugitiveGroup.id
      );
      if (hasSkipPing) return;

      const hasDarkMode = abilityObjects.some((o) => o.type === "dark_mode");
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

    // Align first broadcast to the next interval boundary relative to session start
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const headstartMs = headstartS * 1000;

    let msUntilFirst: number;
    if (elapsedMs < headstartMs) {
      // Still in headstart — wait for headstart to end, then fire at first interval
      msUntilFirst = headstartMs - elapsedMs + intervalMs;
    } else {
      // Past headstart — snap to next interval boundary
      const activeElapsedMs = elapsedMs - headstartMs;
      const timeInIntervalMs = activeElapsedMs % intervalMs;
      msUntilFirst = intervalMs - timeInIntervalMs;
      // If we're within 1 s of a boundary, skip ahead to avoid a near-instant fire
      if (msUntilFirst < 1000) msUntilFirst += intervalMs;
    }

    timeoutRef.current = setTimeout(() => {
      broadcast();
      timerRef.current = setInterval(broadcast, intervalMs);
    }, msUntilFirst);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active, session?.id, session?.settings.reveal_interval_s, session?.settings.headstart_s]);
}

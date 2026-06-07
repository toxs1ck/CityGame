import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { haversineDistance } from "../lib/geo";
import { CATCH_RADIUS_M, DEFAULT_CATCH_WINDOW_S } from "../constants/game";

/**
 * Runs on the GM / host device only.
 * Polls every 5 s for a seeker within CATCH_RADIUS_M of the fugitive.
 * When found, opens a 10-second catch window broadcast to the seeker's device.
 * If the seeker stays in range for the full window, the game ends automatically.
 */
export function useCatchDetection(active: boolean) {
  const { session, groups, latestLocations } = useGameStore();
  const catchStartRef = useRef<number | null>(null);
  const catchSeekerRef = useRef<string | null>(null);
  const [catchInProgress, setCatchInProgress] = useState(false);
  const [catchSeekerName, setCatchSeekerName] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !session) return;

    const channelName = `game:${session.id}:catch`;

    const check = async () => {
      const fugitive = groups.find((g) => g.role === "fugitive");
      const seekers = groups.filter((g) => g.role === "seeker");
      if (!fugitive) return;

      const fugitiveLoc = latestLocations.get(fugitive.id);
      if (!fugitiveLoc) return;

      const fugPos = { lat: fugitiveLoc.lat, lng: fugitiveLoc.lng };

      // Handle ongoing catch window
      if (catchSeekerRef.current) {
        const trackedSeeker = seekers.find((s) => s.id === catchSeekerRef.current);
        const trackedLoc = trackedSeeker
          ? latestLocations.get(trackedSeeker.id)
          : null;

        if (
          trackedLoc &&
          haversineDistance(fugPos, { lat: trackedLoc.lat, lng: trackedLoc.lng }) <=
            CATCH_RADIUS_M
        ) {
          // Still in range — confirm if window elapsed
          const catchWindowMs =
            (session.settings.catch_window_s ?? DEFAULT_CATCH_WINDOW_S) * 1000;
          if (
            catchStartRef.current !== null &&
            Date.now() - catchStartRef.current >= catchWindowMs
          ) {
            await supabase
              .from("game_sessions")
              .update({
                status: "finished",
                finished_at: new Date().toISOString(),
                settings: {
                  ...useGameStore.getState().session?.settings,
                  catch_info: {
                    caught_by_group_id: trackedSeeker!.id,
                    caught_by_name: trackedSeeker!.name,
                    fugitive_name: fugitive.name,
                    distance_m: Math.round(
                      haversineDistance(fugPos, { lat: trackedLoc.lat, lng: trackedLoc.lng })
                    ),
                  },
                },
              })
              .eq("id", session.id);
            catchStartRef.current = null;
            catchSeekerRef.current = null;
            setCatchInProgress(false);
            setCatchSeekerName(null);
          }
          return;
        }

        // Seeker left range — cancel the window
        supabase.channel(channelName).send({
          type: "broadcast",
          event: "catch_window_cancelled",
          payload: { seeker_group_id: catchSeekerRef.current },
        });
        catchStartRef.current = null;
        catchSeekerRef.current = null;
        setCatchInProgress(false);
        setCatchSeekerName(null);
      }

      // No active window — find first seeker in range
      for (const seeker of seekers) {
        const loc = latestLocations.get(seeker.id);
        if (!loc) continue;
        if (
          haversineDistance(fugPos, { lat: loc.lat, lng: loc.lng }) <= CATCH_RADIUS_M
        ) {
          catchStartRef.current = Date.now();
          catchSeekerRef.current = seeker.id;
          setCatchInProgress(true);
          setCatchSeekerName(seeker.name);
          supabase.channel(channelName).send({
            type: "broadcast",
            event: "catch_window_open",
            payload: {
              seeker_group_id: seeker.id,
              seeker_name: seeker.name,
              started_at: new Date().toISOString(),
            },
          });
          break;
        }
      }
    };

    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [active, session?.id, groups, latestLocations]);

  return { catchInProgress, catchSeekerName };
}

import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { haversineDistance } from "../lib/geo";
import { CATCH_RADIUS_M } from "../constants/game";

/**
 * Runs on the GM / host device only.
 * Checks every 5 s whether any seeker is within CATCH_RADIUS_M of the
 * fugitive. When triggered it asks for confirmation before ending the game.
 */
export function useCatchDetection(active: boolean) {
  const { session, groups, latestLocations } = useGameStore();
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!active || !session) return;

    const check = () => {
      if (pendingRef.current) return;

      const fugitive = groups.find((g) => g.role === "fugitive");
      const seekers = groups.filter((g) => g.role === "seeker");
      if (!fugitive) return;

      const fugitiveLoc = latestLocations.get(fugitive.id);
      if (!fugitiveLoc) return;

      for (const seeker of seekers) {
        const seekerLoc = latestLocations.get(seeker.id);
        if (!seekerLoc) continue;

        const dist = haversineDistance(
          { lat: fugitiveLoc.lat, lng: fugitiveLoc.lng },
          { lat: seekerLoc.lat, lng: seekerLoc.lng }
        );

        if (dist <= CATCH_RADIUS_M) {
          pendingRef.current = true;
          Alert.alert(
            "🎯 Flüchtig gefangen!",
            `${seeker.name} ist nur ${Math.round(dist)} m vom Flüchtigen entfernt.\nSpiel beenden?`,
            [
              {
                text: "Abbrechen",
                style: "cancel",
                onPress: () => {
                  pendingRef.current = false;
                },
              },
              {
                text: "Bestätigen & Beenden",
                onPress: async () => {
                  await supabase
                    .from("game_sessions")
                    .update({
                      status: "finished",
                      finished_at: new Date().toISOString(),
                      settings: {
                        ...useGameStore.getState().session?.settings,
                        catch_info: {
                          caught_by_group_id: seeker.id,
                          caught_by_name: seeker.name,
                          fugitive_name: fugitive.name,
                          distance_m: Math.round(dist),
                        },
                      },
                    })
                    .eq("id", session.id);
                },
              },
            ]
          );
          break;
        }
      }
    };

    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [active, session?.id, groups, latestLocations]);
}

import { useEffect, useRef, useCallback } from "react";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import { randomOffset, computeGameAreaScale } from "../lib/geo";
import type { GeoPolygon } from "../types/game";
import { DEFAULT_LOCATION_UPDATE_INTERVAL_S } from "../constants/game";

export function useLocationTracking(active: boolean) {
  const { myGroup, activeAbilities } = usePlayerStore();
  const { session } = useGameStore();
  const subRef = useRef<Location.LocationSubscription | null>(null);

  const submitLocation = useCallback(
    async (lat: number, lng: number) => {
      if (!myGroup || !session) return;

      let finalLat = lat;
      let finalLng = lng;

      const hasRadarJam = activeAbilities.some(
        (a) =>
          a.ability?.type === "radar_jam" &&
          (!a.expires_at || new Date(a.expires_at) > new Date())
      );

      if (hasRadarJam) {
        const radarJamAbility = activeAbilities.find(
          (a) => a.ability?.type === "radar_jam" && (!a.expires_at || new Date(a.expires_at) > new Date())
        );
        const baseOffset = (radarJamAbility?.ability?.effect_config?.offset_m as number | undefined) ?? 50;
        const gameArea = session ? ((session as any).scenario?.game_area as GeoPolygon | null) : null;
        const areaScale = gameArea ? computeGameAreaScale(gameArea) : 1.0;
        const jammed = randomOffset({ lat, lng }, baseOffset * areaScale);
        finalLat = jammed.lat;
        finalLng = jammed.lng;
      }

      await supabase.from("group_locations").insert({
        group_id: myGroup.id,
        session_id: session.id,
        lat: finalLat,
        lng: finalLng,
        recorded_at: new Date().toISOString(),
      });
    },
    [myGroup, session, activeAbilities]
  );

  useEffect(() => {
    if (!active || !myGroup || !session) return;

    let mounted = true;
    const interval =
      (session.settings.location_update_interval_s ??
        DEFAULT_LOCATION_UPDATE_INTERVAL_S) * 1000;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || !mounted) return;

      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: interval,
          distanceInterval: 5,
        },
        (loc) => {
          submitLocation(loc.coords.latitude, loc.coords.longitude);
        }
      );
    })();

    return () => {
      mounted = false;
      subRef.current?.remove();
      subRef.current = null;
    };
  }, [active, myGroup?.id, session?.id]);
}

import { useMemo } from "react";
import { haversineDistance } from "../lib/geo";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import type { AssignedTask } from "../types/game";

export function useNearbyTasks(
  currentLat: number | null,
  currentLng: number | null
): AssignedTask[] {
  const { myTasks } = usePlayerStore();
  const { pois, session } = useGameStore();

  const radiusM = session?.settings.poi_radius_m ?? 50;

  return useMemo(() => {
    if (currentLat == null || currentLng == null) return [];

    const activeTasks = myTasks.filter((t) => t.status === "active");

    return activeTasks.filter((task) => {
      const poi = pois.find((p) => p.id === task.task?.poi_id);
      if (!poi) return false;
      const dist = haversineDistance(
        { lat: currentLat, lng: currentLng },
        { lat: poi.lat, lng: poi.lng }
      );
      return dist <= radiusM;
    });
  }, [currentLat, currentLng, myTasks, pois, radiusM]);
}

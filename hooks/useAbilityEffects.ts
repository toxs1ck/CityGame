import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { supabase } from "../lib/supabase";
import { useGameStore } from "../store/gameStore";
import { usePlayerStore } from "../store/playerStore";
import { haversineDistance } from "../lib/geo";
import type { GeoPoint } from "../types/game";

const MOTION_RETRIGGER_MS = 30_000;
const TRAP_TRIGGER_RADIUS_M = 10;

/**
 * Passive ability effects driven by position changes:
 *  - Fugitive: broadcasts to motion detectors within range
 *  - Seeker: subscribes to own motion detector alerts; detects trap proximity
 *
 * Exclusion zone detection is intentionally in map.tsx so it can drive React state.
 */
export function useAbilityEffects(myPos: GeoPoint | null) {
  const { session, abilityObjects } = useGameStore();
  const { myGroup, setTrapped } = usePlayerStore();
  const isFugitive = myGroup?.role === "fugitive";
  const isSeeker = myGroup?.role === "seeker";

  const triggeredMotionDetectors = useRef(new Set<string>());
  const triggeredTraps = useRef(new Set<string>());
  const trapEndRef = useRef<number | null>(null);
  const trapTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Seeker: subscribe to motion alerts for detectors placed by this group
  useEffect(() => {
    if (!session || !myGroup || !isSeeker) return;

    const channel = supabase
      .channel(`game:${session.id}:motion:${myGroup.id}`)
      .on("broadcast", { event: "motion_detected" }, ({ payload }) => {
        if (payload.placed_by_group_id === myGroup.id) {
          Alert.alert("⚠️ Bewegungsmelder", "Bewegung in deiner Überwachungszone erkannt!");
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id, myGroup?.id, isSeeker]);

  // Fugitive: if inside a drone_view circle, reveal position to placing seeker
  useEffect(() => {
    if (!myPos || !session || !myGroup || !isFugitive) return;

    const now = new Date();
    const activeDrones = abilityObjects.filter(
      (o) =>
        o.type === "drone_view" &&
        (!o.expires_at || new Date(o.expires_at) > now)
    );

    for (const drone of activeDrones) {
      const center = drone.geometry as GeoPoint;
      const radius = (drone.metadata?.radius_m as number) ?? 50;
      if (haversineDistance(myPos, center) <= radius) {
        supabase
          .channel(`game:${session.id}:drone:${drone.placed_by_group_id}`)
          .send({
            type: "broadcast",
            event: "drone_reveal",
            payload: {
              group_id: myGroup.id,
              session_id: session.id,
              lat: myPos.lat,
              lng: myPos.lng,
              recorded_at: new Date().toISOString(),
            },
          });
      }
    }
  }, [myPos, abilityObjects, session?.id, myGroup?.id, isFugitive]);

  // Fugitive: trigger nearby motion detectors
  useEffect(() => {
    if (!myPos || !session || !myGroup || !isFugitive) return;

    const now = new Date();
    const activeDetectors = abilityObjects.filter(
      (o) =>
        o.type === "motion_detector" &&
        (!o.expires_at || new Date(o.expires_at) > now)
    );

    for (const obj of activeDetectors) {
      if (triggeredMotionDetectors.current.has(obj.id)) continue;
      const center = obj.geometry as GeoPoint;
      const radius = (obj.metadata?.radius_m as number) ?? 50;
      if (haversineDistance(myPos, center) <= radius) {
        triggeredMotionDetectors.current.add(obj.id);
        setTimeout(
          () => triggeredMotionDetectors.current.delete(obj.id),
          MOTION_RETRIGGER_MS
        );
        supabase
          .channel(`game:${session.id}:motion:${obj.placed_by_group_id}`)
          .send({
            type: "broadcast",
            event: "motion_detected",
            payload: { placed_by_group_id: obj.placed_by_group_id },
          });
      }
    }
  }, [myPos, abilityObjects, session?.id, myGroup?.id, isFugitive]);

  // Seeker: trap proximity detection
  useEffect(() => {
    if (!myPos || !session || !myGroup || !isSeeker) return;

    const now = new Date();
    const activeTraps = abilityObjects.filter(
      (o) => o.type === "trap" && (!o.expires_at || new Date(o.expires_at) > now)
    );

    for (const obj of activeTraps) {
      if (triggeredTraps.current.has(obj.id)) continue;
      const center = obj.geometry as GeoPoint;
      if (haversineDistance(myPos, center) <= TRAP_TRIGGER_RADIUS_M) {
        triggeredTraps.current.add(obj.id);
        const durationS = (obj.metadata?.duration_s as number) ?? 300;
        trapEndRef.current = Date.now() + durationS * 1000;
        setTrapped(true);

        if (trapTimerRef.current) clearInterval(trapTimerRef.current);
        trapTimerRef.current = setInterval(() => {
          if ((trapEndRef.current ?? 0) - Date.now() <= 0) {
            setTrapped(false);
            if (trapTimerRef.current) {
              clearInterval(trapTimerRef.current);
              trapTimerRef.current = null;
            }
          }
        }, 1000);

        Alert.alert(
          "🪤 Falle!",
          `Du bist in eine Falle getappt! Gefangen für ${Math.round(durationS / 60)} Minuten.`
        );
        break;
      }
    }
  }, [myPos, abilityObjects, session?.id, myGroup?.id, isSeeker, setTrapped]);

  useEffect(() => {
    return () => {
      if (trapTimerRef.current) clearInterval(trapTimerRef.current);
    };
  }, []);
}

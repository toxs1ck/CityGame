import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Circle, Polygon, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { useLocationTracking } from "../../hooks/useLocation";
import { useGroupLocations } from "../../hooks/useGroupLocations";
import { useGameSessionSubscription } from "../../hooks/useGameSession";
import { useFugitiveRevealBroadcast } from "../../hooks/useRevealInterval";
import { useNearbyTasks } from "../../hooks/useNearbyTasks";
import { useTaskSubscription } from "../../hooks/useTaskSubscription";
import { useActiveAbilitiesSubscription } from "../../hooks/useActiveAbilitiesSubscription";
import { useAbilityObjectsSubscription } from "../../hooks/useAbilityObjectsSubscription";
import { useAllActiveAbilitiesSubscription } from "../../hooks/useAllActiveAbilitiesSubscription";
import { useAbilityEffects } from "../../hooks/useAbilityEffects";
import { supabase } from "../../lib/supabase";
import { canControl, formatDuration, isCooldownReady, cooldownRemainingSeconds } from "../../lib/gameLogic";
import { haversineDistance, isInsidePolygon, bearingDegrees, compassDirection, formatDistance, computeGameAreaScale } from "../../lib/geo";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_HEADSTART_S,
  CATCH_RADIUS_M,
  DEFAULT_CATCH_WINDOW_S,
} from "../../constants/game";
import type { AbilityObject, GeoPoint, GeoPolygon, GroupLocation, GroupAbility, AbilityDefinition } from "../../types/game";

const INSTANT_ABILITIES = new Set(["compass", "distance_reveal", "poi_proximity_reveal", "exact_location"]);
const PLACEMENT_ABILITIES = new Set(["exclusion_zone", "motion_detector", "trap", "roadblock"]);
const MAP_PLACEMENT_ABILITIES = new Set(["drone_view"]);

async function getCurrentPos(): Promise<{ lat: number; lng: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a8a9a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#12121e" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2a2a4a" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#c0c0d0" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c4c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1a3a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#7070a0" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373757" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c6c" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#505080" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a0a1a" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#2a2a4a" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#16162a" }] },
];

export default function GameMapScreen() {
  const {
    session,
    groups,
    latestLocations,
    lastFugitiveReveal,
    pois,
    abilityObjects,
    allActiveAbilities,
    reset: resetGame,
  } = useGameStore();
  const {
    myGroup,
    deviceId,
    myTasks,
    myAbilities,
    setOobPunished,
    isOobPunished,
    isFrozen,
    setFrozen,
    isTrapped,
    updateAbilityLastUsed,
    reset: resetPlayer,
  } = usePlayerStore();

  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [revealCountdown, setRevealCountdown] = useState(0);
  const [headstartLeft, setHeadstartLeft] = useState(0);
  const [isOutside, setIsOutside] = useState(false);
  const [isPunished, setIsPunished] = useState(false);
  const [isInExclusionZone, setIsInExclusionZone] = useState(false);
  const [isCatching, setIsCatching] = useState(false);
  const [catchWindowStart, setCatchWindowStart] = useState<number | null>(null);
  const [catchSecondsLeft, setCatchSecondsLeft] = useState(DEFAULT_CATCH_WINDOW_S);
  const [frozenSecondsLeft, setFrozenSecondsLeft] = useState(0);
  const [freezeLocation, setFreezeLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [fugitiveTrail, setFugitiveTrail] = useState<{ lat: number; lng: number }[]>([]);

  const oobStartTime = useRef<number | null>(null);
  const fugitiveBroadcastEnd = useRef<number | null>(null);
  const frozenEndRef = useRef<number | null>(null);
  const wasInFreezeZoneRef = useRef(true);
  const leftFreezeZoneAtRef = useRef<number | null>(null);
  const myPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<MapView>(null);

  const [activating, setActivating] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"abilities" | "tasks" | null>(null);
  const BAR_HEIGHT = 68;
  const DRAWER_HEIGHT = 100;
  const drawerAnim = useRef(new Animated.Value(DRAWER_HEIGHT)).current;

  const abilitiesOpen = drawerMode === "abilities";
  const tasksOpen = drawerMode === "tasks";

  const FREEZE_HOLD_RADIUS_M = 25;

  const insets = useSafeAreaInsets();
  const isFugitive = myGroup?.role === "fugitive";
  const isGMOrHost = session ? canControl(session, deviceId!, null) : false;
  const catchWindow = session?.settings.catch_window_s ?? DEFAULT_CATCH_WINDOW_S;

  // Derived ability flags (checked per render against live allActiveAbilities)
  const now = new Date();
  const myActivePowers = allActiveAbilities.filter(
    (a) =>
      a.group_id === myGroup?.id &&
      (!a.expires_at || new Date(a.expires_at) > now)
  );
  const hasRevealStatic = isFugitive && myActivePowers.some((a) => a.ability?.type === "reveal_static");
  const hasTrailReader = !isFugitive && myActivePowers.some((a) => a.ability?.type === "trail_reader");

  // Core subscriptions
  useLocationTracking(!!session && session.status === "active");
  useGroupLocations(session?.id ?? null);
  useGameSessionSubscription(session?.id ?? null);
  useFugitiveRevealBroadcast(isGMOrHost && session?.status === "active");

  // Phase 2 subscriptions
  useTaskSubscription();
  useActiveAbilitiesSubscription();
  useAbilityObjectsSubscription();
  useAllActiveAbilitiesSubscription();

  // Passive ability effects (motion detector, trap)
  useAbilityEffects(myPos);

  // Sync myPos to a ref so event-handler closures can read latest position
  useEffect(() => { myPosRef.current = myPos; }, [myPos]);

  // Watch own position for map centering and nearby tasks
  useEffect(() => {
    let sub: Location.LocationSubscription;
    Location.requestForegroundPermissionsAsync().then(async ({ status }) => {
      if (status !== "granted") return;
      // Get an immediate fix so initialRegion is populated on first render
      const quick = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMyPos({ lat: quick.coords.latitude, lng: quick.coords.longitude });
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000 },
        (loc) =>
          setMyPos({ lat: loc.coords.latitude, lng: loc.coords.longitude })
      ).then((s) => {
        sub = s;
      });
    });
    return () => {
      sub?.remove();
    };
  }, []);

  // Boundary enforcement + exclusion zone detection on every position update
  useEffect(() => {
    if (!myPos) return;

    // Game boundary
    if (gameArea) {
      const inside = isInsidePolygon(myPos, gameArea);
      if (inside) {
        if (isOutside && isFugitive) {
          fugitiveBroadcastEnd.current = Date.now() + 30_000;
        }
        oobStartTime.current = null;
        setIsOutside(false);
      } else {
        if (!isOutside) oobStartTime.current = Date.now();
        setIsOutside(true);
      }

      if (
        isFugitive &&
        myGroup &&
        session &&
        (!inside ||
          (fugitiveBroadcastEnd.current !== null &&
            Date.now() < fugitiveBroadcastEnd.current))
      ) {
        const ch = supabase.channel(`game:${session.id}:reveal`);
        ch.send({
          type: "broadcast",
          event: "fugitive_reveal",
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

    // Exclusion zone check (fugitive only, respects zone_pass)
    if (isFugitive) {
      const hasZonePass = allActiveAbilities.some(
        (a) =>
          a.group_id === myGroup?.id &&
          a.ability?.type === "zone_pass" &&
          (!a.expires_at || new Date(a.expires_at) > now)
      );
      const inZone =
        !hasZonePass &&
        abilityObjects.some((o) => {
          if (o.type !== "exclusion_zone") return false;
          if (o.expires_at && new Date(o.expires_at) <= now) return false;
          const center = o.geometry as GeoPoint;
          const radius = (o.metadata?.radius_m as number) ?? 100;
          return haversineDistance(myPos, center) <= radius;
        });
      setIsInExclusionZone(inZone);
    }
  }, [myPos, gameArea, isFugitive, isOutside, session, myGroup, allActiveAbilities, abilityObjects]);

  // Punishment: disable abilities + hide groups after 60 s OOB
  useEffect(() => {
    const t = setInterval(() => {
      const punished =
        isOutside &&
        oobStartTime.current !== null &&
        Date.now() - oobStartTime.current >= 60_000;
      setIsPunished(punished);
      setOobPunished(punished);
    }, 1000);
    return () => clearInterval(t);
  }, [isOutside, setOobPunished]);

  // Catch window: seekers subscribe to broadcast from GM/host device
  useEffect(() => {
    if (isFugitive || !session || !myGroup) return;

    const channel = supabase
      .channel(`game:${session.id}:catch`)
      .on("broadcast", { event: "catch_window_open" }, ({ payload }) => {
        if (payload.seeker_group_id === myGroup.id) {
          setCatchWindowStart(Date.now());
          setIsCatching(true);
          setCatchSecondsLeft(catchWindow);
        }
      })
      .on("broadcast", { event: "catch_window_cancelled" }, ({ payload }) => {
        if (payload.seeker_group_id === myGroup.id) {
          setIsCatching(false);
          setCatchWindowStart(null);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isFugitive, session?.id, myGroup?.id]);

  // Catch countdown: tick every 100 ms while catch window is open
  useEffect(() => {
    if (!isCatching || catchWindowStart === null) return;
    const t = setInterval(() => {
      const elapsed = (Date.now() - catchWindowStart) / 1000;
      setCatchSecondsLeft(Math.max(0, Math.ceil(catchWindow - elapsed)));
    }, 100);
    return () => clearInterval(t);
  }, [isCatching, catchWindowStart, catchWindow]);

  // Freeze: seekers subscribe to freeze broadcasts from fugitive
  useEffect(() => {
    if (isFugitive || !session || !myGroup) return;

    const channel = supabase
      .channel(`game:${session.id}:freeze`)
      .on("broadcast", { event: "freeze_applied" }, ({ payload }) => {
        if (payload.target_group_id === myGroup.id) {
          const durationS = payload.duration_s ?? 180;
          frozenEndRef.current = Date.now() + durationS * 1000;
          leftFreezeZoneAtRef.current = null;
          setFrozen(true);
          setFrozenSecondsLeft(durationS);
          setFreezeLocation(myPosRef.current); // lock-in current position
          wasInFreezeZoneRef.current = true;
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isFugitive, session?.id, myGroup?.id, setFrozen]);

  // Freeze countdown — pauses while seeker is outside the zone; releases only when inside
  useEffect(() => {
    if (!isFrozen) return;
    const t = setInterval(() => {
      let endTime = frozenEndRef.current ?? 0;
      // If outside, compensate so displayed time stays frozen
      if (leftFreezeZoneAtRef.current !== null) {
        endTime += Date.now() - leftFreezeZoneAtRef.current;
      }
      const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setFrozenSecondsLeft(left);
      // Only release when seeker is inside the zone
      if (left === 0 && leftFreezeZoneAtRef.current === null) {
        setFrozen(false);
        setFreezeLocation(null);
        wasInFreezeZoneRef.current = true;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isFrozen, setFrozen]);

  // Freeze proximity check — pauses countdown while outside, adds +30 s penalty on each exit
  useEffect(() => {
    if (!isFrozen || !freezeLocation || !myPos) return;

    const inRadius = haversineDistance(myPos, freezeLocation) <= FREEZE_HOLD_RADIUS_M;

    if (wasInFreezeZoneRef.current && !inRadius) {
      // Exited: add 30 s penalty and record exit time to pause countdown
      frozenEndRef.current = (frozenEndRef.current ?? Date.now()) + 30_000;
      leftFreezeZoneAtRef.current = Date.now();
    } else if (!wasInFreezeZoneRef.current && inRadius) {
      // Re-entered: extend end time by time spent outside (restores paused duration)
      if (leftFreezeZoneAtRef.current !== null) {
        frozenEndRef.current = (frozenEndRef.current ?? Date.now()) + (Date.now() - leftFreezeZoneAtRef.current);
        leftFreezeZoneAtRef.current = null;
      }
    }
    wasInFreezeZoneRef.current = inRadius;
  }, [myPos, isFrozen, freezeLocation]);

  // Drone view: seeker receives real-time fugitive reveals when fugitive enters a drone circle
  useEffect(() => {
    if (isFugitive || !session || !myGroup) return;

    const channel = supabase
      .channel(`game:${session.id}:drone:${myGroup.id}`)
      .on("broadcast", { event: "drone_reveal" }, ({ payload }) => {
        useGameStore.getState().setLastFugitiveReveal(payload as GroupLocation);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isFugitive, session?.id, myGroup?.id]);

  // Trail reader: fetch last 10 fugitive positions periodically
  useEffect(() => {
    if (isFugitive || !session || !myGroup || !hasTrailReader) {
      setFugitiveTrail([]);
      return;
    }

    const fugitiveGroup = groups.find((g) => g.role === "fugitive");
    if (!fugitiveGroup) return;

    async function fetchTrail() {
      const { data } = await supabase
        .from("group_locations")
        .select("lat, lng")
        .eq("group_id", fugitiveGroup!.id)
        .eq("session_id", session!.id)
        .order("recorded_at", { ascending: false })
        .limit(10);

      if (data) {
        setFugitiveTrail(
          (data as { lat: number; lng: number }[])
            .map((l) => ({ lat: l.lat, lng: l.lng }))
            .reverse()
        );
      }
    }

    fetchTrail();
    const interval = setInterval(fetchTrail, 10_000);
    return () => clearInterval(interval);
  }, [isFugitive, session?.id, myGroup?.id, hasTrailReader, groups]);

  // Game timer
  useEffect(() => {
    if (!session?.started_at || !session.settings.duration_s) return;
    const end =
      new Date(session.started_at).getTime() +
      (session.settings.duration_s ?? 5400) * 1000;
    const update = () =>
      setTimeLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [session?.started_at]);

  // Headstart countdown for seekers
  useEffect(() => {
    if (isFugitive || !session?.started_at) return;
    const headstartS = session.settings.headstart_s ?? DEFAULT_HEADSTART_S;
    const startedAt = new Date(session.started_at).getTime();
    const update = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setHeadstartLeft(Math.max(0, Math.ceil(headstartS - elapsed)));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [session?.started_at, isFugitive]);

  // Reveal countdown for seekers
  useEffect(() => {
    if (isFugitive) return;
    const interval =
      session?.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S;
    const lastReveal = lastFugitiveReveal
      ? new Date(lastFugitiveReveal.recorded_at).getTime()
      : Date.now();
    const update = () => {
      const elapsed = (Date.now() - lastReveal) / 1000;
      setRevealCountdown(Math.max(0, interval - Math.floor(elapsed)));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [lastFugitiveReveal?.recorded_at, isFugitive]);

  // Re-render every second while abilities drawer is open so cooldown timers update
  useEffect(() => {
    if (!abilitiesOpen) return;
    const t = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [abilitiesOpen]);

  // ── Ability activation helpers ───────────────────────────────────────────────

  async function recordUsage(def: AbilityDefinition, ability: GroupAbility) {
    if (!myGroup || !session) return;
    const expiresAt = def.duration_seconds
      ? new Date(Date.now() + def.duration_seconds * 1000).toISOString()
      : null;
    await supabase.from("active_abilities").insert({
      group_id: myGroup.id,
      session_id: session.id,
      ability_id: def.id,
      expires_at: expiresAt,
    });
    if (def.tier === "ultimate") {
      await supabase.from("groups")
        .update({ action_points: myGroup.action_points - (def.ap_cost ?? 0) })
        .eq("id", myGroup.id);
    }
    await supabase.from("group_abilities")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", ability.id);
    updateAbilityLastUsed(def.id);
  }

  async function activateInstant(def: AbilityDefinition, ga: GroupAbility) {
    const pos = await getCurrentPos();
    if (!pos) { Alert.alert("Fehler", "GPS-Position nicht verfügbar."); return; }
    const fugitiveGroup = groups.find((g) => g.role === "fugitive");
    if (!fugitiveGroup) { Alert.alert("Fehler", "Kein Flüchtiger gefunden."); return; }
    const { data: fugLoc } = await supabase
      .from("group_locations").select("lat, lng, recorded_at")
      .eq("group_id", fugitiveGroup.id).order("recorded_at", { ascending: false }).limit(1).single();
    if (!fugLoc) { Alert.alert("Kein Signal", "Noch kein Standort des Flüchtigen verfügbar."); return; }
    const fugPos = { lat: fugLoc.lat, lng: fugLoc.lng };
    const age = Math.round((Date.now() - new Date(fugLoc.recorded_at).getTime()) / 1000);
    const ageLabel = age < 60 ? `vor ${age}s` : `vor ${Math.round(age / 60)} min`;
    if (def.type === "compass") {
      const bearing = bearingDegrees(pos, fugPos);
      Alert.alert("🧭 Kompass", `Richtung: ${compassDirection(bearing)} (${Math.round(bearing)}°)\n\nStandort aktualisiert ${ageLabel}.`);
    }
    if (def.type === "distance_reveal") {
      Alert.alert("📏 Distanz", `Entfernung: ${formatDistance(haversineDistance(pos, fugPos))}\n\nStandort aktualisiert ${ageLabel}.`);
    }
    if (def.type === "poi_proximity_reveal") {
      if (pois.length === 0) { Alert.alert("Keine POIs", "Keine Standorte vorhanden."); return; }
      let closest = pois[0];
      let closestDist = haversineDistance(fugPos, { lat: pois[0].lat, lng: pois[0].lng });
      for (const poi of pois.slice(1)) {
        const d = haversineDistance(fugPos, { lat: poi.lat, lng: poi.lng });
        if (d < closestDist) { closestDist = d; closest = poi; }
      }
      Alert.alert("📍 POI-Nähe", `Flüchtiger ist nahe: ${closest.name}\n(${formatDistance(closestDist)})\n\nStandort aktualisiert ${ageLabel}.`);
    }
    if (def.type === "exact_location") {
      const bearing = bearingDegrees(pos, fugPos);
      Alert.alert("🎯 Exakter Standort", `Richtung: ${compassDirection(bearing)} (${Math.round(bearing)}°)\nEntfernung: ${formatDistance(haversineDistance(pos, fugPos))}\n\nStandort aktualisiert ${ageLabel}.`);
    }
    await recordUsage(def, ga);
  }

  async function activatePlacement(def: AbilityDefinition, ga: GroupAbility) {
    const pos = await getCurrentPos();
    if (!pos) { Alert.alert("Fehler", "GPS-Position nicht verfügbar."); return; }
    const expiresAt = def.duration_seconds
      ? new Date(Date.now() + def.duration_seconds * 1000).toISOString()
      : null;
    const area = session ? ((session as any).scenario?.game_area as GeoPolygon | null) : null;
    const areaScale = area ? computeGameAreaScale(area) : 1.0;
    const radiusM = Math.round(
      ((def.effect_config?.radius_m as number | undefined) ?? (def.type === "motion_detector" ? 50 : 100)) * areaScale
    );
    const { error } = await supabase.from("ability_objects").insert({
      session_id: session!.id,
      placed_by_group_id: myGroup!.id,
      type: def.type,
      geometry: { lat: pos.lat, lng: pos.lng },
      expires_at: expiresAt,
      metadata: { radius_m: radiusM, ...(def.type === "trap" ? { duration_s: (def.effect_config?.duration_s as number) ?? 300 } : {}) },
    });
    if (error) { Alert.alert("Fehler", error.message); return; }
    await recordUsage(def, ga);
    const label =
      def.type === "exclusion_zone" ? `Sperrzone platziert (${radiusM} m Radius)` :
      def.type === "trap" ? "Falle platziert an deinem Standort" :
      def.type === "roadblock" ? "Straßensperre errichtet" :
      `${def.name} platziert (${radiusM} m)`;
    Alert.alert("Platziert!", label);
  }

  async function activateFreeze(def: AbilityDefinition, ga: GroupAbility) {
    if (!myGroup || !session) return;
    const pos = await getCurrentPos();
    if (!pos) { Alert.alert("Fehler", "GPS-Position nicht verfügbar."); return; }
    const seekerGroups = groups.filter((g) => g.role === "seeker");
    let nearest: { groupId: string; name: string } | null = null;
    let nearestDist = Infinity;
    for (const sg of seekerGroups) {
      const loc = latestLocations.get(sg.id);
      if (!loc) continue;
      const d = haversineDistance(pos, { lat: loc.lat, lng: loc.lng });
      if (d < nearestDist) { nearestDist = d; nearest = { groupId: sg.id, name: sg.name }; }
    }
    if (!nearest) { Alert.alert("Kein Ziel", "Kein Detektiv-Standort bekannt."); return; }
    await recordUsage(def, ga);
    const durationS = def.duration_seconds ?? 180;
    supabase.channel(`game:${session.id}:freeze`).send({
      type: "broadcast",
      event: "freeze_applied",
      payload: { target_group_id: nearest.groupId, duration_s: durationS },
    });
    Alert.alert("❄️ Eingefroren!", `${nearest.name} wurde für ${Math.round(durationS / 60)} Min. eingefroren.`);
  }

  async function runAbility(def: AbilityDefinition, ga: GroupAbility) {
    if (INSTANT_ABILITIES.has(def.type)) {
      await activateInstant(def, ga);
    } else if (MAP_PLACEMENT_ABILITIES.has(def.type)) {
      router.push(`/(game)/drone-placement?ga_id=${ga.id}`);
    } else if (PLACEMENT_ABILITIES.has(def.type)) {
      await activatePlacement(def, ga);
    } else if (def.type === "freeze") {
      await activateFreeze(def, ga);
    } else {
      await recordUsage(def, ga);
      Alert.alert("Aktiviert!", `${def.name} ist jetzt aktiv.`);
    }
  }

  async function activateAbility(ga: GroupAbility) {
    if (!myGroup || !session) return;
    const def = ga.ability as AbilityDefinition | undefined;
    if (!def) return;
    if (isOobPunished || isFrozen || isTrapped) {
      Alert.alert("Gesperrt", "Fähigkeiten sind gerade nicht verfügbar.");
      return;
    }
    if (def.tier === "ultimate") {
      if ((myGroup.action_points ?? 0) < (def.ap_cost ?? 0)) {
        Alert.alert("Zu wenig AP", `Du brauchst ${def.ap_cost} AP, hast aber ${myGroup.action_points}.`);
        return;
      }
      Alert.alert(
        `${def.name} aktivieren?`,
        def.description + `\n\nKosten: ${def.ap_cost} AP`,
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Aktivieren", onPress: async () => { setActivating(ga.id); await runAbility(def, ga); setActivating(null); } },
        ]
      );
    } else {
      if (!isCooldownReady(ga)) {
        const remaining = cooldownRemainingSeconds(ga);
        Alert.alert("Abklingzeit", `Noch ${Math.ceil(remaining / 60)}m ${Math.round(remaining % 60)}s warten.`);
        return;
      }
      setActivating(ga.id);
      await runAbility(def, ga);
      setActivating(null);
    }
  }

  function openDrawer(mode: "abilities" | "tasks") {
    if (drawerMode === mode) {
      Animated.timing(drawerAnim, {
        toValue: DRAWER_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setDrawerMode(null));
    } else if (drawerMode !== null) {
      setDrawerMode(mode);
    } else {
      setDrawerMode(mode);
      Animated.timing(drawerAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }

  function closeDrawer() {
    Animated.timing(drawerAnim, {
      toValue: DRAWER_HEIGHT,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setDrawerMode(null));
  }

  function exitGame() {
    setMenuOpen(false);
    Alert.alert(
      "Spiel verlassen?",
      "Du verlässt das Spiel dauerhaft. Wenn alle gehen, wird das Spiel abgebrochen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Verlassen",
          style: "destructive",
          onPress: async () => {
            if (!myGroup || !session) { router.replace("/"); return; }
            await supabase.from("groups").delete().eq("id", myGroup.id);
            const { data: remaining } = await supabase
              .from("groups").select("id").eq("session_id", session.id);
            if (!remaining || remaining.length === 0) {
              await supabase.from("game_sessions").update({
                status: "aborted",
                finished_at: new Date().toISOString(),
              }).eq("id", session.id);
            }
            resetGame();
            resetPlayer();
            router.replace("/");
          },
        },
      ]
    );
  }

  const nearbyTasks = useNearbyTasks(myPos?.lat ?? null, myPos?.lng ?? null);

  const catchRadiusM = session?.settings.catch_radius_m ?? CATCH_RADIUS_M;
  const canAttemptCatch =
    !isFugitive &&
    headstartLeft === 0 &&
    myPos !== null &&
    lastFugitiveReveal !== null &&
    haversineDistance(myPos, { lat: lastFugitiveReveal.lat, lng: lastFugitiveReveal.lng }) <=
      catchRadiusM * 3;

  // Filter visible groups (stealth hides seekers from fugitive)
  const visibleGroups = isPunished
    ? []
    : groups.filter((g) => {
        if (g.id === myGroup?.id) return false;
        if (isFugitive) {
          if (g.role !== "seeker") return false;
          const isStealth = allActiveAbilities.some(
            (a) =>
              a.group_id === g.id &&
              a.ability?.type === "stealth" &&
              (!a.expires_at || new Date(a.expires_at) > now)
          );
          return !isStealth;
        }
        return g.role === "fugitive";
      });

  const gameArea = session
    ? ((session as any).scenario?.game_area as GeoPolygon | null)
    : null;

  /** Determines if an ability object is visible to this player. */
  function isObjectVisible(obj: AbilityObject): boolean {
    if (obj.expires_at && new Date(obj.expires_at) <= now) return false;

    const isOwn = obj.placed_by_group_id === myGroup?.id;
    const placerGroup = groups.find((g) => g.id === obj.placed_by_group_id);
    const placerIsFugitive = placerGroup?.role === "fugitive";

    switch (obj.type) {
      case "exclusion_zone":
      case "roadblock":
        return true;

      case "drone_view":
        return isOwn || isGMOrHost;

      case "motion_detector": {
        if (isOwn) return true;
        // Teammates (other seekers) can see each other's detectors
        if (!isFugitive && !placerIsFugitive) return true;
        // Fugitive sees detectors within 100m with reveal_static active
        if (hasRevealStatic && myPos) {
          const center = obj.geometry as GeoPoint;
          return haversineDistance(myPos, center) <= 100;
        }
        return false;
      }

      case "trap":
        // Only placing fugitive sees their traps on the map
        return isOwn;

      default:
        return true;
    }
  }

  function renderAbilityObjects() {
    return abilityObjects.map((obj: AbilityObject) => {
      if (!isObjectVisible(obj)) return null;
      if (!("lat" in obj.geometry)) return null;

      const center = obj.geometry as GeoPoint;
      const radius = (obj.metadata?.radius_m as number) ?? 100;

      if (obj.type === "exclusion_zone" || obj.type === "drone_view") {
        return (
          <Circle
            key={obj.id}
            center={{ latitude: center.lat, longitude: center.lng }}
            radius={radius}
            strokeColor={
              obj.type === "exclusion_zone"
                ? "rgba(231,76,60,0.8)"
                : "rgba(52,152,219,0.8)"
            }
            fillColor={
              obj.type === "exclusion_zone"
                ? "rgba(231,76,60,0.15)"
                : "rgba(52,152,219,0.1)"
            }
            strokeWidth={2}
          />
        );
      }

      if (obj.type === "motion_detector") {
        return (
          <Circle
            key={obj.id}
            center={{ latitude: center.lat, longitude: center.lng }}
            radius={radius}
            strokeColor="rgba(46,204,113,0.7)"
            fillColor="rgba(46,204,113,0.08)"
            strokeWidth={1.5}
          />
        );
      }

      if (obj.type === "roadblock") {
        return (
          <Circle
            key={obj.id}
            center={{ latitude: center.lat, longitude: center.lng }}
            radius={radius}
            strokeColor="rgba(155,89,182,0.8)"
            fillColor="rgba(155,89,182,0.1)"
            strokeWidth={2}
          />
        );
      }

      if (obj.type === "trap" || obj.type === "tripwire") {
        return (
          <Marker
            key={obj.id}
            coordinate={{ latitude: center.lat, longitude: center.lng }}
            title={obj.type === "trap" ? "Falle" : "Stolperdraht"}
            pinColor="#E74C3C"
          />
        );
      }

      return null;
    });
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={
          myPos
            ? {
                latitude: myPos.lat,
                longitude: myPos.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }
            : undefined
        }
      >
        {/* Game area boundary */}
        {gameArea && (
          <Polygon
            coordinates={gameArea.coordinates[0].map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }))}
            strokeColor="rgba(52, 152, 219, 0.8)"
            fillColor="rgba(52, 152, 219, 0.05)"
            strokeWidth={2}
          />
        )}

        {/* Freeze hold zone — blue when inside, red when outside */}
        {isFrozen && freezeLocation && (
          <Circle
            center={{ latitude: freezeLocation.lat, longitude: freezeLocation.lng }}
            radius={FREEZE_HOLD_RADIUS_M}
            strokeColor={
              myPos && haversineDistance(myPos, freezeLocation) <= FREEZE_HOLD_RADIUS_M
                ? "rgba(0,85,170,0.8)"
                : "rgba(231,76,60,0.9)"
            }
            fillColor="rgba(0,85,170,0.1)"
            strokeWidth={2}
          />
        )}

        {/* Fugitive trail (trail_reader ability) */}
        {fugitiveTrail.length > 1 && (
          <Polyline
            coordinates={fugitiveTrail.map((p) => ({
              latitude: p.lat,
              longitude: p.lng,
            }))}
            strokeColor="rgba(231,76,60,0.85)"
            strokeWidth={3}
            lineDashPattern={[6, 4]}
          />
        )}

        {/* POI markers — always visible for active tasks */}
        {pois
          .filter((poi) =>
            myTasks.some((t) => t.task?.poi_id === poi.id && t.status === "active")
          )
          .map((poi) => (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lng }}
              title={poi.name}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.poiMarker}>
                <Text style={styles.poiMarkerIcon}>🎯</Text>
              </View>
            </Marker>
          ))}

        {/* Other group markers */}
        {visibleGroups.map((g) => {
          const loc =
            isFugitive
              ? latestLocations.get(g.id)
              : g.role === "fugitive"
              ? lastFugitiveReveal
              : latestLocations.get(g.id);
          if (!loc) return null;
          return (
            <Marker
              key={g.id}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={styles.groupMarkerWrapper}>
                <View style={[styles.groupMarkerBubble, { backgroundColor: g.color }]}>
                  <Text style={styles.groupMarkerIcon}>
                    {g.role === "fugitive" ? "🏃" : "🔍"}
                  </Text>
                </View>
                <Text style={styles.groupMarkerName} numberOfLines={1}>{g.name}</Text>
              </View>
            </Marker>
          );
        })}

        {/* Ability objects */}
        {renderAbilityObjects()}
      </MapView>

      {/* Top HUD */}
      <View style={[styles.topHUD, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {isFugitive ? "🏃 Flüchtig" : "🔍 Detektiv"}
            </Text>
          </View>

          {timeLeft !== null && (
            <View style={styles.timerBox}>
              <Text style={styles.timerText}>{formatDuration(timeLeft)}</Text>
            </View>
          )}

          <View style={styles.apBox}>
            <Text style={styles.apText}>⚡ {myGroup?.action_points ?? 0} AP</Text>
          </View>

          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setMenuOpen((o) => !o)}
            pointerEvents="auto"
          >
            <Text style={styles.menuBtnText}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* OOB warning */}
        {isOutside && (
          <View style={styles.oobWarning}>
            <Text style={styles.oobWarningText}>Außerhalb des Spielfelds!</Text>
            {isPunished && (
              <Text style={styles.oobWarningText}>Fähigkeiten & Sicht deaktiviert</Text>
            )}
          </View>
        )}

        {/* Exclusion zone warning (fugitive inside a seeker's zone) */}
        {isInExclusionZone && (
          <View style={styles.exclusionZoneWarning}>
            <Text style={styles.exclusionZoneWarningText}>⛔ Sperrzone! Sofort verlassen!</Text>
          </View>
        )}

        {/* Headstart banner for seekers */}
        {!isFugitive && headstartLeft > 0 && (
          <View style={styles.headstartBanner}>
            <Text style={styles.headstartText}>
              🏃 Vorsprung läuft: {formatDuration(headstartLeft)}
            </Text>
          </View>
        )}

        {/* Reveal countdown for seekers */}
        {!isFugitive && headstartLeft === 0 && (
          <View style={styles.revealRow}>
            <Text style={styles.revealText}>
              Nächster Ping in {revealCountdown}s
            </Text>
          </View>
        )}
      </View>

      {/* Slide-up drawer — abilities or tasks, mutually exclusive */}
      <Animated.View
        style={[
          styles.slideDrawer,
          { bottom: BAR_HEIGHT + insets.bottom, transform: [{ translateY: drawerAnim }] },
        ]}
        pointerEvents={drawerMode !== null ? "auto" : "none"}
      >
        {/* ── Abilities content ── */}
        {abilitiesOpen && (
          myAbilities.length === 0 ? (
            <Text style={styles.drawerEmpty}>Keine Fähigkeiten ausgewählt</Text>
          ) : (
            myAbilities.map((ga) => {
              const def = ga.ability as AbilityDefinition | undefined;
              const isUltimate = def?.tier === "ultimate";
              const ready = isCooldownReady(ga);
              const remaining = cooldownRemainingSeconds(ga);
              const canAfford = !isUltimate || (myGroup?.action_points ?? 0) >= (def?.ap_cost ?? 0);
              const isActivatingThis = activating === ga.id;
              const locked = isOobPunished || isFrozen || isTrapped;
              const isDisabled = activating !== null || locked || (!isUltimate && !ready) || (isUltimate && !canAfford);

              let statusText: string;
              if (isUltimate) {
                statusText = `${def?.ap_cost ?? "?"} AP`;
              } else if (!ready) {
                statusText = `${Math.ceil(remaining / 60)}m ${Math.round(remaining % 60)}s`;
              } else {
                statusText = "✓ Bereit";
              }

              return (
                <TouchableOpacity
                  key={ga.id}
                  style={[
                    styles.drawerCard,
                    !isUltimate && !ready && styles.drawerCardCooldown,
                    isUltimate && !canAfford && styles.drawerCardNoAP,
                  ]}
                  onPress={() => activateAbility(ga)}
                  disabled={isDisabled}
                >
                  {isActivatingThis ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Text style={styles.drawerCardName} numberOfLines={1}>
                        {def?.name ?? "Fähigkeit"}
                      </Text>
                      <Text style={[
                        styles.drawerCardCost,
                        isUltimate && canAfford && styles.drawerCardCostAP,
                        isUltimate && !canAfford && styles.drawerCardCostRed,
                        !isUltimate && ready && styles.drawerCardReady,
                      ]}>
                        {statusText}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })
          )
        )}

        {/* ── Tasks content ── */}
        {tasksOpen && (
          (() => {
            const activeTasks = myTasks.filter((t) => t.status === "active");
            if (activeTasks.length === 0) {
              return <Text style={styles.drawerEmpty}>Keine aktiven Aufgaben</Text>;
            }
            return (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tasksScrollContent}
              >
                {activeTasks.map((t) => {
                  const poi = pois.find((p) => p.id === t.task?.poi_id);
                  const dist =
                    myPos && poi
                      ? haversineDistance(myPos, { lat: poi.lat, lng: poi.lng })
                      : null;
                  const distLabel =
                    dist !== null
                      ? dist >= 1000
                        ? `${(dist / 1000).toFixed(1)} km`
                        : `${Math.round(dist)} m`
                      : null;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.taskDrawerCard}
                      onPress={() => {
                        if (poi) {
                          mapRef.current?.animateToRegion({
                            latitude: poi.lat,
                            longitude: poi.lng,
                            latitudeDelta: 0.006,
                            longitudeDelta: 0.006,
                          });
                        }
                        closeDrawer();
                      }}
                    >
                      <Text style={styles.taskDrawerPoi} numberOfLines={1}>
                        📍 {poi?.name ?? "Unbekannter Ort"}
                      </Text>
                      <Text style={styles.taskDrawerTitle} numberOfLines={2}>
                        {t.task?.title ?? "Aufgabe"}
                      </Text>
                      {distLabel && (
                        <Text style={styles.taskDrawerDist}>{distLabel}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            );
          })()
        )}
      </Animated.View>

      {/* Bottom panel: alerts + 3-segment bar */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom }]} pointerEvents="box-none">
        {/* Caught in a trap */}
        {isTrapped && (
          <View style={styles.trapOverlay}>
            <Text style={styles.trapOverlayTitle}>🪤 GEFANGEN!</Text>
            <Text style={styles.trapOverlaySub}>Du steckst in einer Falle!</Text>
          </View>
        )}

        {/* Frozen by fugitive ability */}
        {isFrozen && (
          <View style={styles.frozenOverlay}>
            <Text style={styles.frozenOverlayTitle}>❄️ EINGEFROREN!</Text>
            {myPos && freezeLocation &&
            haversineDistance(myPos, freezeLocation) > FREEZE_HOLD_RADIUS_M ? (
              <Text style={styles.frozenOverlaySub}>
                ⚠️ Zone verlassen! +30s Strafe — noch {frozenSecondsLeft}s
              </Text>
            ) : (
              <Text style={styles.frozenOverlaySub}>
                Bleib im Kreis — noch {frozenSecondsLeft}s
              </Text>
            )}
          </View>
        )}

        {/* Active catch window */}
        {isCatching && (
          <View style={styles.catchWindow}>
            <Text style={styles.catchWindowTitle}>🎯 FANGEN!</Text>
            <Text style={styles.catchWindowSub}>Bleib nah dran!</Text>
            <View style={styles.catchBarTrack}>
              <View
                style={[
                  styles.catchBarFill,
                  { width: `${((catchWindow - catchSecondsLeft) / catchWindow) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.catchWindowCountdown}>{catchSecondsLeft}s</Text>
          </View>
        )}

        {/* Proximity hint */}
        {!isCatching && canAttemptCatch && (
          <View style={styles.catchBanner}>
            <Text style={styles.catchText}>🎯 Du bist nah dran!</Text>
          </View>
        )}

        {/* Nearby task alert */}
        {nearbyTasks.length > 0 && (
          <TouchableOpacity
            style={styles.taskAlert}
            pointerEvents="auto"
            onPress={() => router.push(`/(game)/task/${nearbyTasks[0].id}`)}
          >
            <Text style={styles.taskAlertIcon}>📍</Text>
            <View style={styles.taskAlertText}>
              <Text style={styles.taskAlertTitle}>Aufgabe in der Nähe!</Text>
              <Text style={styles.taskAlertSub}>{nearbyTasks[0].task?.title}</Text>
            </View>
            <Text style={styles.taskAlertArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* 3-segment bottom bar */}
        <View style={styles.bottomBar} pointerEvents="auto">
          <TouchableOpacity
            style={[styles.barSegment, abilitiesOpen && styles.barSegmentActive]}
            onPress={() => openDrawer("abilities")}
          >
            <Text style={styles.barIcon}>⚡</Text>
            <Text style={styles.barLabel}>Fähigkeiten</Text>
          </TouchableOpacity>

          <View style={styles.barDivider} />

          <TouchableOpacity
            style={styles.barSegment}
            onPress={() => {
              if (drawerMode !== null) closeDrawer();
              if (myPos) {
                mapRef.current?.animateToRegion({
                  latitude: myPos.lat,
                  longitude: myPos.lng,
                  latitudeDelta: 0.008,
                  longitudeDelta: 0.008,
                });
              }
            }}
          >
            <Text style={styles.barIcon}>📍</Text>
            <Text style={styles.barLabel}>Zentrieren</Text>
          </TouchableOpacity>

          <View style={styles.barDivider} />

          <TouchableOpacity
            style={[styles.barSegment, tasksOpen && styles.barSegmentActive]}
            onPress={() => openDrawer("tasks")}
          >
            <Text style={styles.barIcon}>📋</Text>
            <Text style={styles.barLabel}>Aufgaben</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Menu overlay */}
      {menuOpen && (
        <TouchableOpacity
          style={styles.menuBackdrop}
          onPress={() => setMenuOpen(false)}
          activeOpacity={1}
        >
          <View
            style={[styles.menuPanel, { top: insets.top + 60 }]}
            pointerEvents="auto"
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={exitGame}
            >
              <Text style={styles.menuItemText}>🚪  Spiel verlassen</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },

  // ── Top HUD ──────────────────────────────────────────────────────────────────
  topHUD: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  hudRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  roleBadge: {
    backgroundColor: "rgba(26,26,46,0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  roleBadgeText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  timerBox: {
    flex: 1,
    backgroundColor: "rgba(26,26,46,0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  timerText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  apBox: {
    backgroundColor: "rgba(26,26,46,0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  apText: { color: "#F39C12", fontWeight: "700", fontSize: 14 },
  menuBtn: {
    backgroundColor: "rgba(26,26,46,0.9)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  menuBtnText: { color: "#fff", fontSize: 18, lineHeight: 22 },
  oobWarning: {
    marginTop: 8,
    backgroundColor: "rgba(204,0,0,0.9)",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
    gap: 2,
  },
  oobWarningText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  exclusionZoneWarning: {
    marginTop: 8,
    backgroundColor: "rgba(231,76,60,0.92)",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
  },
  exclusionZoneWarningText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headstartBanner: {
    marginTop: 8,
    backgroundColor: "rgba(155,89,182,0.9)",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
  },
  headstartText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  revealRow: {
    marginTop: 8,
    backgroundColor: "rgba(155,89,182,0.8)",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
  },
  revealText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // ── Slide-up drawer (abilities + tasks) ─────────────────────────────────────
  slideDrawer: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: "rgba(15,15,35,0.97)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    zIndex: 5,
  },
  drawerCard: {
    flex: 1,
    backgroundColor: "rgba(52,152,219,0.15)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(52,152,219,0.3)",
  },
  drawerCardName: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
  drawerCardCost: { color: "#8888aa", fontSize: 11, marginTop: 3 },
  drawerCardCostAP: { color: "#F39C12" },
  drawerCardCostRed: { color: "#E74C3C" },
  drawerCardReady: { color: "#2ECC71", fontWeight: "700" },
  drawerCardCooldown: { opacity: 0.5 },
  drawerCardNoAP: { opacity: 0.4 },
  drawerEmpty: { color: "#8888aa", fontSize: 13, flex: 1, textAlign: "center" },
  tasksScrollContent: {
    alignItems: "center",
    paddingHorizontal: 4,
    gap: 8,
  },
  taskDrawerCard: {
    width: 140,
    backgroundColor: "rgba(243,156,18,0.12)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(243,156,18,0.35)",
    justifyContent: "center",
  },
  taskDrawerPoi: { color: "#F39C12", fontSize: 12, fontWeight: "800", marginBottom: 3 },
  taskDrawerTitle: { color: "#ddd", fontSize: 11, lineHeight: 15 },
  taskDrawerDist: { color: "#8888aa", fontSize: 10, marginTop: 4, fontWeight: "600" },

  // ── Custom map markers ────────────────────────────────────────────────────────
  poiMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E67E22",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
  },
  poiMarkerIcon: { fontSize: 18 },
  groupMarkerWrapper: {
    alignItems: "center",
    gap: 3,
  },
  groupMarkerBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
  },
  groupMarkerIcon: { fontSize: 20 },
  groupMarkerName: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    maxWidth: 72,
    textAlign: "center",
    overflow: "hidden",
  },

  // ── Bottom panel ─────────────────────────────────────────────────────────────
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  trapOverlay: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#6B3A2A",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  trapOverlayTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  trapOverlaySub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  frozenOverlay: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#0055AA",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  frozenOverlayTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  frozenOverlaySub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  catchWindow: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#C0392B",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  catchWindowTitle: { color: "#fff", fontWeight: "900", fontSize: 22, letterSpacing: 1 },
  catchWindowSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  catchBarTrack: {
    width: "100%",
    height: 8,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 4,
    marginTop: 12,
    overflow: "hidden",
  },
  catchBarFill: { height: "100%", backgroundColor: "#fff", borderRadius: 4 },
  catchWindowCountdown: { color: "#fff", fontWeight: "900", fontSize: 32, marginTop: 6 },
  catchBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "rgba(231,76,60,0.85)",
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
  },
  catchText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  taskAlert: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#F39C12",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  taskAlertIcon: { fontSize: 24 },
  taskAlertText: { flex: 1 },
  taskAlertTitle: { color: "#000", fontWeight: "800", fontSize: 15 },
  taskAlertSub: { color: "rgba(0,0,0,0.7)", fontSize: 13 },
  taskAlertArrow: { color: "#000", fontSize: 20, fontWeight: "700" },

  // ── 3-segment bottom bar ─────────────────────────────────────────────────────
  bottomBar: {
    flexDirection: "row",
    backgroundColor: "rgba(15,15,35,0.97)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  barSegment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  barSegmentActive: {
    backgroundColor: "rgba(52,152,219,0.15)",
  },
  barDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginVertical: 10,
  },
  barIcon: { fontSize: 22 },
  barLabel: { color: "#8888aa", fontSize: 11, marginTop: 3, fontWeight: "600" },

  // ── Dropdown menu ─────────────────────────────────────────────────────────────
  menuBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  menuPanel: {
    position: "absolute",
    right: 12,
    backgroundColor: "rgba(20,20,45,0.98)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    minWidth: 200,
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuItemText: { color: "#E74C3C", fontSize: 16, fontWeight: "700" },
});

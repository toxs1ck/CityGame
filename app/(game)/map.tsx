import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
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
import { canControl, formatDuration } from "../../lib/gameLogic";
import { haversineDistance, isInsidePolygon } from "../../lib/geo";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_HEADSTART_S,
  CATCH_RADIUS_M,
  DEFAULT_CATCH_WINDOW_S,
} from "../../constants/game";
import type { AbilityObject, GeoPoint, GeoPolygon, GroupLocation } from "../../types/game";

export default function GameMapScreen() {
  const {
    session,
    groups,
    latestLocations,
    lastFugitiveReveal,
    pois,
    abilityObjects,
    allActiveAbilities,
  } = useGameStore();
  const {
    myGroup,
    deviceId,
    myTasks,
    setOobPunished,
    isFrozen,
    setFrozen,
    isTrapped,
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

  const FREEZE_HOLD_RADIUS_M = 25;

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
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return;
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

        {/* POI markers */}
        {pois.map((poi) => {
          const hasActiveTask = myTasks.some(
            (t) => t.task?.poi_id === poi.id && t.status === "active"
          );
          return (
            <Marker
              key={poi.id}
              coordinate={{ latitude: poi.lat, longitude: poi.lng }}
              title={poi.name}
              pinColor={hasActiveTask ? "#F39C12" : "#8888aa"}
            />
          );
        })}

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
              title={g.name}
              pinColor={g.color}
            />
          );
        })}

        {/* Ability objects */}
        {renderAbilityObjects()}
      </MapView>

      {/* Top HUD */}
      <SafeAreaView style={styles.topHUD} pointerEvents="box-none">
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
      </SafeAreaView>

      {/* Bottom panel */}
      <SafeAreaView style={styles.bottomPanel} pointerEvents="box-none">
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
                  {
                    width: `${
                      ((catchWindow - catchSecondsLeft) / catchWindow) * 100
                    }%`,
                  },
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
            onPress={() =>
              router.push(`/(game)/task/${nearbyTasks[0].id}`)
            }
          >
            <Text style={styles.taskAlertIcon}>📍</Text>
            <View style={styles.taskAlertText}>
              <Text style={styles.taskAlertTitle}>Aufgabe in der Nähe!</Text>
              <Text style={styles.taskAlertSub}>
                {nearbyTasks[0].task?.title}
              </Text>
            </View>
            <Text style={styles.taskAlertArrow}>→</Text>
          </TouchableOpacity>
        )}

        <View style={styles.bottomButtons}>
          <TouchableOpacity
            style={styles.bottomBtn}
            onPress={() => router.push("/(game)/abilities-active")}
          >
            <Text style={styles.bottomBtnIcon}>⚡</Text>
            <Text style={styles.bottomBtnLabel}>Fähigkeiten</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.bottomBtn, styles.centerBtn]}
            onPress={() => {
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
            <Text style={styles.bottomBtnIcon}>📍</Text>
            <Text style={styles.bottomBtnLabel}>Zentrieren</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.bottomBtn}
            onPress={() => {
              Alert.alert(
                "Aufgaben",
                myTasks
                  .filter((t) => t.status === "active")
                  .map((t, i) => `${i + 1}. ${t.task?.title ?? "…"}`)
                  .join("\n") || "Keine aktiven Aufgaben."
              );
            }}
          >
            <Text style={styles.bottomBtnIcon}>📋</Text>
            <Text style={styles.bottomBtnLabel}>Aufgaben</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
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
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  trapOverlay: {
    margin: 12,
    marginBottom: 0,
    backgroundColor: "#6B3A2A",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  trapOverlayTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  trapOverlaySub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  frozenOverlay: {
    margin: 12,
    marginBottom: 0,
    backgroundColor: "#0055AA",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  frozenOverlayTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  frozenOverlaySub: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 2 },
  catchWindow: {
    margin: 12,
    marginBottom: 0,
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
  catchBarFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 4,
  },
  catchWindowCountdown: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 32,
    marginTop: 6,
  },
  catchBanner: {
    margin: 12,
    marginBottom: 0,
    backgroundColor: "rgba(231,76,60,0.85)",
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
  },
  catchText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  taskAlert: {
    margin: 12,
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
  bottomButtons: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingBottom: 24,
    gap: 8,
  },
  bottomBtn: {
    flex: 1,
    backgroundColor: "rgba(26,26,46,0.95)",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  centerBtn: {
    backgroundColor: "rgba(52,152,219,0.9)",
  },
  bottomBtnIcon: { fontSize: 22 },
  bottomBtnLabel: {
    color: "#fff",
    fontSize: 11,
    marginTop: 4,
    fontWeight: "600",
  },
});

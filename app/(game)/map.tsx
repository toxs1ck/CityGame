import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
} from "react-native";
import MapView, { Marker, Circle, Polygon } from "react-native-maps";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { useLocationTracking } from "../../hooks/useLocation";
import { useGroupLocations } from "../../hooks/useGroupLocations";
import { useGameSessionSubscription } from "../../hooks/useGameSession";
import { useFugitiveRevealBroadcast } from "../../hooks/useRevealInterval";
import { useNearbyTasks } from "../../hooks/useNearbyTasks";
import { supabase } from "../../lib/supabase";
import { canControl, formatDuration } from "../../lib/gameLogic";
import { DEFAULT_REVEAL_INTERVAL_S } from "../../constants/game";
import type { GeoPolygon } from "../../types/game";

export default function GameMapScreen() {
  const { session, groups, latestLocations, lastFugitiveReveal, pois, setSession } = useGameStore();
  const { myGroup, deviceId, myTasks } = usePlayerStore();
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [revealCountdown, setRevealCountdown] = useState(0);
  const mapRef = useRef<MapView>(null);

  const isFugitive = myGroup?.role === "fugitive";
  const isGMOrHost = session ? canControl(session, deviceId!, null) : false;

  // Location tracking
  useLocationTracking(!!session && session.status === "active");

  // Real-time subscriptions
  useGroupLocations(session?.id ?? null);
  useGameSessionSubscription(session?.id ?? null);

  // GM/host broadcasts fugitive location on interval
  useFugitiveRevealBroadcast(isGMOrHost && session?.status === "active");

  // Watch own position for map centering and nearby tasks
  useEffect(() => {
    let sub: Location.LocationSubscription;
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status !== "granted") return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000 },
        (loc) => setMyPos({ lat: loc.coords.latitude, lng: loc.coords.longitude })
      ).then((s) => { sub = s; });
    });
    return () => { sub?.remove(); };
  }, []);

  // Game timer
  useEffect(() => {
    if (!session?.started_at || !session.settings.duration_s) return;
    const end = new Date(session.started_at).getTime() + (session.settings.duration_s ?? 5400) * 1000;
    const update = () => setTimeLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [session?.started_at]);

  // Reveal countdown for seekers
  useEffect(() => {
    if (isFugitive) return;
    const interval = session?.settings.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S;
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

  const visibleGroups = groups.filter((g) => {
    if (g.id === myGroup?.id) return false;
    if (isFugitive) return g.role === "seeker"; // fugitive always sees seekers
    return g.role === "fugitive"; // seekers see fugitive on reveal
  });

  const gameArea = session
    ? (session as any).scenario?.game_area as GeoPolygon | null
    : null;

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
            coordinates={gameArea.coordinates[0].map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="rgba(52, 152, 219, 0.8)"
            fillColor="rgba(52, 152, 219, 0.05)"
            strokeWidth={2}
          />
        )}

        {/* POI markers */}
        {pois.map((poi) => {
          const hasActiveTask = myTasks.some((t) => t.task?.poi_id === poi.id && t.status === "active");
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
          const loc = isFugitive
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

        {!isFugitive && (
          <View style={styles.revealRow}>
            <Text style={styles.revealText}>
              Nächster Ping in {revealCountdown}s
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom panel */}
      <SafeAreaView style={styles.bottomPanel} pointerEvents="box-none">
        {/* Nearby task alert */}
        {nearbyTasks.length > 0 && (
          <TouchableOpacity
            style={styles.taskAlert}
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
              // Show task list
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
  bottomBtnLabel: { color: "#fff", fontSize: 11, marginTop: 4, fontWeight: "600" },
});

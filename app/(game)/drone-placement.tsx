import { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import MapView, { Circle, Marker, Polygon } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { computeGameAreaScale } from "../../lib/geo";
import type { GeoPolygon } from "../../types/game";

const MAX_DRONES = 3;

export default function DronePlacementScreen() {
  const { ga_id } = useLocalSearchParams<{ ga_id: string }>();
  const { myAbilities, myGroup, updateAbilityLastUsed } = usePlayerStore();
  const { session } = useGameStore();
  const [locations, setLocations] = useState<{ lat: number; lng: number }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const mapRef = useRef<MapView>(null);

  const ga = myAbilities.find((a) => a.id === ga_id);
  const def = ga?.ability;

  const gameArea = session
    ? ((session as any).scenario?.game_area as GeoPolygon | null)
    : null;
  const areaScale = gameArea ? computeGameAreaScale(gameArea) : 1.0;
  const radiusM = Math.round(
    ((def?.effect_config?.radius_m as number | undefined) ?? 50) * areaScale
  );
  const durationS = def?.duration_seconds ?? 180;

  // Compute center of game area for initial map region
  const initialRegion = (() => {
    if (!gameArea) return undefined;
    const coords = gameArea.coordinates[0];
    const lats = coords.map((c) => c[1]);
    const lngs = coords.map((c) => c[0]);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    return {
      latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
      longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
      latitudeDelta: Math.max(latSpan * 1.3, 0.005),
      longitudeDelta: Math.max(lngSpan * 1.3, 0.005),
    };
  })();

  function handleMapPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    if (locations.length >= MAX_DRONES) return;
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setLocations((prev) => [...prev, { lat: latitude, lng: longitude }]);
  }

  async function confirm() {
    if (!myGroup || !session || !ga || !def || locations.length === 0) return;
    setConfirming(true);

    const expiresAt = new Date(Date.now() + durationS * 1000).toISOString();

    for (const loc of locations) {
      await supabase.from("ability_objects").insert({
        session_id: session.id,
        placed_by_group_id: myGroup.id,
        type: "drone_view",
        geometry: { lat: loc.lat, lng: loc.lng },
        expires_at: expiresAt,
        metadata: { radius_m: radiusM },
      });
    }

    // Deduct AP for ultimate abilities
    if (def.tier === "ultimate") {
      await supabase
        .from("groups")
        .update({ action_points: myGroup.action_points - (def.ap_cost ?? 0) })
        .eq("id", myGroup.id);
    }

    // Track in active_abilities so the ability system knows it's in use
    await supabase.from("active_abilities").insert({
      group_id: myGroup.id,
      session_id: session.id,
      ability_id: def.id,
      expires_at: expiresAt,
    });

    // Record usage timestamp to start cooldown after duration
    await supabase
      .from("group_abilities")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", ga.id);

    updateAbilityLastUsed(def.id);
    setConfirming(false);
    router.back();
  }

  const placed = locations.length;
  const remaining = MAX_DRONES - placed;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={initialRegion}
        onPress={handleMapPress}
      >
        {/* Game area boundary */}
        {gameArea && (
          <Polygon
            coordinates={gameArea.coordinates[0].map(([lng, lat]) => ({
              latitude: lat,
              longitude: lng,
            }))}
            strokeColor="rgba(52,152,219,0.8)"
            fillColor="rgba(52,152,219,0.05)"
            strokeWidth={2}
          />
        )}

        {/* Placed drone circles */}
        {locations.map((loc, i) => (
          <>
            <Circle
              key={`circle-${i}`}
              center={{ latitude: loc.lat, longitude: loc.lng }}
              radius={radiusM}
              strokeColor="rgba(52,152,219,0.85)"
              fillColor="rgba(52,152,219,0.18)"
              strokeWidth={2}
            />
            <Marker
              key={`marker-${i}`}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              title={`Drohne ${i + 1}`}
              pinColor="#3498DB"
            />
          </>
        ))}
      </MapView>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <View style={styles.dotsRow}>
          {Array.from({ length: MAX_DRONES }).map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i < placed ? styles.dotFilled : styles.dotEmpty]}
            />
          ))}
        </View>

        <Text style={styles.hint}>
          {remaining > 0
            ? `Tippe auf die Karte — noch ${remaining} Drohne${remaining !== 1 ? "n" : ""} platzieren`
            : "Alle 3 Drohnen platziert"}
        </Text>

        <Text style={styles.meta}>
          Radius: {radiusM} m · Dauer: {Math.round(durationS / 60)} min
        </Text>

        <View style={styles.btnRow}>
          {placed > 0 && (
            <TouchableOpacity
              style={styles.undoBtn}
              onPress={() => setLocations((prev) => prev.slice(0, -1))}
            >
              <Text style={styles.undoBtnText}>↩ Letzte</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.confirmBtn, placed === 0 && styles.confirmDisabled]}
            onPress={confirm}
            disabled={confirming || placed === 0}
          >
            {confirming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmBtnText}>
                🚁 {placed} Drohne{placed !== 1 ? "n" : ""} aktivieren
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  panel: {
    backgroundColor: "#0f0f23",
    padding: 20,
    paddingBottom: 36,
    gap: 10,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 4,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dotFilled: { backgroundColor: "#3498DB" },
  dotEmpty: { backgroundColor: "#333355" },
  hint: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  meta: {
    color: "#8888aa",
    fontSize: 12,
    textAlign: "center",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  undoBtn: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  undoBtnText: { color: "#8888aa", fontWeight: "700" },
  confirmBtn: {
    flex: 1,
    backgroundColor: "#3498DB",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  confirmDisabled: { backgroundColor: "#1a1a3e" },
  confirmBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});

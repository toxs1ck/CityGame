import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import MapView, { Marker, Polygon, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import type { GeoPolygon } from "../../../../types/game";

// Hides Google Maps' own POI labels so they don't intercept map taps
const MAP_STYLE = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

type Vertex = { lat: number; lng: number };

export default function BoundaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [initialRegion, setInitialRegion] = useState<{
    latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number;
  } | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    loadExisting();
  }, [id]);

  async function loadExisting() {
    const { data } = await supabase
      .from("scenarios")
      .select("game_area")
      .eq("id", id)
      .single();

    if (data?.game_area) {
      const poly = data.game_area as GeoPolygon;
      // GeoJSON coords are [lng, lat]; drop the closing duplicate
      const coords = poly.coordinates[0];
      const verts: Vertex[] = coords
        .slice(0, -1)
        .map(([lng, lat]) => ({ lat, lng }));
      setVertices(verts);
      centerOnVertices(verts);
    } else {
      // No boundary yet — center on user's current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setInitialRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      }
    }
  }

  function centerOnVertices(verts: Vertex[]) {
    if (verts.length === 0) return;
    const lats = verts.map((v) => v.lat);
    const lngs = verts.map((v) => v.lng);
    setInitialRegion({
      latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
      longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
      latitudeDelta: Math.max(Math.max(...lats) - Math.min(...lats), 0.005) * 1.4,
      longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.005) * 1.4,
    });
  }

  function handleMapPress(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setVertices((prev) => [...prev, { lat: latitude, lng: longitude }]);
  }

  async function save() {
    if (vertices.length < 3) {
      Alert.alert("Zu wenige Punkte", "Mindestens 3 Punkte werden benötigt.");
      return;
    }
    setSaving(true);

    // GeoJSON Polygon: [lng, lat] pairs, closed (first = last)
    const ring = [
      ...vertices.map((v) => [v.lng, v.lat]),
      [vertices[0].lng, vertices[0].lat],
    ];
    const gameArea: GeoPolygon = { type: "Polygon", coordinates: [ring] };

    const { error } = await supabase
      .from("scenarios")
      .update({ game_area: gameArea })
      .eq("id", id);

    setSaving(false);
    if (error) Alert.alert("Fehler", error.message);
    else Alert.alert("Gespeichert", "Spielfeldbegrenzung wurde gespeichert.");
  }

  async function clear() {
    Alert.alert("Löschen", "Alle Punkte entfernen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen", style: "destructive", onPress: async () => {
          setVertices([]);
          await supabase.from("scenarios").update({ game_area: null }).eq("id", id);
        },
      },
    ]);
  }

  const mapCoords = vertices.map((v) => ({ latitude: v.lat, longitude: v.lng }));
  const isClosed = vertices.length >= 3;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={MAP_STYLE}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        onPress={handleMapPress}
      >
        {/* Filled polygon when ≥ 3 vertices */}
        {isClosed && (
          <Polygon
            coordinates={mapCoords}
            strokeColor="rgba(52,152,219,0.9)"
            fillColor="rgba(52,152,219,0.15)"
            strokeWidth={2}
          />
        )}

        {/* Edge lines when < 3 (in-progress preview) */}
        {!isClosed && mapCoords.length >= 2 && (
          <Polyline
            coordinates={mapCoords}
            strokeColor="rgba(52,152,219,0.9)"
            strokeWidth={2}
          />
        )}

        {/* Vertex markers */}
        {vertices.map((v, i) => (
          <Marker
            key={i}
            coordinate={{ latitude: v.lat, longitude: v.lng }}
            title={`Punkt ${i + 1}`}
            pinColor={i === 0 ? "#2ECC71" : "#3498DB"}
          />
        ))}
      </MapView>

      <View style={styles.panel}>
        <Text style={styles.hint}>
          {vertices.length === 0
            ? "Tippe auf die Karte, um das Spielfeld festzulegen"
            : vertices.length < 3
            ? `${vertices.length} Punkt${vertices.length > 1 ? "e" : ""} — noch ${3 - vertices.length} für ein Polygon`
            : `${vertices.length} Punkte · Polygon geschlossen`}
        </Text>
        <Text style={styles.sub}>
          Google Maps-Ortsmarkierungen blockieren Tippen — tippe auf einen freien Bereich
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.undoBtn, vertices.length === 0 && styles.btnDisabled]}
            onPress={() => setVertices((prev) => prev.slice(0, -1))}
            disabled={vertices.length === 0}
          >
            <Text style={styles.undoBtnText}>↩ Letzte</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.clearBtn, vertices.length === 0 && styles.btnDisabled]}
            onPress={clear}
            disabled={vertices.length === 0}
          >
            <Text style={styles.clearBtnText}>✕ Alles</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, !isClosed && styles.btnDisabled]}
            onPress={save}
            disabled={saving || !isClosed}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>💾 Speichern</Text>
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
    gap: 8,
  },
  hint: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  sub: {
    color: "#555577",
    fontSize: 12,
    textAlign: "center",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  undoBtn: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  undoBtnText: { color: "#8888aa", fontWeight: "700" },
  clearBtn: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: { color: "#E74C3C", fontWeight: "700" },
  saveBtn: {
    flex: 1,
    backgroundColor: "#3498DB",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  btnDisabled: { opacity: 0.35 },
});

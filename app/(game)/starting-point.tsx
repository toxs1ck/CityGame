import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import MapView, { Marker, Circle } from "react-native-maps";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { haversineDistance } from "../../lib/geo";
import { STARTING_POINT_RADIUS_M } from "../../constants/game";
import type { StartingPoint } from "../../types/game";

export default function StartingPointScreen() {
  const { session } = useGameStore();
  const { myGroup } = usePlayerStore();
  const [assignedPoint, setAssignedPoint] = useState<StartingPoint | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [arrived, setArrived] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAssignedPoint();
  }, []);

  useEffect(() => {
    let sub: Location.LocationSubscription;
    (async () => {
      await Location.requestForegroundPermissionsAsync();
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000 },
        (loc) => {
          const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setCurrentPos(pos);
          if (assignedPoint) {
            const dist = haversineDistance(pos, { lat: assignedPoint.lat, lng: assignedPoint.lng });
            if (dist <= STARTING_POINT_RADIUS_M && !arrived) {
              setArrived(true);
              setTimeout(() => router.replace("/(game)/map"), 2000);
            }
          }
        }
      );
    })();
    return () => { sub?.remove(); };
  }, [assignedPoint]);

  async function fetchAssignedPoint() {
    if (!session || !myGroup) return;
    // Starting point is stored in group metadata or we fetch the one assigned by GM
    // For now, fetch the first unassigned starting point or the one set via group metadata
    const { data } = await supabase
      .from("starting_points")
      .select("*")
      .eq("scenario_id", session.scenario_id)
      .limit(1);

    if (data && data.length > 0) setAssignedPoint(data[0] as StartingPoint);
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  if (!assignedPoint) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Kein Startpunkt zugewiesen.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {arrived ? (
        <View style={styles.arrivedOverlay}>
          <Text style={styles.arrivedIcon}>✅</Text>
          <Text style={styles.arrivedText}>Angekommen! Spiel startet…</Text>
        </View>
      ) : (
        <>
          <MapView
            style={styles.map}
            showsUserLocation
            initialRegion={{
              latitude: assignedPoint.lat,
              longitude: assignedPoint.lng,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            }}
          >
            <Marker
              coordinate={{ latitude: assignedPoint.lat, longitude: assignedPoint.lng }}
              title={assignedPoint.name}
              pinColor="#F39C12"
            />
            <Circle
              center={{ latitude: assignedPoint.lat, longitude: assignedPoint.lng }}
              radius={STARTING_POINT_RADIUS_M}
              fillColor="rgba(243, 156, 18, 0.15)"
              strokeColor="rgba(243, 156, 18, 0.5)"
            />
          </MapView>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Dein Startpunkt</Text>
            <Text style={styles.infoName}>{assignedPoint.name}</Text>
            {currentPos && (
              <Text style={styles.distance}>
                Entfernung:{" "}
                {Math.round(haversineDistance(currentPos, { lat: assignedPoint.lat, lng: assignedPoint.lng }))} m
              </Text>
            )}
            <Text style={styles.infoSub}>Begib dich zum Startpunkt, um das Spiel zu beginnen.</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  map: { flex: 1 },
  infoCard: {
    backgroundColor: "#1a1a2e",
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  infoLabel: { color: "#8888aa", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  infoName: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 4 },
  distance: { color: "#F39C12", fontSize: 16, fontWeight: "600", marginTop: 8 },
  infoSub: { color: "#8888aa", fontSize: 14, marginTop: 8 },
  arrivedOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f0f23",
  },
  arrivedIcon: { fontSize: 64, marginBottom: 16 },
  arrivedText: { color: "#fff", fontSize: 22, fontWeight: "700" },
  errorText: { color: "#E74C3C", fontSize: 16 },
});

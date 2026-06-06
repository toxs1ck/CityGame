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
  const { myGroup, setMyGroup } = usePlayerStore();
  const [assignedPoint, setAssignedPoint] = useState<StartingPoint | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [arrived, setArrived] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAssignedPoint();
  }, [myGroup?.starting_point_id]);

  // Subscribe to group updates so that if the GM assigns a starting
  // point after this screen is shown, it appears automatically.
  useEffect(() => {
    if (!myGroup) return;
    const channel = supabase
      .channel(`group_sp:${myGroup.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "groups",
          filter: `id=eq.${myGroup.id}`,
        },
        (payload) => {
          const updated = payload.new as typeof myGroup;
          setMyGroup(updated);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myGroup?.id]);

  // Location watcher
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
            const dist = haversineDistance(pos, {
              lat: assignedPoint.lat,
              lng: assignedPoint.lng,
            });
            if (dist <= STARTING_POINT_RADIUS_M && !arrived) {
              setArrived(true);
              setTimeout(() => router.replace("/(game)/map"), 2000);
            }
          }
        }
      );
    })();
    return () => {
      sub?.remove();
    };
  }, [assignedPoint]);

  async function fetchAssignedPoint() {
    if (!session || !myGroup) return;
    setLoading(true);

    const spId = myGroup.starting_point_id;

    if (spId) {
      const { data } = await supabase
        .from("starting_points")
        .select("*")
        .eq("id", spId)
        .single();
      if (data) setAssignedPoint(data as StartingPoint);
    } else {
      // No point assigned yet — wait for GM to assign one
      setAssignedPoint(null);
    }

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
        <Text style={styles.waitIcon}>⏳</Text>
        <Text style={styles.waitTitle}>Warte auf Zuweisung</Text>
        <Text style={styles.waitSub}>
          Der Game Master weist deiner Gruppe noch einen Startpunkt zu.
        </Text>
      </View>
    );
  }

  if (arrived) {
    return (
      <View style={styles.center}>
        <Text style={styles.arrivedIcon}>✅</Text>
        <Text style={styles.arrivedText}>Angekommen! Spiel startet…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
            {Math.round(
              haversineDistance(currentPos, {
                lat: assignedPoint.lat,
                lng: assignedPoint.lng,
              })
            )}{" "}
            m
          </Text>
        )}
        <Text style={styles.infoSub}>
          Begib dich zum Startpunkt, um das Spiel zu beginnen.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: {
    flex: 1,
    backgroundColor: "#0f0f23",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  map: { flex: 1 },
  infoCard: {
    backgroundColor: "#1a1a2e",
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  infoLabel: {
    color: "#8888aa",
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  infoName: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 4 },
  distance: { color: "#F39C12", fontSize: 16, fontWeight: "600", marginTop: 8 },
  infoSub: { color: "#8888aa", fontSize: 14, marginTop: 8 },
  waitIcon: { fontSize: 56, marginBottom: 16 },
  waitTitle: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  waitSub: {
    color: "#8888aa",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  arrivedIcon: { fontSize: 64, marginBottom: 16 },
  arrivedText: { color: "#fff", fontSize: 22, fontWeight: "700" },
});

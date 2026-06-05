import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  SafeAreaView,
} from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import { useGameStore } from "../../../../store/gameStore";
import { usePlayerStore } from "../../../../store/playerStore";
import { useAllGroupLocations } from "../../../../hooks/useGroupLocations";
import { useFugitiveRevealBroadcast } from "../../../../hooks/useRevealInterval";
import { assignTasksToGroups } from "../../../../lib/gameLogic";
import type { GameSession, Group, POI, Task, GeoPolygon } from "../../../../types/game";

export default function MonitorScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { session, setSession, groups, setGroups, latestLocations, setPois } = useGameStore();
  const [localSession, setLocalSession] = useState<GameSession | null>(null);
  const [localGroups, setLocalGroups] = useState<Group[]>([]);
  const [joinCode, setJoinCode] = useState("");

  useAllGroupLocations(sessionId);
  useFugitiveRevealBroadcast(localSession?.status === "active");

  useEffect(() => {
    loadSession();
    subscribeToGroups();
    subscribeToSession();
  }, [sessionId]);

  async function loadSession() {
    const { data: sessionData } = await supabase
      .from("game_sessions")
      .select("*, scenario:scenarios(*)")
      .eq("id", sessionId)
      .single();

    if (sessionData) {
      const s = sessionData as GameSession;
      setLocalSession(s);
      setSession(s);
      setJoinCode(s.join_code);
    }

    const { data: groupData } = await supabase
      .from("groups")
      .select("*")
      .eq("session_id", sessionId)
      .order("joined_at");

    if (groupData) {
      setLocalGroups(groupData as Group[]);
      setGroups(groupData as Group[]);
    }

    const { data: poiData } = await supabase
      .from("pois")
      .select("*")
      .eq("scenario_id", sessionData?.scenario_id);
    if (poiData) setPois(poiData as POI[]);
  }

  function subscribeToGroups() {
    const channel = supabase
      .channel(`monitor:${sessionId}:groups`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${sessionId}` }, () => loadSession())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  function subscribeToSession() {
    const channel = supabase
      .channel(`monitor:${sessionId}:session`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          const s = payload.new as GameSession;
          setLocalSession(s);
          setSession(s);
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  async function assignFugitive(groupId: string) {
    await supabase.from("groups").update({ role: "seeker" }).eq("session_id", sessionId).neq("id", groupId);
    await supabase.from("groups").update({ role: "fugitive" }).eq("id", groupId);
    loadSession();
  }

  async function startGame() {
    const fugitiveGroup = localGroups.find((g) => g.role === "fugitive");
    if (!fugitiveGroup) {
      Alert.alert("Fehler", "Weise zuerst einer Gruppe die Flüchtig-Rolle zu.");
      return;
    }
    if (localGroups.length < 2) {
      Alert.alert("Fehler", "Mindestens 2 Gruppen werden benötigt.");
      return;
    }

    // Assign tasks to all groups
    const scenarioId = localSession?.scenario_id;
    if (!scenarioId) return;

    const { data: tasks } = await supabase
      .from("tasks")
      .select("*, poi:pois!inner(*)")
      .eq("poi.scenario_id", scenarioId);

    if (tasks && tasks.length > 0) {
      const taskCount = localSession?.settings?.task_count ?? 5;
      const assignments = assignTasksToGroups(localGroups, tasks as Task[], taskCount);

      const rows = [];
      for (const [groupId, taskIds] of assignments.entries()) {
        for (const taskId of taskIds) {
          rows.push({ group_id: groupId, task_id: taskId, session_id: sessionId, status: "active" });
        }
      }
      if (rows.length > 0) {
        await supabase.from("group_assigned_tasks").insert(rows);
      }
    }

    await supabase
      .from("game_sessions")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  async function endGame() {
    Alert.alert("Spiel beenden?", "Das Spiel wird für alle beendet.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Beenden",
        style: "destructive",
        onPress: async () => {
          await supabase
            .from("game_sessions")
            .update({ status: "finished", finished_at: new Date().toISOString() })
            .eq("id", sessionId);
        },
      },
    ]);
  }

  const gameArea = (localSession as any)?.scenario?.game_area as GeoPolygon | null;

  return (
    <View style={styles.container}>
      <MapView style={styles.map} showsUserLocation>
        {gameArea && (
          <Polygon
            coordinates={gameArea.coordinates[0].map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
            strokeColor="rgba(52,152,219,0.8)"
            fillColor="rgba(52,152,219,0.05)"
          />
        )}
        {localGroups.map((g) => {
          const loc = latestLocations.get(g.id);
          if (!loc) return null;
          return (
            <Marker
              key={g.id}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              title={`${g.name} (${g.role})`}
              pinColor={g.color}
            />
          );
        })}
      </MapView>

      <SafeAreaView style={styles.panel}>
        <View style={styles.codeRow}>
          <Text style={styles.label}>JOIN-CODE</Text>
          <Text style={styles.joinCode}>{joinCode}</Text>
          <Text style={[styles.statusBadge, localSession?.status === "active" && styles.statusActive]}>
            {localSession?.status === "lobby" ? "🟡 Lobby" : localSession?.status === "active" ? "🟢 Aktiv" : "⛔ Beendet"}
          </Text>
        </View>

        <ScrollView style={styles.groupList} contentContainerStyle={{ gap: 8 }}>
          {localGroups.map((g) => (
            <View key={g.id} style={[styles.groupRow, { borderLeftColor: g.color }]}>
              <View>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupRole}>
                  {g.role === "fugitive" ? "🏃 Flüchtig" : g.role === "seeker" ? "🔍 Detektiv" : "Unzugewiesen"}
                  {" · "}{g.action_points} AP
                </Text>
              </View>
              {localSession?.status === "lobby" && g.role !== "fugitive" && (
                <TouchableOpacity
                  style={styles.assignBtn}
                  onPress={() => assignFugitive(g.id)}
                >
                  <Text style={styles.assignBtnText}>🏃 Flüchtig</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.actions}>
          {localSession?.status === "lobby" && (
            <TouchableOpacity style={styles.startBtn} onPress={startGame}>
              <Text style={styles.startBtnText}>🚀 Spiel starten</Text>
            </TouchableOpacity>
          )}
          {localSession?.status === "active" && (
            <>
              <TouchableOpacity
                style={styles.reviewBtn}
                onPress={() => router.push(`/(gm)/session/${sessionId}/review`)}
              >
                <Text style={styles.reviewBtnText}>📸 Fotos prüfen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.endBtn} onPress={endGame}>
                <Text style={styles.endBtnText}>⛔ Beenden</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  map: { flex: 1 },
  panel: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: "45%",
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  label: { color: "#8888aa", fontSize: 11, letterSpacing: 2 },
  joinCode: { color: "#fff", fontWeight: "900", fontSize: 22, letterSpacing: 4 },
  statusBadge: { marginLeft: "auto", color: "#F39C12", fontWeight: "600" },
  statusActive: { color: "#2ECC71" },
  groupList: { flex: 1, marginBottom: 12 },
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
  },
  groupName: { color: "#fff", fontWeight: "700", fontSize: 15 },
  groupRole: { color: "#8888aa", fontSize: 12, marginTop: 2 },
  assignBtn: {
    backgroundColor: "#E74C3C",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assignBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8 },
  startBtn: { flex: 1, backgroundColor: "#2ECC71", borderRadius: 12, padding: 14, alignItems: "center" },
  startBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  reviewBtn: { flex: 1, backgroundColor: "#3498DB", borderRadius: 12, padding: 14, alignItems: "center" },
  reviewBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  endBtn: { backgroundColor: "#E74C3C", borderRadius: 12, padding: 14, paddingHorizontal: 18 },
  endBtnText: { color: "#fff", fontWeight: "700" },
});

import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { useGameStore } from "../../../store/gameStore";
import { usePlayerStore } from "../../../store/playerStore";
import { useAllGroupLocations } from "../../../hooks/useGroupLocations";
import { useFugitiveRevealBroadcast } from "../../../hooks/useRevealInterval";
import { assignTasksToGroups } from "../../../lib/gameLogic";
import type { GameSession, Group, Task, POI } from "../../../types/game";

export default function HostControlsScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { session, setSession, groups, setGroups, latestLocations, setPois } = useGameStore();
  const { deviceId } = usePlayerStore();
  const [localSession, setLocalSession] = useState<GameSession | null>(null);
  const [localGroups, setLocalGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useAllGroupLocations(sessionId);
  useFugitiveRevealBroadcast(localSession?.status === "active");

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel(`host:${sessionId}:groups`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${sessionId}` }, () => loadData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` }, (p) => {
        const s = p.new as GameSession;
        setLocalSession(s);
        setSession(s);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);

  async function loadData() {
    const [{ data: s }, { data: g }, { data: p }] = await Promise.all([
      supabase.from("game_sessions").select("*, scenario:scenarios(*)").eq("id", sessionId).single(),
      supabase.from("groups").select("*").eq("session_id", sessionId).order("joined_at"),
      supabase.from("pois").select("*"),
    ]);
    if (s) { setLocalSession(s as GameSession); setSession(s as GameSession); }
    if (g) { setLocalGroups(g as Group[]); setGroups(g as Group[]); }
    if (p) setPois(p as POI[]);
    setLoading(false);
  }

  async function setFugitive(groupId: string) {
    await supabase.from("groups").update({ role: "seeker" }).eq("session_id", sessionId).neq("id", groupId);
    await supabase.from("groups").update({ role: "fugitive" }).eq("id", groupId);
    loadData();
  }

  async function startGame() {
    const hasFugitive = localGroups.some((g) => g.role === "fugitive");
    if (!hasFugitive) { Alert.alert("Fehler", "Weise zuerst einer Gruppe die Flüchtig-Rolle zu."); return; }

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
      for (const [gId, taskIds] of assignments.entries()) {
        for (const tId of taskIds) {
          rows.push({ group_id: gId, task_id: tId, session_id: sessionId, status: "active" });
        }
      }
      if (rows.length > 0) await supabase.from("group_assigned_tasks").insert(rows);
    }

    await supabase.from("game_sessions").update({ status: "active", started_at: new Date().toISOString() }).eq("id", sessionId);
  }

  async function endGame() {
    Alert.alert("Spiel beenden?", "", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Beenden",
        style: "destructive",
        onPress: () =>
          supabase.from("game_sessions")
            .update({ status: "finished", finished_at: new Date().toISOString() })
            .eq("id", sessionId),
      },
    ]);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#2ECC71" size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} showsUserLocation>
        {localGroups.map((g) => {
          const loc = latestLocations.get(g.id);
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

      <View style={styles.panel}>
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>CODE</Text>
          <Text style={styles.code}>{localSession?.join_code}</Text>
          <Text style={[styles.status, localSession?.status === "active" && styles.statusActive]}>
            {localSession?.status === "lobby" ? "🟡 Lobby" : "🟢 Aktiv"}
          </Text>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
          {localGroups.map((g) => (
            <View key={g.id} style={[styles.groupRow, { borderLeftColor: g.color }]}>
              <View>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupRole}>
                  {g.role === "fugitive" ? "🏃" : g.role === "seeker" ? "🔍" : "?"}{" "}
                  {g.action_points} AP
                </Text>
              </View>
              {localSession?.status === "lobby" && g.role !== "fugitive" && (
                <TouchableOpacity style={styles.fugitiveBtn} onPress={() => setFugitive(g.id)}>
                  <Text style={styles.fugitiveBtnText}>🏃 Flüchtig</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.actions}>
          {localSession?.status === "lobby" && (
            <TouchableOpacity style={styles.startBtn} onPress={startGame}>
              <Text style={styles.startBtnText}>🚀 Starten</Text>
            </TouchableOpacity>
          )}
          {localSession?.status === "active" && (
            <TouchableOpacity style={styles.endBtn} onPress={endGame}>
              <Text style={styles.endBtnText}>⛔ Beenden</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  map: { flex: 1 },
  panel: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    maxHeight: "40%",
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  codeLabel: { color: "#8888aa", fontSize: 11, letterSpacing: 2 },
  code: { color: "#fff", fontWeight: "900", fontSize: 20, letterSpacing: 4 },
  status: { marginLeft: "auto", color: "#F39C12", fontWeight: "600" },
  statusActive: { color: "#2ECC71" },
  list: { flex: 1 },
  groupRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#0f0f23", borderRadius: 10, padding: 12, borderLeftWidth: 4,
  },
  groupName: { color: "#fff", fontWeight: "700" },
  groupRole: { color: "#8888aa", fontSize: 12 },
  fugitiveBtn: { backgroundColor: "#E74C3C", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  fugitiveBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  actions: { marginTop: 12 },
  startBtn: { backgroundColor: "#2ECC71", borderRadius: 12, padding: 16, alignItems: "center" },
  startBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  endBtn: { backgroundColor: "#E74C3C", borderRadius: 12, padding: 16, alignItems: "center" },
  endBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});

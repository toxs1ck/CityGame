import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { useGameStore } from "../../../store/gameStore";
import { usePlayerStore } from "../../../store/playerStore";
import { useAllGroupLocations } from "../../../hooks/useGroupLocations";
import { useFugitiveRevealBroadcast } from "../../../hooks/useRevealInterval";
import { assignTasksToGroups, assignStartingPoints } from "../../../lib/gameLogic";
import { useCatchDetection } from "../../../hooks/useCatchDetection";
import { JoinQRModal } from "../../../components/game/JoinQRModal";
import type { GameSession, Group, Task, POI, StartingPoint } from "../../../types/game";

export default function HostControlsScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { session, setSession, groups, setGroups, latestLocations, setPois } = useGameStore();
  const { deviceId } = usePlayerStore();
  const [localSession, setLocalSession] = useState<GameSession | null>(null);
  const [localGroups, setLocalGroups] = useState<Group[]>([]);
  const [startingPoints, setStartingPoints] = useState<StartingPoint[]>([]);
  const [spPickerGroup, setSpPickerGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrVisible, setQrVisible] = useState(false);

  useAllGroupLocations(sessionId);
  useFugitiveRevealBroadcast(localSession?.status === "active");
  const { catchInProgress, catchSeekerName } = useCatchDetection(localSession?.status === "active");

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel(`host:${sessionId}:changes`)
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

    const scenarioId = (s as any)?.scenario_id;
    if (scenarioId) {
      const { data: sp } = await supabase
        .from("starting_points")
        .select("*")
        .eq("scenario_id", scenarioId);
      if (sp) setStartingPoints(sp as StartingPoint[]);
    }

    setLoading(false);
  }

  async function setFugitive(groupId: string) {
    await supabase.from("groups").update({ role: "seeker" }).eq("session_id", sessionId).neq("id", groupId);
    await supabase.from("groups").update({ role: "fugitive" }).eq("id", groupId);
    loadData();
  }

  async function assignStartingPointToGroup(groupId: string, spId: string) {
    await supabase.from("groups").update({ starting_point_id: spId }).eq("id", groupId);
    setSpPickerGroup(null);
    loadData();
  }

  async function autoAssignStartingPoints() {
    if (startingPoints.length === 0) {
      Alert.alert("Keine Startpunkte", "Das Szenario hat keine Startpunkte.");
      return;
    }
    const assignments = assignStartingPoints(localGroups, startingPoints);
    await Promise.all(
      Array.from(assignments.entries()).map(([gId, spId]) =>
        supabase.from("groups").update({ starting_point_id: spId }).eq("id", gId)
      )
    );
    loadData();
  }

  async function startGame() {
    if (localGroups.length < 2) {
      Alert.alert("Fehler", "Mindestens 2 Gruppen werden benötigt.");
      return;
    }

    const autoFugitive = localSession?.settings?.auto_fugitive ?? false;
    let currentGroups = localGroups;

    if (!currentGroups.some((g) => g.role === "fugitive")) {
      if (!autoFugitive) {
        Alert.alert("Fehler", "Weise zuerst einer Gruppe die Flüchtig-Rolle zu, oder aktiviere 'Auto-Flüchtiger' in den Einstellungen.");
        return;
      }
      const chosen = currentGroups[Math.floor(Math.random() * currentGroups.length)];
      await supabase.from("groups").update({ role: "seeker" }).eq("session_id", sessionId).neq("id", chosen.id);
      await supabase.from("groups").update({ role: "fugitive" }).eq("id", chosen.id);
      const { data: fresh } = await supabase.from("groups").select("*").eq("session_id", sessionId).order("joined_at");
      if (fresh) {
        currentGroups = fresh as Group[];
        setLocalGroups(currentGroups);
        setGroups(currentGroups);
      }
    }

    const isStartingPointsMode =
      (localSession?.settings?.starting_mode ?? (localSession as any)?.scenario?.default_settings?.starting_mode) === "starting_points";

    // Auto-assign any unassigned groups if in starting_points mode
    if (isStartingPointsMode && startingPoints.length > 0) {
      const unassigned = currentGroups.filter((g) => !g.starting_point_id);
      if (unassigned.length > 0) {
        const assignments = assignStartingPoints(unassigned, startingPoints);
        await Promise.all(
          Array.from(assignments.entries()).map(([gId, spId]) =>
            supabase.from("groups").update({ starting_point_id: spId }).eq("id", gId)
          )
        );
      }
    }

    const scenarioId = localSession?.scenario_id;
    if (!scenarioId) return;

    const { data: tasks } = await supabase
      .from("tasks")
      .select("*, poi:pois!inner(*)")
      .eq("poi.scenario_id", scenarioId);

    if (tasks && tasks.length > 0) {
      const taskCount = localSession?.settings?.task_count ?? 5;
      const assignments = assignTasksToGroups(currentGroups, tasks as Task[], taskCount);
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

  const isStartingPointsMode =
    (localSession?.settings?.starting_mode ?? (localSession as any)?.scenario?.default_settings?.starting_mode) === "starting_points";

  function startingPointLabel(group: Group) {
    if (!group.starting_point_id) return "Nicht zugewiesen";
    return startingPoints.find((s) => s.id === group.starting_point_id)?.name ?? "Unbekannt";
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
        <JoinQRModal joinCode={localSession?.join_code} visible={qrVisible} onClose={() => setQrVisible(false)} />
        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>CODE</Text>
          <TouchableOpacity onPress={() => setQrVisible(true)} style={styles.qrBtn}>
            <Text style={styles.code}>{localSession?.join_code}</Text>
            <Text style={styles.qrIcon}>⬛</Text>
          </TouchableOpacity>
          {catchInProgress ? (
            <View style={styles.catchBadge}>
              <Text style={styles.catchBadgeText}>⏱ {catchSeekerName} fängt…</Text>
            </View>
          ) : (
            <Text style={[styles.status, localSession?.status === "active" && styles.statusActive]}>
              {localSession?.status === "lobby" ? "🟡 Lobby" : "🟢 Aktiv"}
            </Text>
          )}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
          {localGroups.map((g) => (
            <View key={g.id} style={[styles.groupRow, { borderLeftColor: g.color }]}>
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupRole}>
                  {g.role === "fugitive" ? "🏃" : g.role === "seeker" ? "🔍" : "?"}
                  {" "}{g.action_points} AP
                </Text>

                {localSession?.status === "lobby" && isStartingPointsMode && (
                  <TouchableOpacity
                    style={styles.spRow}
                    onPress={() => setSpPickerGroup(g)}
                  >
                    <Text style={styles.spIcon}>🚩</Text>
                    <Text style={[
                      styles.spLabel,
                      !g.starting_point_id && styles.spLabelUnassigned,
                    ]}>
                      {startingPointLabel(g)}
                    </Text>
                    <Text style={styles.spEdit}>✎</Text>
                  </TouchableOpacity>
                )}
              </View>

              {localSession?.status === "lobby" && g.role !== "fugitive" && (
                <TouchableOpacity style={styles.fugitiveBtn} onPress={() => setFugitive(g.id)}>
                  <Text style={styles.fugitiveBtnText}>🏃</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={styles.actions}>
          {localSession?.status === "lobby" && (
            <>
              {isStartingPointsMode && startingPoints.length > 0 && (
                <TouchableOpacity style={styles.autoBtn} onPress={autoAssignStartingPoints}>
                  <Text style={styles.autoBtnText}>🚩 Auto</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.startBtn} onPress={startGame}>
                <Text style={styles.startBtnText}>🚀 Starten</Text>
              </TouchableOpacity>
            </>
          )}
          {localSession?.status === "active" && (
            <TouchableOpacity style={styles.endBtn} onPress={endGame}>
              <Text style={styles.endBtnText}>⛔ Beenden</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Starting point picker modal */}
      <Modal visible={!!spPickerGroup} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              Startpunkt für {spPickerGroup?.name}
            </Text>

            {startingPoints.length === 0 ? (
              <Text style={styles.modalEmpty}>
                Keine Startpunkte vorhanden.
              </Text>
            ) : (
              <FlatList
                data={startingPoints}
                keyExtractor={(sp) => sp.id}
                style={styles.modalList}
                renderItem={({ item }) => {
                  const isSelected = spPickerGroup?.starting_point_id === item.id;
                  return (
                    <TouchableOpacity
                      style={[styles.spOption, isSelected && styles.spOptionSelected]}
                      onPress={() =>
                        spPickerGroup &&
                        assignStartingPointToGroup(spPickerGroup.id, item.id)
                      }
                    >
                      <Text style={styles.spOptionText}>{item.name}</Text>
                      {isSelected && <Text style={styles.spOptionCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setSpPickerGroup(null)}
            >
              <Text style={styles.modalCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  map: { height: "33%" },
  panel: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  codeLabel: { color: "#8888aa", fontSize: 11, letterSpacing: 2 },
  qrBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  code: { color: "#fff", fontWeight: "900", fontSize: 20, letterSpacing: 4 },
  qrIcon: { fontSize: 18, opacity: 0.6 },
  status: { marginLeft: "auto", color: "#F39C12", fontWeight: "600" },
  statusActive: { color: "#2ECC71" },
  catchBadge: {
    marginLeft: "auto",
    backgroundColor: "#E74C3C",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  catchBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  list: { flex: 1 },
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
  },
  groupInfo: { flex: 1 },
  groupName: { color: "#fff", fontWeight: "700" },
  groupRole: { color: "#8888aa", fontSize: 12 },
  spRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    backgroundColor: "#1a1a3e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  spIcon: { fontSize: 11 },
  spLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
  spLabelUnassigned: { color: "#E74C3C" },
  spEdit: { color: "#8888aa", fontSize: 10, marginLeft: 2 },
  fugitiveBtn: { backgroundColor: "#E74C3C", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginLeft: 8 },
  fugitiveBtnText: { fontSize: 16 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  autoBtn: {
    backgroundColor: "#9B59B6",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  autoBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  startBtn: { flex: 1, backgroundColor: "#2ECC71", borderRadius: 12, padding: 16, alignItems: "center" },
  startBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  endBtn: { flex: 1, backgroundColor: "#E74C3C", borderRadius: 12, padding: 16, alignItems: "center" },
  endBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modal: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "60%",
  },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 16 },
  modalList: { maxHeight: 280 },
  modalEmpty: { color: "#8888aa", fontSize: 14, textAlign: "center", marginBottom: 16 },
  spOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  spOptionSelected: { borderColor: "#2ECC71" },
  spOptionText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  spOptionCheck: { color: "#2ECC71", fontWeight: "800", fontSize: 16 },
  modalCancel: { marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: "#2a2a4e", alignItems: "center" },
  modalCancelText: { color: "#fff", fontWeight: "600" },
});

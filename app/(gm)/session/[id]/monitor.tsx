import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { Marker, Polygon } from "react-native-maps";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import { useGameStore } from "../../../../store/gameStore";
import { useAllGroupLocations } from "../../../../hooks/useGroupLocations";
import { useFugitiveRevealBroadcast } from "../../../../hooks/useRevealInterval";
import { assignTasksToGroups, assignStartingPoints } from "../../../../lib/gameLogic";
import { useCatchDetection } from "../../../../hooks/useCatchDetection";
import { JoinQRModal } from "../../../../components/game/JoinQRModal";
import type { GameSession, Group, POI, Task, StartingPoint, GeoPolygon } from "../../../../types/game";

export default function MonitorScreen() {
  const insets = useSafeAreaInsets();
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { session, setSession, groups, setGroups, latestLocations, setPois } = useGameStore();
  const [localSession, setLocalSession] = useState<GameSession | null>(null);
  const [localGroups, setLocalGroups] = useState<Group[]>([]);
  const [startingPoints, setStartingPoints] = useState<StartingPoint[]>([]);
  const [spPickerGroup, setSpPickerGroup] = useState<Group | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [mapRegion, setMapRegion] = useState<{
    latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number;
  } | undefined>(undefined);

  useAllGroupLocations(sessionId);
  useFugitiveRevealBroadcast(localSession?.status === "active");
  const { catchInProgress, catchSeekerName } = useCatchDetection(localSession?.status === "active");

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

      const [{ data: groupData }, { data: poiData }, { data: spData }] = await Promise.all([
        supabase.from("groups").select("*").eq("session_id", sessionId).order("joined_at"),
        supabase.from("pois").select("*").eq("scenario_id", s.scenario_id),
        supabase.from("starting_points").select("*").eq("scenario_id", s.scenario_id),
      ]);

      if (groupData) { setLocalGroups(groupData as Group[]); setGroups(groupData as Group[]); }
      if (poiData) setPois(poiData as POI[]);
      if (spData) setStartingPoints(spData as StartingPoint[]);

      // Center on game area if available, otherwise on user location
      const gameArea = (s as any).scenario?.game_area as GeoPolygon | null;
      if (gameArea) {
        const coords = gameArea.coordinates[0];
        const lats = coords.map(([, lat]) => lat);
        const lngs = coords.map(([lng]) => lng);
        setMapRegion({
          latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
          longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
          latitudeDelta: Math.max(Math.max(...lats) - Math.min(...lats), 0.005) * 1.4,
          longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.005) * 1.4,
        });
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMapRegion({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      }
    }
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

  async function assignStartingPointToGroup(groupId: string, spId: string) {
    await supabase.from("groups").update({ starting_point_id: spId }).eq("id", groupId);
    setSpPickerGroup(null);
    loadSession();
  }

  async function autoAssignStartingPoints() {
    if (startingPoints.length === 0) {
      Alert.alert("Keine Startpunkte", "Füge zuerst Startpunkte zum Szenario hinzu.");
      return;
    }
    const assignments = assignStartingPoints(localGroups, startingPoints);
    const updates = Array.from(assignments.entries()).map(([gId, spId]) =>
      supabase.from("groups").update({ starting_point_id: spId }).eq("id", gId)
    );
    await Promise.all(updates);
    loadSession();
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
      // Pick a random group as fugitive; all others become seekers
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
        const updates = Array.from(assignments.entries()).map(([gId, spId]) =>
          supabase.from("groups").update({ starting_point_id: spId }).eq("id", gId)
        );
        await Promise.all(updates);
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
      for (const [groupId, taskIds] of assignments.entries()) {
        for (const taskId of taskIds) {
          rows.push({ group_id: groupId, task_id: taskId, session_id: sessionId, status: "active" });
        }
      }
      if (rows.length > 0) await supabase.from("group_assigned_tasks").insert(rows);
    }

    await supabase
      .from("game_sessions")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  async function kickGroup(group: Group) {
    Alert.alert(
      "Spieler entfernen?",
      `„${group.name}" wird aus dem Spiel entfernt.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Entfernen",
          style: "destructive",
          onPress: () => supabase.from("groups").delete().eq("id", group.id),
        },
      ]
    );
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
  const isStartingPointsMode =
    (localSession?.settings?.starting_mode ?? (localSession as any)?.scenario?.default_settings?.starting_mode) === "starting_points";

  function startingPointLabel(group: Group) {
    if (!group.starting_point_id) return "Nicht zugewiesen";
    const sp = startingPoints.find((s) => s.id === group.starting_point_id);
    return sp?.name ?? "Unbekannt";
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} showsUserLocation initialRegion={mapRegion}>
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

      <View style={[styles.panel, { paddingBottom: insets.bottom }]}>
        <JoinQRModal joinCode={localSession?.join_code} visible={qrVisible} onClose={() => setQrVisible(false)} />
        <View style={styles.codeRow}>
          <Text style={styles.label}>JOIN-CODE</Text>
          <TouchableOpacity onPress={() => setQrVisible(true)} style={styles.qrBtn}>
            <Text style={styles.joinCode}>{localSession?.join_code}</Text>
            <Text style={styles.qrIcon}>⬛</Text>
          </TouchableOpacity>
          {catchInProgress ? (
            <View style={styles.catchBadge}>
              <Text style={styles.catchBadgeText}>⏱ {catchSeekerName} fängt…</Text>
            </View>
          ) : (
            <Text style={[styles.statusBadge, localSession?.status === "active" && styles.statusActive]}>
              {localSession?.status === "lobby" ? "🟡 Lobby" : localSession?.status === "active" ? "🟢 Aktiv" : "⛔ Beendet"}
            </Text>
          )}
        </View>

        <ScrollView style={styles.groupList} contentContainerStyle={{ gap: 8 }}>
          {localGroups.map((g) => (
            <View key={g.id} style={[styles.groupRow, { borderLeftColor: g.color }]}>
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupRole}>
                  {g.role === "fugitive" ? "🏃 Flüchtig" : g.role === "seeker" ? "🔍 Detektiv" : "Unzugewiesen"}
                  {" · "}{g.action_points} AP
                </Text>

                {/* Starting point assignment row */}
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

              <TouchableOpacity style={styles.kickBtn} onPress={() => kickGroup(g)}>
                <Text style={styles.kickBtnText}>✕</Text>
              </TouchableOpacity>

              {localSession?.status === "lobby" && g.role !== "fugitive" && (
                <TouchableOpacity
                  style={styles.assignBtn}
                  onPress={() => assignFugitive(g.id)}
                >
                  <Text style={styles.assignBtnText}>🏃</Text>
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
            <>
              <TouchableOpacity
                style={styles.reviewBtn}
                onPress={() => router.push(`/(gm)/session/${sessionId}/review`)}
              >
                <Text style={styles.reviewBtnText}>📸 Fotos</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.endBtn} onPress={endGame}>
                <Text style={styles.endBtnText}>⛔ Beenden</Text>
              </TouchableOpacity>
            </>
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
                Keine Startpunkte im Szenario. Füge sie unter Szenarien → POIs hinzu.
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
  map: { height: "33%" },
  panel: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  label: { color: "#8888aa", fontSize: 11, letterSpacing: 2 },
  qrBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  joinCode: { color: "#fff", fontWeight: "900", fontSize: 22, letterSpacing: 4 },
  qrIcon: { fontSize: 18, opacity: 0.6 },
  statusBadge: { marginLeft: "auto", color: "#F39C12", fontWeight: "600" },
  statusActive: { color: "#2ECC71" },
  catchBadge: {
    marginLeft: "auto",
    backgroundColor: "#E74C3C",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  catchBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
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
  groupInfo: { flex: 1 },
  groupName: { color: "#fff", fontWeight: "700", fontSize: 15 },
  groupRole: { color: "#8888aa", fontSize: 12, marginTop: 2 },
  spRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    backgroundColor: "#1a1a3e",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  spIcon: { fontSize: 12 },
  spLabel: { color: "#fff", fontSize: 12, fontWeight: "600" },
  spLabelUnassigned: { color: "#E74C3C" },
  spEdit: { color: "#8888aa", fontSize: 11, marginLeft: 2 },
  kickBtn: {
    backgroundColor: "rgba(231,76,60,0.15)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "rgba(231,76,60,0.4)",
  },
  kickBtnText: { color: "#E74C3C", fontSize: 14, fontWeight: "700" },
  assignBtn: {
    backgroundColor: "#E74C3C",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 8,
  },
  assignBtnText: { fontSize: 16 },
  actions: { flexDirection: "row", gap: 8 },
  autoBtn: {
    backgroundColor: "#9B59B6",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  autoBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  startBtn: { flex: 1, backgroundColor: "#2ECC71", borderRadius: 12, padding: 14, alignItems: "center" },
  startBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  reviewBtn: { flex: 1, backgroundColor: "#3498DB", borderRadius: 12, padding: 14, alignItems: "center" },
  reviewBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  endBtn: { backgroundColor: "#E74C3C", borderRadius: 12, padding: 14, paddingHorizontal: 18 },
  endBtnText: { color: "#fff", fontWeight: "700" },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
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
  modalCancel: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#2a2a4e",
    alignItems: "center",
  },
  modalCancelText: { color: "#fff", fontWeight: "600" },
});

import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import Slider from "@react-native-community/slider";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";
import { useGameStore } from "../../store/gameStore";
import { generateJoinCode } from "../../lib/gameLogic";
import type { Scenario, GameSession, POI, Group } from "../../types/game";
import { GROUP_COLORS } from "../../constants/game";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_DURATION_S,
  DEFAULT_TASK_COUNT,
  DEFAULT_HEADSTART_S,
  DEFAULT_CATCH_WINDOW_S,
  DEFAULT_CATCH_RADIUS_M,
} from "../../constants/game";

export default function HostSetupScreen() {
  const { deviceId, profile, user, setMyGroup } = usePlayerStore();
  const { setSession, setPois } = useGameStore();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [groupName, setGroupName] = useState(profile?.username ?? user?.email?.split("@")[0] ?? "");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [revealInterval, setRevealInterval] = useState(DEFAULT_REVEAL_INTERVAL_S);
  const [duration, setDuration] = useState(DEFAULT_DURATION_S);
  const [taskCount, setTaskCount] = useState(DEFAULT_TASK_COUNT);
  const [headstart, setHeadstart] = useState(DEFAULT_HEADSTART_S);
  const [startingMode, setStartingMode] = useState<"headstart" | "starting_points">("headstart");
  const [catchWindow, setCatchWindow] = useState(DEFAULT_CATCH_WINDOW_S);
  const [catchRadius, setCatchRadius] = useState(DEFAULT_CATCH_RADIUS_M);
  const [autoFugitive, setAutoFugitive] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    supabase
      .from("scenarios")
      .select("*")
      .eq("is_public", true)
      .order("name")
      .then(({ data }) => {
        if (data) setScenarios(data as Scenario[]);
        setLoading(false);
      });
  }, []);

  async function createSession() {
    if (!selected) { Alert.alert("Fehler", "Bitte ein Szenario auswählen."); return; }
    if (!deviceId) return;
    if (!groupName.trim()) { Alert.alert("Fehler", "Bitte einen Gruppenname eingeben."); return; }

    setCreating(true);
    const joinCode = generateJoinCode();
    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        scenario_id: selected.id,
        host_device_id: deviceId,
        mode: "host",
        status: "lobby",
        join_code: joinCode,
        settings: {
          reveal_interval_s: revealInterval,
          duration_s: duration,
          task_count: taskCount,
          headstart_s: headstart,
          starting_mode: startingMode,
          catch_window_s: catchWindow,
          catch_radius_m: catchRadius,
          auto_fugitive: autoFugitive,
        },
      })
      .select("*, scenario:scenarios(*)")
      .single();

    if (sessionError) {
      setCreating(false);
      Alert.alert("Fehler", sessionError.message);
      return;
    }

    // Create a group for the host so they appear in the lobby
    const { data: groupData, error: groupError } = await supabase
      .from("groups")
      .insert({
        session_id: sessionData.id,
        name: groupName.trim(),
        role: "unassigned",
        action_points: 0,
        color: GROUP_COLORS[0],
        device_id: deviceId,
      })
      .select()
      .single();

    if (groupError) {
      setCreating(false);
      Alert.alert("Fehler", groupError.message);
      return;
    }

    // Load POIs for the scenario
    const { data: poiData } = await supabase
      .from("pois")
      .select("*")
      .eq("scenario_id", selected.id);

    // Sync to stores so the host is recognised as a player
    setSession(sessionData as GameSession);
    setMyGroup(groupData as Group);
    if (poiData) setPois(poiData as POI[]);

    setCreating(false);
    router.push(`/host/${sessionData.id}/controls`);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Spiel hosten</Text>
      <Text style={styles.sub}>Teile den Join-Code mit deinen Mitspielern</Text>

      <Text style={styles.sectionTitle}>Deine Gruppe</Text>
      <TextInput
        style={styles.nameInput}
        placeholder="Gruppenname"
        placeholderTextColor="#555"
        value={groupName}
        onChangeText={setGroupName}
        maxLength={30}
      />

      <Text style={styles.sectionTitle}>Szenario wählen</Text>
      {scenarios.length === 0 ? (
        <Text style={styles.empty}>Keine öffentlichen Szenarien verfügbar.</Text>
      ) : (
        scenarios.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.card, selected?.id === s.id && styles.cardSelected]}
            onPress={() => setSelected(s)}
          >
            <Text style={styles.cardTitle}>{s.name}</Text>
            {s.description ? <Text style={styles.cardSub}>{s.description}</Text> : null}
          </TouchableOpacity>
        ))
      )}

      <Text style={styles.sectionTitle}>Einstellungen</Text>

      <Text style={styles.label}>Startmodus</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, startingMode === "headstart" && styles.modeBtnActive]}
          onPress={() => setStartingMode("headstart")}
        >
          <Text style={styles.modeBtnText}>⏱ Vorsprung</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, startingMode === "starting_points" && styles.modeBtnActive]}
          onPress={() => setStartingMode("starting_points")}
        >
          <Text style={styles.modeBtnText}>🚩 Startpunkte</Text>
        </TouchableOpacity>
      </View>

      {startingMode === "headstart" && (
        <>
          <Text style={styles.label}>Vorsprung: {Math.round(headstart / 60)} min</Text>
          <Slider minimumValue={60} maximumValue={600} step={60} value={headstart} onValueChange={setHeadstart} minimumTrackTintColor="#9B59B6" thumbTintColor="#9B59B6" />
        </>
      )}

      <Text style={styles.label}>Aufdeckungs-Intervall: {revealInterval}s</Text>
      <Slider minimumValue={30} maximumValue={300} step={30} value={revealInterval} onValueChange={setRevealInterval} minimumTrackTintColor="#3498DB" thumbTintColor="#3498DB" />

      <Text style={styles.label}>Spieldauer: {Math.round(duration / 60)} min</Text>
      <Slider minimumValue={1800} maximumValue={14400} step={600} value={duration} onValueChange={setDuration} minimumTrackTintColor="#2ECC71" thumbTintColor="#2ECC71" />

      <Text style={styles.label}>Aufgaben pro Gruppe: {taskCount}</Text>
      <Slider minimumValue={1} maximumValue={10} step={1} value={taskCount} onValueChange={setTaskCount} minimumTrackTintColor="#F39C12" thumbTintColor="#F39C12" />

      <View style={styles.ruleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ruleLabel}>Auto-Flüchtiger</Text>
          <Text style={styles.ruleSub}>Zufällige Gruppe wird beim Start als Flüchtig gewählt</Text>
        </View>
        <Switch
          value={autoFugitive}
          onValueChange={setAutoFugitive}
          trackColor={{ true: "#E74C3C", false: "#333" }}
          thumbColor="#fff"
        />
      </View>

      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setAdvanced((a) => !a)}
      >
        <Text style={styles.advancedText}>
          {advanced ? "▲ Erweiterte Einstellungen verbergen" : "▼ Erweiterte Einstellungen"}
        </Text>
      </TouchableOpacity>

      {advanced && (
        <View style={styles.advancedSection}>
          <Text style={styles.label}>Fangfenster: {catchWindow}s</Text>
          <Slider minimumValue={5} maximumValue={30} step={5} value={catchWindow} onValueChange={setCatchWindow} minimumTrackTintColor="#E74C3C" thumbTintColor="#E74C3C" />

          <Text style={styles.label}>Fangradius (m): {catchRadius}</Text>
          <Slider minimumValue={10} maximumValue={100} step={5} value={catchRadius} onValueChange={setCatchRadius} minimumTrackTintColor="#E74C3C" thumbTintColor="#E74C3C" />
        </View>
      )}

      <TouchableOpacity
        style={[styles.createButton, !selected && styles.createDisabled]}
        onPress={createSession}
        disabled={creating || !selected}
      >
        {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>🚀 Spiel erstellen</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  heading: { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 4 },
  sub: { color: "#8888aa", fontSize: 14, marginBottom: 28 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#fff", marginTop: 8, marginBottom: 12 },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardSelected: { borderColor: "#2ECC71" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardSub: { color: "#8888aa", fontSize: 13, marginTop: 4 },
  label: { color: "#8888aa", fontSize: 13, marginTop: 16, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  modeBtn: { flex: 1, backgroundColor: "#1a1a3e", borderRadius: 12, padding: 14, alignItems: "center" },
  modeBtnActive: { backgroundColor: "#3498DB" },
  modeBtnText: { color: "#fff", fontWeight: "600" },
  nameInput: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 8,
  },
  empty: { color: "#8888aa", textAlign: "center", marginTop: 32, marginBottom: 16 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, backgroundColor: "#1a1a3e", borderRadius: 14, padding: 16 },
  ruleLabel: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ruleSub: { color: "#8888aa", fontSize: 12, marginTop: 2 },
  advancedToggle: { marginTop: 16, padding: 12, alignItems: "center" },
  advancedText: { color: "#3498DB", fontSize: 14 },
  advancedSection: { backgroundColor: "#1a1a3e", borderRadius: 16, padding: 16, marginTop: 8 },
  createButton: { backgroundColor: "#2ECC71", borderRadius: 16, padding: 18, alignItems: "center", marginTop: 32 },
  createDisabled: { backgroundColor: "#1a3a1a" },
  createText: { color: "#fff", fontSize: 18, fontWeight: "800" },
});

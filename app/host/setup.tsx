import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
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
import { generateJoinCode } from "../../lib/gameLogic";
import type { Scenario } from "../../types/game";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_DURATION_S,
  DEFAULT_TASK_COUNT,
  DEFAULT_HEADSTART_S,
  DEFAULT_CATCH_WINDOW_S,
} from "../../constants/game";

export default function HostSetupScreen() {
  const { deviceId } = usePlayerStore();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [revealInterval, setRevealInterval] = useState(DEFAULT_REVEAL_INTERVAL_S);
  const [duration, setDuration] = useState(DEFAULT_DURATION_S);
  const [taskCount, setTaskCount] = useState(DEFAULT_TASK_COUNT);
  const [headstart, setHeadstart] = useState(DEFAULT_HEADSTART_S);
  const [startingMode, setStartingMode] = useState<"headstart" | "starting_points">("headstart");
  const [catchWindow, setCatchWindow] = useState(DEFAULT_CATCH_WINDOW_S);
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

    setCreating(true);
    const joinCode = generateJoinCode();
    const { data, error } = await supabase
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
        },
      })
      .select()
      .single();

    setCreating(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    router.push(`/host/${data.id}/controls`);
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
      <Text style={styles.sub}>Kein Account benötigt – teile den Code mit deinen Freunden</Text>

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

      <Text style={styles.label}>Fangfenster: {catchWindow}s</Text>
      <Slider minimumValue={5} maximumValue={30} step={5} value={catchWindow} onValueChange={setCatchWindow} minimumTrackTintColor="#E74C3C" thumbTintColor="#E74C3C" />

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
  empty: { color: "#8888aa", textAlign: "center", marginTop: 32, marginBottom: 16 },
  createButton: { backgroundColor: "#2ECC71", borderRadius: 16, padding: 18, alignItems: "center", marginTop: 32 },
  createDisabled: { backgroundColor: "#1a3a1a" },
  createText: { color: "#fff", fontSize: 18, fontWeight: "800" },
});

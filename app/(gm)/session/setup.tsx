import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from "react-native";
import { router } from "expo-router";
import Slider from "@react-native-community/slider";
import { supabase } from "../../../lib/supabase";
import { generateJoinCode } from "../../../lib/gameLogic";
import type { Scenario, ScenarioSettings } from "../../../types/game";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_DURATION_S,
  DEFAULT_TASK_COUNT,
  DEFAULT_HEADSTART_S,
  DEFAULT_CATCH_WINDOW_S,
} from "../../../constants/game";

export default function SessionSetupScreen() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Scenario | null>(null);
  const [settings, setSettings] = useState<Partial<ScenarioSettings>>({});
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("scenarios")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (data) setScenarios(data as Scenario[]);
      });
  }, []);

  function effectiveSetting<K extends keyof ScenarioSettings>(key: K): ScenarioSettings[K] {
    return (settings[key] ?? selected?.default_settings?.[key]) as ScenarioSettings[K];
  }

  async function startSession() {
    if (!selected) { Alert.alert("Fehler", "Bitte ein Szenario auswählen."); return; }
    setLoading(true);

    const { data: user } = await supabase.auth.getUser();
    const joinCode = generateJoinCode();

    const { data, error } = await supabase
      .from("game_sessions")
      .insert({
        scenario_id: selected.id,
        gm_id: user.user?.id,
        mode: "managed",
        status: "lobby",
        join_code: joinCode,
        settings,
      })
      .select()
      .single();

    setLoading(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    router.push(`/(gm)/session/${data.id}/monitor`);
  }

  const revealInterval = effectiveSetting("reveal_interval_s") ?? DEFAULT_REVEAL_INTERVAL_S;
  const duration = effectiveSetting("duration_s") ?? DEFAULT_DURATION_S;
  const taskCount = effectiveSetting("task_count") ?? DEFAULT_TASK_COUNT;
  const startingMode = effectiveSetting("starting_mode") ?? "headstart";
  const headstart = effectiveSetting("headstart_s") ?? DEFAULT_HEADSTART_S;
  const catchWindow = effectiveSetting("catch_window_s") ?? DEFAULT_CATCH_WINDOW_S;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Szenario auswählen</Text>
      {scenarios.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.card, selected?.id === s.id && styles.cardSelected]}
          onPress={() => setSelected(s)}
        >
          <Text style={styles.cardTitle}>{s.name}</Text>
          {s.description ? <Text style={styles.cardSub}>{s.description}</Text> : null}
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionTitle}>Einstellungen</Text>

      <Text style={styles.label}>Startmodus</Text>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, startingMode === "headstart" && styles.toggleActive]}>Vorsprung</Text>
        <Switch
          value={startingMode === "starting_points"}
          onValueChange={(v) =>
            setSettings((s) => ({ ...s, starting_mode: v ? "starting_points" : "headstart" }))
          }
          trackColor={{ true: "#9B59B6" }}
        />
        <Text style={[styles.toggleLabel, startingMode === "starting_points" && styles.toggleActive]}>Startpunkte</Text>
      </View>

      {startingMode === "headstart" && (
        <>
          <Text style={styles.label}>Vorsprung: {Math.round(headstart / 60)} min</Text>
          <Slider
            minimumValue={60} maximumValue={600} step={60}
            value={headstart}
            onValueChange={(v) => setSettings((s) => ({ ...s, headstart_s: v }))}
            minimumTrackTintColor="#9B59B6" thumbTintColor="#9B59B6"
          />
        </>
      )}

      <Text style={styles.label}>Aufdeckungs-Intervall: {revealInterval}s</Text>
      <Slider
        minimumValue={30} maximumValue={300} step={30}
        value={revealInterval}
        onValueChange={(v) => setSettings((s) => ({ ...s, reveal_interval_s: v }))}
        minimumTrackTintColor="#3498DB" thumbTintColor="#3498DB"
      />

      <Text style={styles.label}>Spieldauer: {Math.round(duration / 60)} min</Text>
      <Slider
        minimumValue={1800} maximumValue={14400} step={600}
        value={duration}
        onValueChange={(v) => setSettings((s) => ({ ...s, duration_s: v }))}
        minimumTrackTintColor="#2ECC71" thumbTintColor="#2ECC71"
      />

      <Text style={styles.label}>Aufgaben pro Gruppe: {taskCount}</Text>
      <Slider
        minimumValue={1} maximumValue={10} step={1}
        value={taskCount}
        onValueChange={(v) => setSettings((s) => ({ ...s, task_count: v }))}
        minimumTrackTintColor="#F39C12" thumbTintColor="#F39C12"
      />

      <Text style={styles.label}>Fangfenster: {catchWindow}s</Text>
      <Slider
        minimumValue={5} maximumValue={30} step={5}
        value={catchWindow}
        onValueChange={(v) => setSettings((s) => ({ ...s, catch_window_s: v }))}
        minimumTrackTintColor="#E74C3C" thumbTintColor="#E74C3C"
      />

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
          <Text style={styles.label}>POI-Radius (m): {effectiveSetting("poi_radius_m") ?? 50}</Text>
          <Slider
            minimumValue={20} maximumValue={200} step={10}
            value={effectiveSetting("poi_radius_m") ?? 50}
            onValueChange={(v) => setSettings((s) => ({ ...s, poi_radius_m: v }))}
            minimumTrackTintColor="#1ABC9C" thumbTintColor="#1ABC9C"
          />
          <Text style={styles.advancedNote}>Weitere Einstellungen folgen in einer späteren Version.</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.startButton, !selected && styles.startButtonDisabled]}
        onPress={startSession}
        disabled={loading || !selected}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.startButtonText}>🚀 Spiel starten</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingBottom: 48 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: 8, marginBottom: 12 },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardSelected: { borderColor: "#3498DB" },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardSub: { color: "#8888aa", fontSize: 13, marginTop: 4 },
  label: { color: "#8888aa", fontSize: 13, marginTop: 16, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleLabel: { color: "#8888aa", fontSize: 15 },
  toggleActive: { color: "#fff", fontWeight: "700" },
  advancedToggle: { marginTop: 16, padding: 12, alignItems: "center" },
  advancedText: { color: "#3498DB", fontSize: 14 },
  advancedSection: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  advancedNote: { color: "#8888aa", fontSize: 13, marginTop: 12 },
  startButton: {
    backgroundColor: "#2ECC71",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    marginTop: 32,
  },
  startButtonDisabled: { backgroundColor: "#1a3a1a" },
  startButtonText: { color: "#fff", fontSize: 18, fontWeight: "800" },
});

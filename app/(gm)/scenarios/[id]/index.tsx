import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Switch,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Slider from "@react-native-community/slider";
import { supabase } from "../../../../lib/supabase";
import type { Scenario, ScenarioSettings } from "../../../../types/game";

export default function ScenarioDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState<ScenarioSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchScenario();
  }, [id]);

  async function fetchScenario() {
    const { data } = await supabase
      .from("scenarios")
      .select("*")
      .eq("id", id)
      .single();
    if (data) {
      setScenario(data as Scenario);
      setName(data.name);
      setDescription(data.description);
      setSettings(data.default_settings as ScenarioSettings);
    }
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("scenarios")
      .update({ name, description, default_settings: settings })
      .eq("id", id);
    setSaving(false);
    if (error) Alert.alert("Fehler", error.message);
    else Alert.alert("Gespeichert", "Szenario wurde aktualisiert.");
  }

  if (!scenario || !settings) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} />

      <Text style={styles.label}>Beschreibung</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.sectionTitle}>Standard-Einstellungen</Text>

      <Text style={styles.label}>Startmodus</Text>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Vorsprung</Text>
        <Switch
          value={settings.starting_mode === "starting_points"}
          onValueChange={(v) =>
            setSettings((s) => s && { ...s, starting_mode: v ? "starting_points" : "headstart" })
          }
          trackColor={{ true: "#9B59B6" }}
        />
        <Text style={styles.toggleLabel}>Startpunkte</Text>
      </View>

      {settings.starting_mode === "headstart" && (
        <>
          <Text style={styles.label}>Vorsprung: {Math.round(settings.headstart_s / 60)} min</Text>
          <Slider
            minimumValue={60}
            maximumValue={600}
            step={60}
            value={settings.headstart_s}
            onValueChange={(v) => setSettings((s) => s && { ...s, headstart_s: v })}
            minimumTrackTintColor="#9B59B6"
            thumbTintColor="#9B59B6"
          />
        </>
      )}

      <Text style={styles.label}>Aufdeckungs-Intervall: {settings.reveal_interval_s}s</Text>
      <Slider
        minimumValue={30}
        maximumValue={300}
        step={30}
        value={settings.reveal_interval_s}
        onValueChange={(v) => setSettings((s) => s && { ...s, reveal_interval_s: v })}
        minimumTrackTintColor="#3498DB"
        thumbTintColor="#3498DB"
      />

      <Text style={styles.label}>Spieldauer: {Math.round(settings.duration_s / 60)} min</Text>
      <Slider
        minimumValue={1800}
        maximumValue={14400}
        step={600}
        value={settings.duration_s}
        onValueChange={(v) => setSettings((s) => s && { ...s, duration_s: v })}
        minimumTrackTintColor="#2ECC71"
        thumbTintColor="#2ECC71"
      />

      <Text style={styles.label}>Aufgaben pro Gruppe: {settings.task_count}</Text>
      <Slider
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={settings.task_count}
        onValueChange={(v) => setSettings((s) => s && { ...s, task_count: v })}
        minimumTrackTintColor="#F39C12"
        thumbTintColor="#F39C12"
      />

      <TouchableOpacity style={styles.button} onPress={save} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? "Speichern…" : "Speichern"}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Spielbestandteile</Text>

      <TouchableOpacity
        style={styles.navCard}
        onPress={() => router.push(`/(gm)/scenarios/${id}/boundary`)}
      >
        <Text style={styles.navCardTitle}>🗺️ Spielfeldbegrenzung</Text>
        <Text style={styles.navCardSub}>Polygon auf der Karte einzeichnen</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navCard}
        onPress={() => router.push(`/(gm)/scenarios/${id}/pois`)}
      >
        <Text style={styles.navCardTitle}>📍 POIs verwalten</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navCard}
        onPress={() => router.push(`/(gm)/scenarios/${id}/tasks`)}
      >
        <Text style={styles.navCardTitle}>✅ Aufgaben verwalten</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingBottom: 48 },
  label: { color: "#8888aa", fontSize: 13, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 24,
  },
  textarea: { height: 80, textAlignVertical: "top" },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    marginTop: 24,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
  },
  toggleLabel: { color: "#fff", fontSize: 15 },
  button: {
    backgroundColor: "#3498DB",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  navCard: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  navCardTitle: { fontSize: 16, fontWeight: "700", color: "#fff" },
  navCardSub: { color: "#8888aa", fontSize: 13, marginTop: 4 },
});

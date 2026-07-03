import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { usePlayerStore } from "../../../store/playerStore";
import {
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_DURATION_S,
  DEFAULT_TASK_COUNT,
  DEFAULT_HEADSTART_S,
  DEFAULT_MAX_ACTION_POINTS,
  POI_RADIUS_M,
} from "../../../constants/game";

export default function NewScenarioScreen() {
  const { user } = usePlayerStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function create() {
    if (!name.trim()) {
      Alert.alert("Fehler", "Bitte einen Namen eingeben.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("scenarios")
      .insert({
        created_by: user?.id,
        name: name.trim(),
        description: description.trim(),
        default_settings: {
          reveal_interval_s: DEFAULT_REVEAL_INTERVAL_S,
          duration_s: DEFAULT_DURATION_S,
          task_count: DEFAULT_TASK_COUNT,
          headstart_s: DEFAULT_HEADSTART_S,
          max_action_points: DEFAULT_MAX_ACTION_POINTS,
          poi_radius_m: POI_RADIUS_M,
          starting_mode: "headstart",
          location_update_interval_s: 5,
        },
        is_public: false,
      })
      .select()
      .single();

    setLoading(false);
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }
    router.replace(`/(gm)/scenarios/${data.id}`);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Name *</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="z. B. Altstadt-Tour"
        placeholderTextColor="#555"
      />

      <Text style={styles.label}>Beschreibung</Text>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Kurze Beschreibung des Szenarios…"
        placeholderTextColor="#555"
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={styles.button} onPress={create} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Szenario erstellen →</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24 },
  label: { color: "#8888aa", fontSize: 13, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 24,
  },
  textarea: { height: 100, textAlignVertical: "top" },
  button: {
    backgroundColor: "#3498DB",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";
import { useGameStore } from "../../store/gameStore";
import { GROUP_COLORS } from "../../constants/game";
import type { GameSession, Group, POI } from "../../types/game";

export default function JoinScreen() {
  const [code, setCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);

  const { deviceId, setMyGroup } = usePlayerStore();
  const { setSession, setPois } = useGameStore();

  async function join() {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = groupName.trim();

    if (trimmedCode.length < 6) { Alert.alert("Fehler", "Bitte einen gültigen 6-stelligen Code eingeben."); return; }
    if (!trimmedName) { Alert.alert("Fehler", "Bitte einen Gruppennamen eingeben."); return; }

    setLoading(true);

    // Find active session by join code
    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, scenario:scenarios(*)")
      .eq("join_code", trimmedCode)
      .in("status", ["lobby", "active"])
      .single();

    if (sessionError || !sessionData) {
      Alert.alert("Nicht gefunden", "Kein aktives Spiel mit diesem Code.");
      setLoading(false);
      return;
    }

    const session = sessionData as GameSession;

    // Check if this device already has a group in this session
    const { data: existingGroup } = await supabase
      .from("groups")
      .select("*")
      .eq("session_id", session.id)
      .eq("device_id", deviceId!)
      .maybeSingle();

    let myGroup: Group;

    if (existingGroup) {
      myGroup = existingGroup as Group;
    } else {
      // Pick a color not yet used
      const { data: existingGroups } = await supabase
        .from("groups")
        .select("color")
        .eq("session_id", session.id);

      const usedColors = new Set(existingGroups?.map((g) => g.color) ?? []);
      const color = GROUP_COLORS.find((c) => !usedColors.has(c)) ?? GROUP_COLORS[0];

      const { data: newGroup, error: groupError } = await supabase
        .from("groups")
        .insert({
          session_id: session.id,
          name: trimmedName,
          role: "unassigned",
          device_id: deviceId!,
          color,
        })
        .select()
        .single();

      if (groupError || !newGroup) {
        Alert.alert("Fehler", "Konnte der Gruppe nicht beitreten.");
        setLoading(false);
        return;
      }
      myGroup = newGroup as Group;
    }

    // Load POIs for this scenario
    const { data: pois } = await supabase
      .from("pois")
      .select("*")
      .eq("scenario_id", session.scenario_id);

    setSession(session);
    setMyGroup(myGroup);
    setPois((pois as POI[]) ?? []);

    setLoading(false);

    if (session.status === "active") {
      router.replace("/(game)/map");
    } else {
      router.replace("/(game)/lobby");
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Spiel beitreten</Text>

      <Text style={styles.label}>JOIN-CODE</Text>
      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        placeholder="ABCD12"
        placeholderTextColor="#444"
        maxLength={6}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>GRUPPENNAME</Text>
      <TextInput
        style={styles.input}
        value={groupName}
        onChangeText={setGroupName}
        placeholder="z. B. Die Wölfe"
        placeholderTextColor="#444"
        maxLength={30}
      />

      <TouchableOpacity style={styles.button} onPress={join} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Beitreten →</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
    padding: 24,
    justifyContent: "center",
  },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 40 },
  label: { color: "#8888aa", fontSize: 12, letterSpacing: 2, marginBottom: 10 },
  codeInput: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 20,
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 28,
  },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 18,
    color: "#fff",
    fontSize: 18,
    marginBottom: 28,
  },
  button: {
    backgroundColor: "#3498DB",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 20, fontWeight: "800" },
});

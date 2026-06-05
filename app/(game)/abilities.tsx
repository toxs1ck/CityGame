import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { MAX_NORMAL_ABILITIES, MAX_ULTIMATE_ABILITIES } from "../../constants/game";
import type { AbilityDefinition } from "../../types/game";

export default function AbilitySelectionScreen() {
  const { session } = useGameStore();
  const { myGroup, setMyAbilities } = usePlayerStore();
  const [abilities, setAbilities] = useState<AbilityDefinition[]>([]);
  const [selectedNormal, setSelectedNormal] = useState<string[]>([]);
  const [selectedUltimate, setSelectedUltimate] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAbilities();
  }, [session?.id, myGroup?.role]);

  async function fetchAbilities() {
    if (!session || !myGroup) return;
    setLoading(true);

    const role = myGroup.role;
    const { data } = await supabase
      .from("ability_definitions")
      .select("*")
      .or(`scenario_id.is.null,scenario_id.eq.${session.scenario_id}`)
      .or(`for_role.eq.${role},for_role.eq.both`)
      .order("tier")
      .order("name");

    if (data) setAbilities(data as AbilityDefinition[]);
    setLoading(false);
  }

  function toggleAbility(ability: AbilityDefinition) {
    if (ability.tier === "normal") {
      setSelectedNormal((prev) => {
        if (prev.includes(ability.id)) return prev.filter((id) => id !== ability.id);
        if (prev.length >= MAX_NORMAL_ABILITIES) {
          Alert.alert("Limit", `Maximal ${MAX_NORMAL_ABILITIES} normale Fähigkeiten.`);
          return prev;
        }
        return [...prev, ability.id];
      });
    } else {
      setSelectedUltimate((prev) => {
        if (prev.includes(ability.id)) return prev.filter((id) => id !== ability.id);
        if (prev.length >= MAX_ULTIMATE_ABILITIES) {
          Alert.alert("Limit", `Maximal ${MAX_ULTIMATE_ABILITIES} Ultimate-Fähigkeit.`);
          return prev;
        }
        return [...prev, ability.id];
      });
    }
  }

  async function confirm() {
    if (selectedNormal.length < MAX_NORMAL_ABILITIES) {
      Alert.alert("Auswahl unvollständig", `Bitte ${MAX_NORMAL_ABILITIES} normale Fähigkeiten wählen.`);
      return;
    }
    if (selectedUltimate.length < MAX_ULTIMATE_ABILITIES) {
      Alert.alert("Auswahl unvollständig", "Bitte 1 Ultimate-Fähigkeit wählen.");
      return;
    }
    if (!session || !myGroup) return;

    setSaving(true);
    const allSelected = [...selectedNormal, ...selectedUltimate];
    const rows = allSelected.map((abilityId) => ({
      group_id: myGroup.id,
      session_id: session.id,
      ability_id: abilityId,
    }));

    const { data, error } = await supabase
      .from("group_abilities")
      .insert(rows)
      .select("*, ability:ability_definitions(*)");

    setSaving(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    if (data) setMyAbilities(data as any);

    const settings = session.settings;
    if ((settings.starting_mode ?? "headstart") === "starting_points") {
      router.replace("/(game)/starting-point");
    } else {
      router.replace("/(game)/map");
    }
  }

  const normalAbilities = abilities.filter((a) => a.tier === "normal");
  const ultimateAbilities = abilities.filter((a) => a.tier === "ultimate");

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Fähigkeiten wählen</Text>
        <Text style={styles.sub}>
          {myGroup?.role === "fugitive" ? "🏃 Flüchtig" : "🔍 Detektiv"}
        </Text>
      </View>

      <View style={styles.progress}>
        <Text style={styles.progressText}>
          Normal: {selectedNormal.length}/{MAX_NORMAL_ABILITIES}
        </Text>
        <Text style={styles.progressText}>
          Ultimate: {selectedUltimate.length}/{MAX_ULTIMATE_ABILITIES}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Normale Fähigkeiten (Abklingzeit)</Text>
      <FlatList
        data={normalAbilities}
        keyExtractor={(a) => a.id}
        horizontal={false}
        renderItem={({ item }) => {
          const isSelected = selectedNormal.includes(item.id);
          return (
            <TouchableOpacity
              style={[styles.card, isSelected && styles.cardSelected]}
              onPress={() => toggleAbility(item)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.abilityName}>{item.name}</Text>
                <Text style={styles.cooldown}>
                  ⏱ {Math.round((item.cooldown_seconds ?? 0) / 60)} min
                </Text>
              </View>
              <Text style={styles.abilityDesc}>{item.description}</Text>
              {item.duration_seconds && (
                <Text style={styles.duration}>Dauer: {item.duration_seconds / 60} min</Text>
              )}
            </TouchableOpacity>
          );
        }}
        scrollEnabled={false}
        style={styles.list}
      />

      <Text style={styles.sectionTitle}>Ultimate (Aktionspunkte)</Text>
      <FlatList
        data={ultimateAbilities}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => {
          const isSelected = selectedUltimate.includes(item.id);
          return (
            <TouchableOpacity
              style={[styles.card, styles.ultimateCard, isSelected && styles.ultimateSelected]}
              onPress={() => toggleAbility(item)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.abilityName}>{item.name}</Text>
                <Text style={styles.apCost}>⚡ {item.ap_cost} AP</Text>
              </View>
              <Text style={styles.abilityDesc}>{item.description}</Text>
              {item.duration_seconds && (
                <Text style={styles.duration}>Dauer: {item.duration_seconds / 60} min</Text>
              )}
            </TouchableOpacity>
          );
        }}
        scrollEnabled={false}
        style={styles.list}
      />

      <TouchableOpacity
        style={[
          styles.confirmButton,
          (selectedNormal.length < MAX_NORMAL_ABILITIES || selectedUltimate.length < MAX_ULTIMATE_ABILITIES) && styles.confirmDisabled,
        ]}
        onPress={confirm}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Auswahl bestätigen →</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  header: { padding: 24, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff" },
  sub: { color: "#8888aa", marginTop: 4, fontSize: 15 },
  progress: { flexDirection: "row", justifyContent: "space-around", padding: 12, backgroundColor: "#1a1a3e", marginHorizontal: 16, borderRadius: 12, marginBottom: 16 },
  progressText: { color: "#fff", fontWeight: "600" },
  sectionTitle: { color: "#8888aa", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", paddingHorizontal: 16, marginBottom: 8, marginTop: 8 },
  list: { paddingHorizontal: 16 },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardSelected: { borderColor: "#3498DB" },
  ultimateCard: { backgroundColor: "#1a0a2e" },
  ultimateSelected: { borderColor: "#9B59B6" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  abilityName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cooldown: { color: "#8888aa", fontSize: 13 },
  apCost: { color: "#F39C12", fontSize: 13, fontWeight: "700" },
  abilityDesc: { color: "#aaaacc", fontSize: 13, lineHeight: 18 },
  duration: { color: "#9B59B6", fontSize: 12, marginTop: 4 },
  confirmButton: {
    margin: 16,
    backgroundColor: "#2ECC71",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  confirmDisabled: { backgroundColor: "#1a3a1a" },
  confirmText: { color: "#fff", fontSize: 18, fontWeight: "800" },
});

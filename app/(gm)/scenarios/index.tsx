import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Switch,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import type { Scenario } from "../../../types/game";

export default function ScenariosScreen() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScenarios();
  }, []);

  async function fetchScenarios() {
    setLoading(true);
    const { data, error } = await supabase
      .from("scenarios")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setScenarios(data as Scenario[]);
    setLoading(false);
  }

  async function togglePublic(scenario: Scenario) {
    await supabase
      .from("scenarios")
      .update({ is_public: !scenario.is_public })
      .eq("id", scenario.id);
    fetchScenarios();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={scenarios}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/(gm)/scenarios/${item.id}`)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <View style={styles.publicRow}>
                <Text style={styles.publicLabel}>Öffentlich</Text>
                <Switch
                  value={item.is_public}
                  onValueChange={() => togglePublic(item)}
                  trackColor={{ true: "#2ECC71" }}
                />
              </View>
            </View>
            {item.description ? (
              <Text style={styles.cardSub}>{item.description}</Text>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Noch keine Szenarien. Erstelle das erste!</Text>
        }
      />
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/(gm)/scenarios/new")}
      >
        <Text style={styles.fabText}>+ Neu</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  list: { padding: 16, paddingBottom: 100 },
  card: { backgroundColor: "#1a1a3e", borderRadius: 16, padding: 20, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#fff", flex: 1 },
  cardSub: { fontSize: 13, color: "#8888aa", marginTop: 8 },
  publicRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  publicLabel: { fontSize: 12, color: "#8888aa" },
  empty: { color: "#8888aa", textAlign: "center", marginTop: 64, fontSize: 16 },
  fab: {
    position: "absolute",
    bottom: 32,
    right: 24,
    backgroundColor: "#3498DB",
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});

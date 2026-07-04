import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import type { Group } from "../../types/game";

interface GroupResult {
  group: Group;
  tasksCompleted: number;
}

export default function GameOverScreen() {
  const insets = useSafeAreaInsets();
  const { session, groups, reset: resetGame } = useGameStore();
  const { myGroup, reset: resetPlayer } = usePlayerStore();
  const [results, setResults] = useState<GroupResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResults();
  }, []);

  async function loadResults() {
    if (!session) { setLoading(false); return; }

    const [{ data: completions }, { data: latestGroups }] = await Promise.all([
      supabase
        .from("group_assigned_tasks")
        .select("group_id")
        .eq("session_id", session.id)
        .eq("status", "completed"),
      supabase
        .from("groups")
        .select("*")
        .eq("session_id", session.id),
    ]);

    const countMap = new Map<string, number>();
    completions?.forEach((c) => {
      countMap.set(c.group_id, (countMap.get(c.group_id) ?? 0) + 1);
    });

    const all = (latestGroups ?? groups) as Group[];
    const sorted: GroupResult[] = all
      .map((g) => ({ group: g, tasksCompleted: countMap.get(g.id) ?? 0 }))
      .sort((a, b) => b.group.action_points - a.group.action_points);

    setResults(sorted);
    setLoading(false);
  }

  function goHome() {
    resetGame();
    resetPlayer();
    router.replace("/");
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#F39C12" size="large" />
      </View>
    );
  }

  const winner = results[0];
  const catchInfo = (session?.settings as any)?.catch_info as
    | { caught_by_name: string; fugitive_name: string; distance_m: number }
    | undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.trophy}>{catchInfo ? "🎯" : "🏆"}</Text>
      <Text style={styles.title}>
        {catchInfo ? "Flüchtig gefangen!" : "Spiel beendet!"}
      </Text>

      {catchInfo && (
        <View style={styles.catchCard}>
          <Text style={styles.catchText}>
            {catchInfo.caught_by_name} hat {catchInfo.fugitive_name} gefangen
          </Text>
          <Text style={styles.catchDist}>
            auf {catchInfo.distance_m} m Entfernung
          </Text>
        </View>
      )}

      {winner && (
        <View style={[styles.winnerCard, { borderColor: winner.group.color }]}>
          <Text style={styles.winnerLabel}>Sieger</Text>
          <Text style={styles.winnerName}>{winner.group.name}</Text>
          <Text style={styles.winnerRole}>
            {winner.group.role === "fugitive" ? "🏃 Flüchtig" : "🔍 Detektiv"}
          </Text>
          <Text style={styles.winnerAP}>⚡ {winner.group.action_points} AP</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Rangliste</Text>

      <FlatList
        data={results}
        keyExtractor={(r) => r.group.id}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.resultRow,
              item.group.id === myGroup?.id && styles.myRow,
            ]}
          >
            <Text style={styles.rank}>#{index + 1}</Text>
            <View
              style={[styles.colorDot, { backgroundColor: item.group.color }]}
            />
            <View style={styles.resultInfo}>
              <Text style={styles.groupName}>
                {item.group.name}
                {item.group.id === myGroup?.id ? " (du)" : ""}
              </Text>
              <Text style={styles.groupMeta}>
                {item.group.role === "fugitive" ? "🏃" : "🔍"}
                {" · "}
                {item.tasksCompleted} Aufgaben erledigt
              </Text>
            </View>
            <Text style={styles.apValue}>⚡ {item.group.action_points}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Keine Ergebnisse verfügbar.</Text>
        }
      />

      <TouchableOpacity style={styles.homeButton} onPress={goHome}>
        <Text style={styles.homeButtonText}>🏠 Zurück zur Startseite</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23", paddingHorizontal: 24 },
  center: {
    flex: 1,
    backgroundColor: "#0f0f23",
    justifyContent: "center",
    alignItems: "center",
  },
  trophy: { fontSize: 64, textAlign: "center", marginTop: 24 },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  catchCard: {
    backgroundColor: "#2a0a0a",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E74C3C",
    marginBottom: 20,
  },
  catchText: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  catchDist: { color: "#E74C3C", fontSize: 13, marginTop: 4 },
  winnerCard: {
    backgroundColor: "#1a1a3e",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    borderWidth: 3,
    marginBottom: 24,
  },
  winnerLabel: {
    color: "#8888aa",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  winnerName: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 4 },
  winnerRole: { color: "#8888aa", fontSize: 14, marginTop: 2 },
  winnerAP: { color: "#F39C12", fontSize: 20, fontWeight: "700", marginTop: 8 },
  sectionTitle: {
    color: "#8888aa",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  list: { flex: 1 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  myRow: { borderColor: "#3498DB" },
  rank: {
    color: "#8888aa",
    fontSize: 16,
    fontWeight: "700",
    width: 24,
    textAlign: "center",
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  resultInfo: { flex: 1 },
  groupName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  groupMeta: { color: "#8888aa", fontSize: 12, marginTop: 2 },
  apValue: { color: "#F39C12", fontWeight: "800", fontSize: 16 },
  homeButton: {
    backgroundColor: "#3498DB",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  homeButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  empty: { color: "#8888aa", textAlign: "center", marginTop: 48, fontSize: 15 },
});

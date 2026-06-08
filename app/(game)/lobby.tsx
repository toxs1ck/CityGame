import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { useGameSessionSubscription } from "../../hooks/useGameSession";
import { JoinQRModal } from "../../components/game/JoinQRModal";
import type { Group } from "../../types/game";

export default function LobbyScreen() {
  const { session, setSession, setGroups } = useGameStore();
  const { myGroup, setMyGroup } = usePlayerStore();
  const [groups, setLocalGroups] = useState<Group[]>([]);
  const [qrVisible, setQrVisible] = useState(false);

  useGameSessionSubscription(session?.id ?? null);

  useEffect(() => {
    if (!session) return;
    fetchGroups();

    const channel = supabase
      .channel(`lobby:${session.id}:groups`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${session.id}` },
        () => fetchGroups()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  useEffect(() => {
    // When session transitions to active, move to ability selection or map
    if (session?.status === "active") {
      if (myGroup?.role !== "unassigned") {
        router.replace("/(game)/abilities");
      }
    }
  }, [session?.status, myGroup?.role]);

  // Keep myGroup in sync with DB updates (role assignments)
  useEffect(() => {
    if (!myGroup || !session) return;
    const channel = supabase
      .channel(`group:${myGroup.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "groups", filter: `id=eq.${myGroup.id}` },
        (payload) => {
          const updated = payload.new as Group;
          setMyGroup(updated);
          if (updated.role !== "unassigned" && session.status === "active") {
            router.replace("/(game)/abilities");
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myGroup?.id, session?.id]);

  async function fetchGroups() {
    if (!session) return;
    const { data } = await supabase
      .from("groups")
      .select("*")
      .eq("session_id", session.id)
      .order("joined_at");
    if (data) {
      setLocalGroups(data as Group[]);
      setGroups(data as Group[]);
    }
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <JoinQRModal joinCode={session.join_code} visible={qrVisible} onClose={() => setQrVisible(false)} />
      <View style={styles.header}>
        <Text style={styles.title}>Lobby</Text>
        <TouchableOpacity style={styles.codeBox} onPress={() => setQrVisible(true)}>
          <Text style={styles.codeLabel}>JOIN-CODE</Text>
          <Text style={styles.code}>{session.join_code}</Text>
          <Text style={styles.qrHint}>⬛ QR</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.waiting}>Warte auf den Game Master…</Text>

      <Text style={styles.sectionTitle}>Gruppen ({groups.length})</Text>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.groupCard, { borderLeftColor: item.color }]}>
            <Text style={styles.groupName}>
              {item.name}
              {item.device_id === myGroup?.device_id ? " (du)" : ""}
            </Text>
            <Text style={[styles.roleBadge, item.role !== "unassigned" && styles.roleAssigned]}>
              {item.role === "fugitive" ? "🏃 Flüchtig" : item.role === "seeker" ? "🔍 Detektiv" : "Warte…"}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  header: { padding: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 28, fontWeight: "800", color: "#fff" },
  codeBox: { alignItems: "center", backgroundColor: "#1a1a3e", borderRadius: 16, padding: 14 },
  codeLabel: { color: "#8888aa", fontSize: 10, letterSpacing: 2 },
  code: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: 4 },
  qrHint: { color: "#3498DB", fontSize: 11, marginTop: 4 },
  waiting: { color: "#8888aa", textAlign: "center", marginBottom: 24 },
  sectionTitle: { color: "#8888aa", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", paddingHorizontal: 24, marginBottom: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  groupCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
  },
  groupName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  roleBadge: { color: "#8888aa", fontSize: 13 },
  roleAssigned: { color: "#fff", fontWeight: "700" },
});

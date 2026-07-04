import { useEffect, useRef, useState } from "react";
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
import { JoinQRModal } from "../../components/game/JoinQRModal";
import type { GameSession, Group } from "../../types/game";

export default function LobbyScreen() {
  const insets = useSafeAreaInsets();
  const { session, setSession, setGroups } = useGameStore();
  const { myGroup, setMyGroup } = usePlayerStore();
  const [groups, setLocalGroups] = useState<Group[]>([]);
  const [qrVisible, setQrVisible] = useState(false);
  const navigatingRef = useRef(false);

  // ── Group list: initial fetch + polling every 3 s ────────────────────────
  // Polling ensures the list updates even when Supabase Realtime is not
  // enabled for the `groups` table in the project settings.
  useEffect(() => {
    if (!session?.id) return;

    let cancelled = false;

    async function fetchGroups() {
      if (cancelled) return;
      const { data } = await supabase
        .from("groups")
        .select("*")
        .eq("session_id", session!.id)
        .order("joined_at");
      if (data && !cancelled) {
        setLocalGroups(data as Group[]);
        setGroups(data as Group[]);
      }
    }

    fetchGroups();
    const id = setInterval(fetchGroups, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.id]);

  // ── Real-time bonus: postgres_changes for group list (fast when enabled) ─
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`lobby:${session.id}:groups`)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${session.id}` },
        async () => {
          const { data } = await supabase.from("groups").select("*").eq("session_id", session!.id).order("joined_at");
          if (data) { setLocalGroups(data as Group[]); setGroups(data as Group[]); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  // ── Session status: poll every 2 s + navigate when active ────────────────
  useEffect(() => {
    if (!session?.id || session.status === "active") return;

    let cancelled = false;

    const id = setInterval(async () => {
      if (cancelled || navigatingRef.current) return;

      const { data: sessionData } = await supabase
        .from("game_sessions")
        .select("*")
        .eq("id", session.id)
        .single();
      if (!sessionData || cancelled) return;

      if (sessionData.status === "finished") {
        clearInterval(id);
        router.replace("/(game)/game-over");
        return;
      }

      if (sessionData.status === "active") {
        clearInterval(id);
        setSession(sessionData as GameSession);
        await navigateAfterStart(sessionData as GameSession);
      }
    }, 2000);

    return () => { cancelled = true; clearInterval(id); };
  }, [session?.id, session?.status]);

  // ── Real-time bonus: postgres_changes for session status ─────────────────
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`lobby:${session.id}:session`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${session.id}` },
        async (payload) => {
          const s = payload.new as GameSession;
          setSession(s);
          if (s.status === "finished") { router.replace("/(game)/game-over"); return; }
          if (s.status === "active") { await navigateAfterStart(s); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  async function navigateAfterStart(activeSession: GameSession) {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    if (!myGroup?.id) { router.replace("/(game)/map"); return; }

    // Re-fetch group to get the freshest role (Realtime may not have updated it)
    const { data } = await supabase.from("groups").select("*").eq("id", myGroup.id).single();
    if (data) {
      setMyGroup(data as Group);
      router.replace(data.role !== "unassigned" ? "/(game)/abilities" : "/(game)/map");
    } else {
      router.replace("/(game)/map");
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
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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

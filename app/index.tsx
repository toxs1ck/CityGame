import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import type { GameSession, Group, POI } from "../types/game";

export default function LandingScreen() {
  const { user, profile, authLoaded, deviceId, setMyGroup } = usePlayerStore();
  const { setSession, setPois } = useGameStore();

  const [checkingGame, setCheckingGame] = useState(true);
  const [activeGame, setActiveGame] = useState<{ session: GameSession; group: Group } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    async function checkForActiveGame() {
      const { data: groupRows } = await supabase
        .from("groups")
        .select("*")
        .eq("device_id", deviceId!);

      if (cancelled) return;

      if (!groupRows || groupRows.length === 0) {
        setCheckingGame(false);
        return;
      }

      const sessionIds = (groupRows as Group[]).map((g) => g.session_id);

      const { data: sessionRows } = await supabase
        .from("game_sessions")
        .select("*, scenario:scenarios(*)")
        .in("id", sessionIds)
        .in("status", ["lobby", "active"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (cancelled) return;

      if (sessionRows && sessionRows.length > 0) {
        const session = sessionRows[0] as GameSession;
        const group = (groupRows as Group[]).find((g) => g.session_id === session.id)!;
        setActiveGame({ session, group });
      }

      setCheckingGame(false);
    }

    checkForActiveGame();
    return () => { cancelled = true; };
  }, [deviceId]);

  async function rejoinGame() {
    if (!activeGame) return;
    const { session, group } = activeGame;

    const { data: pois } = await supabase
      .from("pois")
      .select("*")
      .eq("scenario_id", session.scenario_id);

    setSession(session);
    setMyGroup(group);
    setPois((pois as POI[]) ?? []);

    const isHost = session.host_device_id === deviceId;
    if (session.status === "lobby") {
      router.push(isHost ? `/host/${session.id}/controls` : "/(game)/lobby");
    } else {
      router.push("/(game)/map");
    }
  }

  function confirmLeave() {
    Alert.alert(
      "Spiel verlassen?",
      "Du verlässt das Spiel dauerhaft. Wenn alle Spieler das Spiel verlassen, wird es abgebrochen.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Verlassen", style: "destructive", onPress: doLeaveGame },
      ]
    );
  }

  async function doLeaveGame() {
    if (!activeGame) return;
    setLeaving(true);
    const { session, group } = activeGame;

    await supabase.from("groups").delete().eq("id", group.id);

    const { data: remaining } = await supabase
      .from("groups")
      .select("id")
      .eq("session_id", session.id);

    if (!remaining || remaining.length === 0) {
      await supabase
        .from("game_sessions")
        .update({ status: "aborted", finished_at: new Date().toISOString() })
        .eq("id", session.id);
    }

    setActiveGame(null);
    setLeaving(false);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  const displayName = profile?.username ?? user?.email ?? "";

  if (!authLoaded || checkingGame) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color="#3498DB" size="large" />
      </SafeAreaView>
    );
  }

  // ── Player is in an active/lobby game ───────────────────────────────────────
  if (activeGame) {
    const isHost = activeGame.session.host_device_id === deviceId;
    const scenarioName = (activeGame.session as any).scenario?.name ?? "Spiel";
    const statusLabel = activeGame.session.status === "active" ? "🟢 Aktiv" : "🟡 Lobby";

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.title}>CityGame</Text>
          <Text style={styles.subtitle}>Das Stadtdetektiv-Spiel</Text>
        </View>

        <View style={styles.buttons}>
          <View style={styles.activeCard}>
            <Text style={styles.activeCardLabel}>Du bist noch in einem Spiel</Text>
            <View style={styles.activeCardRow}>
              <Text style={styles.activeCardStatus}>{statusLabel}</Text>
              <Text style={styles.activeCardScenario}>{scenarioName}</Text>
            </View>
            <Text style={styles.activeCardGroup}>Gruppe: {activeGame.group.name}</Text>
            {isHost && <Text style={styles.activeCardHost}>Du bist der Host</Text>}
          </View>

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={rejoinGame}
          >
            <Text style={styles.buttonText}>▶ Zurück zum Spiel</Text>
            <Text style={styles.buttonSub}>Wiederbeitreten</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.leaveButton]}
            onPress={confirmLeave}
            disabled={leaving}
          >
            {leaving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.buttonText}>🚪 Spiel verlassen</Text>
                <Text style={styles.buttonSub}>Gruppe dauerhaft entfernen</Text>
              </>
            )}
          </TouchableOpacity>

          {user && (
            <View style={styles.accountRow}>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
                {profile?.is_gm && <Text style={styles.accountRole}>Game Master</Text>}
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
                <Text style={styles.logoutText}>Abmelden</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── Normal landing ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>CityGame</Text>
        <Text style={styles.subtitle}>Das Stadtdetektiv-Spiel</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => router.push("/(game)/join")}
        >
          <Text style={styles.buttonText}>🎮 Spiel beitreten</Text>
          <Text style={styles.buttonSub}>Mit Join-Code oder QR beitreten</Text>
        </TouchableOpacity>

        {!user && (
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => router.push("/auth/login")}
          >
            <Text style={styles.buttonText}>🔑 Anmelden / Registrieren</Text>
            <Text style={styles.buttonSub}>Zum Hosten von Spielen</Text>
          </TouchableOpacity>
        )}

        {user && (
          <>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => router.push("/host/setup")}
            >
              <Text style={styles.buttonText}>🏠 Spiel hosten</Text>
              <Text style={styles.buttonSub}>Öffentliche Szenarien auswählen</Text>
            </TouchableOpacity>

            {profile?.is_gm && (
              <TouchableOpacity
                style={[styles.button, styles.gmButton]}
                onPress={() => router.push("/(gm)")}
              >
                <Text style={styles.buttonText}>🎓 Game Master</Text>
                <Text style={styles.buttonSub}>Szenarien & Sessions verwalten</Text>
              </TouchableOpacity>
            )}

            <View style={styles.accountRow}>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
                {profile?.is_gm && <Text style={styles.accountRole}>Game Master</Text>}
              </View>
              <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
                <Text style={styles.logoutText}>Abmelden</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  center: { justifyContent: "center", alignItems: "center" },
  hero: { alignItems: "center", marginTop: 48 },
  title: { fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: 2 },
  subtitle: { fontSize: 16, color: "#8888aa", marginTop: 8 },
  buttons: { gap: 12 },
  button: { borderRadius: 16, padding: 20, alignItems: "center" },
  primaryButton: { backgroundColor: "#3498DB" },
  secondaryButton: { backgroundColor: "#2ECC71" },
  gmButton: { backgroundColor: "#9B59B6" },
  leaveButton: { backgroundColor: "#E74C3C" },
  buttonText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  buttonSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 },
  activeCard: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: "#3498DB",
    gap: 6,
  },
  activeCardLabel: {
    color: "#8888aa",
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  activeCardRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  activeCardStatus: { color: "#fff", fontWeight: "800", fontSize: 16 },
  activeCardScenario: { color: "#aaaacc", fontSize: 14 },
  activeCardGroup: { color: "#fff", fontSize: 15, fontWeight: "600" },
  activeCardHost: { color: "#F39C12", fontSize: 13, fontWeight: "600" },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  accountInfo: { flex: 1 },
  accountName: { color: "#fff", fontWeight: "700", fontSize: 15 },
  accountRole: { color: "#9B59B6", fontSize: 12, marginTop: 2 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: "#E74C3C", fontWeight: "600" },
});

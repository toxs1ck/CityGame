import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import type { GameSession, Group, POI } from "../types/game";

type AuthMode = "login" | "signup" | "forgot";

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LandingScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, authLoaded, deviceId, setMyGroup } = usePlayerStore();
  const { setSession, setPois } = useGameStore();

  // Active-game detection
  const [checkingGame, setCheckingGame] = useState(true);
  const [activeGame, setActiveGame] = useState<{ session: GameSession; group: Group } | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Auth form state
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── Active-game check ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;

    async function check() {
      const { data: groupRows } = await supabase
        .from("groups")
        .select("*")
        .eq("device_id", deviceId!);

      if (cancelled || !groupRows || groupRows.length === 0) {
        if (!cancelled) setCheckingGame(false);
        return;
      }

      const ids = (groupRows as Group[]).map((g) => g.session_id);
      const { data: sessionRows } = await supabase
        .from("game_sessions")
        .select("*, scenario:scenarios(*)")
        .in("id", ids)
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

    check();
    return () => { cancelled = true; };
  }, [deviceId]);

  // ── Rejoin / leave ──────────────────────────────────────────────────────────
  async function rejoinGame() {
    if (!activeGame) return;
    const { session, group } = activeGame;
    const { data: pois } = await supabase.from("pois").select("*").eq("scenario_id", session.scenario_id);
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
      "Du verlässt das Spiel dauerhaft. Wenn alle Spieler gehen, wird das Spiel abgebrochen.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Verlassen", style: "destructive", onPress: doLeave },
      ]
    );
  }

  async function doLeave() {
    if (!activeGame) return;
    setLeaving(true);
    const { session, group } = activeGame;
    await supabase.from("groups").delete().eq("id", group.id);
    const { data: remaining } = await supabase.from("groups").select("id").eq("session_id", session.id);
    if (!remaining || remaining.length === 0) {
      if (session.status === "lobby") {
        await supabase.from("game_sessions").delete().eq("id", session.id);
      } else {
        await supabase.from("game_sessions").update({ status: "aborted", finished_at: new Date().toISOString() }).eq("id", session.id);
      }
    }
    setActiveGame(null);
    setLeaving(false);
  }

  // ── Email auth ──────────────────────────────────────────────────────────────
  async function login() {
    if (!email.trim() || !password) { Alert.alert("Fehler", "Bitte E-Mail und Passwort eingeben."); return; }
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setAuthLoading(false);
    if (error) { Alert.alert("Fehler", error.message); }
  }

  async function signup() {
    if (!username.trim() || !email.trim() || !password) { Alert.alert("Fehler", "Bitte alle Felder ausfüllen."); return; }
    if (password.length < 6) { Alert.alert("Fehler", "Das Passwort muss mindestens 6 Zeichen haben."); return; }
    if (password !== confirmPassword) { Alert.alert("Fehler", "Die Passwörter stimmen nicht überein."); return; }
    setAuthLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { username: username.trim() } },
    });
    if (signUpError) { setAuthLoading(false); Alert.alert("Fehler", signUpError.message); return; }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setAuthLoading(false);
    if (loginError) { Alert.alert("Konto erstellt", "Bitte jetzt einloggen."); setMode("login"); }
  }

  async function sendPasswordReset() {
    if (!email.trim()) { Alert.alert("Fehler", "Bitte E-Mail-Adresse eingeben."); return; }
    setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    setAuthLoading(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    Alert.alert("E-Mail versendet", "Prüfe dein Postfach für den Zurücksetzen-Link.");
    setMode("login");
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  const displayName = profile?.username ?? user?.email ?? "";

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (!authLoaded || checkingGame) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  // ── Rejoin screen ───────────────────────────────────────────────────────────
  if (activeGame) {
    const isHost = activeGame.session.host_device_id === deviceId;
    const scenarioName = (activeGame.session as any).scenario?.name ?? "Spiel";
    const statusLabel = activeGame.session.status === "active" ? "🟢 Aktiv" : "🟡 Lobby";
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.hero}>
          <Text style={styles.bigTitle}>CityGame</Text>
          <Text style={styles.heroSub}>Das Stadtdetektiv-Spiel</Text>
        </View>
        <View style={styles.section}>
          <View style={styles.activeCard}>
            <Text style={styles.activeCardLabel}>Du bist noch in einem Spiel</Text>
            <View style={styles.activeCardRow}>
              <Text style={styles.activeCardStatus}>{statusLabel}</Text>
              <Text style={styles.activeCardScenario}>{scenarioName}</Text>
            </View>
            <Text style={styles.activeCardGroup}>Gruppe: {activeGame.group.name}</Text>
            {isHost && <Text style={styles.activeCardHost}>Du bist der Host</Text>}
          </View>

          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={rejoinGame}>
            <Text style={styles.btnText}>▶ Zurück zum Spiel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={confirmLeave} disabled={leaving}>
            {leaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>🚪 Spiel verlassen</Text>}
          </TouchableOpacity>

          {user && (
            <View style={styles.accountRow}>
              <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
              <TouchableOpacity onPress={logout}><Text style={styles.logoutText}>Abmelden</Text></TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  }

  // ── Home screen (logged-in) ─────────────────────────────────────────────────
  if (user) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.hero}>
          <Text style={styles.bigTitle}>CityGame</Text>
          <Text style={styles.heroSub}>Das Stadtdetektiv-Spiel</Text>
        </View>
        <View style={styles.section}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => router.push("/(game)/join")}>
            <Text style={styles.btnText}>🎮 Spiel beitreten</Text>
            <Text style={styles.btnSub}>Mit Join-Code oder QR beitreten</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={() => router.push("/host/setup")}>
            <Text style={styles.btnText}>🏠 Spiel hosten</Text>
            <Text style={styles.btnSub}>Öffentliche Szenarien auswählen</Text>
          </TouchableOpacity>
          {profile?.is_gm && (
            <TouchableOpacity style={[styles.btn, styles.btnPurple]} onPress={() => router.push("/(gm)")}>
              <Text style={styles.btnText}>🎓 Game Master</Text>
              <Text style={styles.btnSub}>Szenarien & Sessions verwalten</Text>
            </TouchableOpacity>
          )}
          <View style={styles.accountRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName} numberOfLines={1}>{displayName}</Text>
              {profile?.is_gm && <Text style={styles.accountRole}>Game Master</Text>}
            </View>
            <TouchableOpacity onPress={logout}><Text style={styles.logoutText}>Abmelden</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Auth screen (not logged in) ─────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={styles.hero}>
            <Text style={styles.bigTitle}>CityGame</Text>
            <Text style={styles.heroSub}>Das Stadtdetektiv-Spiel</Text>
          </View>

          {/* Tabs — hidden in forgot-password mode */}
          {mode !== "forgot" && (
            <View style={styles.tabs}>
              <TouchableOpacity
                style={[styles.tab, mode === "login" && styles.tabActive]}
                onPress={() => setMode("login")}
              >
                <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Anmelden</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === "signup" && styles.tabActive]}
                onPress={() => setMode("signup")}
              >
                <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Registrieren</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Forgot password mode */}
          {mode === "forgot" && (
            <>
              <Text style={styles.forgotTitle}>Passwort zurücksetzen</Text>
              <Text style={styles.forgotSub}>Wir senden dir einen Link per E-Mail.</Text>
              <TextInput
                style={styles.input}
                placeholder="E-Mail"
                placeholderTextColor="#555"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, authLoading && styles.btnDisabled]}
                onPress={sendPasswordReset}
                disabled={authLoading}
              >
                {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Link senden</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkRow} onPress={() => setMode("login")}>
                <Text style={styles.link}>← Zurück zum Anmelden</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Login mode */}
          {mode === "login" && (
            <>
              <TextInput
                style={styles.input}
                placeholder="E-Mail"
                placeholderTextColor="#555"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                placeholder="Passwort"
                placeholderTextColor="#555"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TouchableOpacity style={styles.linkRow} onPress={() => setMode("forgot")}>
                <Text style={styles.link}>Passwort vergessen?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, authLoading && styles.btnDisabled]}
                onPress={login}
                disabled={authLoading}
              >
                {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Anmelden</Text>}
              </TouchableOpacity>
            </>
          )}

          {/* Signup mode */}
          {mode === "signup" && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Benutzername"
                placeholderTextColor="#555"
                value={username}
                onChangeText={setUsername}
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                placeholder="E-Mail"
                placeholderTextColor="#555"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                placeholder="Passwort"
                placeholderTextColor="#555"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                placeholder="Passwort wiederholen"
                placeholderTextColor="#555"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, authLoading && styles.btnDisabled]}
                onPress={signup}
                disabled={authLoading}
              >
                {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Konto erstellen</Text>}
              </TouchableOpacity>
            </>
          )}

          <View style={styles.guestSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Guest button — pinned to bottom */}
      <View style={[styles.guestBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.guestBtn} onPress={() => router.push("/(game)/join")}>
          <Text style={styles.guestBtnText}>Als Gast spielen →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { justifyContent: "center", alignItems: "center" },

  // Logo / hero
  hero: { alignItems: "center", paddingTop: 48, paddingBottom: 32 },
  bigTitle: { fontSize: 44, fontWeight: "900", color: "#fff", letterSpacing: 2 },
  heroSub: { fontSize: 15, color: "#8888aa", marginTop: 6 },

  // Home & rejoin sections
  section: { flex: 1, paddingHorizontal: 24, gap: 12, justifyContent: "flex-end", paddingBottom: 32 },

  // Buttons (shared)
  btn: { borderRadius: 14, padding: 18, alignItems: "center" },
  btnPrimary: { backgroundColor: "#3498DB" },
  btnGreen: { backgroundColor: "#2ECC71" },
  btnPurple: { backgroundColor: "#9B59B6" },
  btnDanger: { backgroundColor: "#E74C3C" },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  btnSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 4 },

  // Active game card
  activeCard: { backgroundColor: "#1a1a3e", borderRadius: 16, padding: 20, borderWidth: 2, borderColor: "#3498DB", gap: 6 },
  activeCardLabel: { color: "#8888aa", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  activeCardRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  activeCardStatus: { color: "#fff", fontWeight: "800", fontSize: 16 },
  activeCardScenario: { color: "#aaaacc", fontSize: 14 },
  activeCardGroup: { color: "#fff", fontSize: 15, fontWeight: "600" },
  activeCardHost: { color: "#F39C12", fontSize: 13, fontWeight: "600" },

  // Account row
  accountRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#1a1a3e", borderRadius: 14, padding: 14, gap: 12 },
  accountName: { color: "#fff", fontWeight: "700", fontSize: 15 },
  accountRole: { color: "#9B59B6", fontSize: 12, marginTop: 2 },
  logoutText: { color: "#E74C3C", fontWeight: "600" },

  // Auth scroll
  authScroll: { paddingHorizontal: 24, paddingBottom: 16 },

  // Tabs
  tabs: { flexDirection: "row", backgroundColor: "#1a1a3e", borderRadius: 14, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: "#3498DB" },
  tabText: { color: "#8888aa", fontWeight: "600", fontSize: 15 },
  tabTextActive: { color: "#fff" },

  // Inputs
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 12,
  },

  // Forgot password
  forgotTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 6 },
  forgotSub: { color: "#8888aa", fontSize: 14, marginBottom: 24 },

  // Links
  linkRow: { alignItems: "flex-end", marginBottom: 16, marginTop: -4 },
  link: { color: "#3498DB", fontSize: 14, fontWeight: "600" },

  // Guest bar (pinned to bottom)
  guestSpacer: { height: 16 },
  guestBar: {
    borderTopWidth: 1,
    borderTopColor: "#1a1a3e",
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: "#0f0f23",
  },
  guestBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a4e",
  },
  guestBtnText: { color: "#8888aa", fontSize: 16, fontWeight: "600" },
});

import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";

export default function LandingScreen() {
  const { user, profile, authLoaded } = usePlayerStore();

  async function logout() {
    await supabase.auth.signOut();
  }

  const displayName = profile?.username ?? user?.email ?? "";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>CityGame</Text>
        <Text style={styles.subtitle}>Das Stadtdetektiv-Spiel</Text>
      </View>

      <View style={styles.buttons}>
        {/* Always visible — guests and logged-in users */}
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => router.push("/(game)/join")}
        >
          <Text style={styles.buttonText}>🎮 Spiel beitreten</Text>
          <Text style={styles.buttonSub}>Mit Join-Code oder QR beitreten</Text>
        </TouchableOpacity>

        {/* Logged-out state */}
        {authLoaded && !user && (
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={() => router.push("/auth/login")}
          >
            <Text style={styles.buttonText}>🔑 Anmelden / Registrieren</Text>
            <Text style={styles.buttonSub}>Zum Hosten von Spielen</Text>
          </TouchableOpacity>
        )}

        {/* Logged-in state */}
        {authLoaded && user && (
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
                {profile?.is_gm && (
                  <Text style={styles.accountRole}>Game Master</Text>
                )}
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
  hero: { alignItems: "center", marginTop: 48 },
  title: { fontSize: 48, fontWeight: "900", color: "#fff", letterSpacing: 2 },
  subtitle: { fontSize: 16, color: "#8888aa", marginTop: 8 },
  buttons: { gap: 12 },
  button: { borderRadius: 16, padding: 20, alignItems: "center" },
  primaryButton: { backgroundColor: "#3498DB" },
  secondaryButton: { backgroundColor: "#2ECC71" },
  gmButton: { backgroundColor: "#9B59B6" },
  buttonText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  buttonSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 },
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

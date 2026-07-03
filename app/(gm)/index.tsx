import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";

export default function GMDashboard() {
  const { user, profile } = usePlayerStore();

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Game Master</Text>
      <Text style={styles.sub}>{profile?.username ?? user?.email}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Szenarien</Text>
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push("/(gm)/scenarios")}
        >
          <Text style={styles.cardTitle}>📋 Szenarien verwalten</Text>
          <Text style={styles.cardSub}>POIs, Aufgaben und Startpunkte erstellen</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Spiel</Text>
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push("/(gm)/session/setup")}
        >
          <Text style={styles.cardTitle}>🚀 Neues Spiel starten</Text>
          <Text style={styles.cardSub}>Szenario auswählen und konfigurieren</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Abmelden</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24 },
  heading: { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 4 },
  sub: { fontSize: 14, color: "#8888aa", marginBottom: 32 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    color: "#8888aa",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: { backgroundColor: "#1a1a3e", borderRadius: 16, padding: 20, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  cardSub: { fontSize: 13, color: "#8888aa", marginTop: 4 },
  logoutButton: { marginTop: 32, padding: 16, alignItems: "center" },
  logoutText: { color: "#E74C3C", fontSize: 16 },
});

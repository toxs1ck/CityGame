import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function GMDashboard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function login() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert("Fehler", error.message);
    setLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Game Master Login</Text>
        <TextInput
          style={styles.input}
          placeholder="E-Mail"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Passwort"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={login} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Einloggen</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Willkommen, GM</Text>
      <Text style={styles.sub}>{user.email}</Text>

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
        <Text style={styles.logoutText}>Ausloggen</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24 },
  heading: { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 4 },
  sub: { fontSize: 14, color: "#8888aa", marginBottom: 32 },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    padding: 16,
    color: "#fff",
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#3498DB",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, color: "#8888aa", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#fff" },
  cardSub: { fontSize: 13, color: "#8888aa", marginTop: 4 },
  logoutButton: { marginTop: 32, padding: 16, alignItems: "center" },
  logoutText: { color: "#E74C3C", fontSize: 16 },
});

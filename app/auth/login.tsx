import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";

type Tab = "login" | "register";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  function afterAuth() {
    if (from === "gm") router.replace("/(gm)");
    else if (from === "host") router.replace("/host/setup");
    else router.replace("/");
  }

  async function login() {
    if (!email.trim() || !password) {
      Alert.alert("Fehler", "Bitte E-Mail und Passwort eingeben.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    afterAuth();
  }

  async function register() {
    if (!username.trim() || !email.trim() || !password) {
      Alert.alert("Fehler", "Bitte alle Felder ausfüllen.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Fehler", "Das Passwort muss mindestens 6 Zeichen haben.");
      return;
    }
    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { username: username.trim() } },
    });
    if (signUpError) {
      setLoading(false);
      Alert.alert("Fehler", signUpError.message);
      return;
    }
    // Sign in immediately after signup
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (loginError) {
      Alert.alert("Konto erstellt", "Bitte jetzt einloggen.");
      setTab("login");
      return;
    }
    afterAuth();
  }

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>CityGame</Text>
          <Text style={styles.subtitle}>Anmelden oder Konto erstellen</Text>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === "login" && styles.activeTab]}
              onPress={() => setTab("login")}
            >
              <Text style={[styles.tabText, tab === "login" && styles.activeTabText]}>
                Anmelden
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === "register" && styles.activeTab]}
              onPress={() => setTab("register")}
            >
              <Text style={[styles.tabText, tab === "register" && styles.activeTabText]}>
                Registrieren
              </Text>
            </TouchableOpacity>
          </View>

          {tab === "register" && (
            <TextInput
              style={styles.input}
              placeholder="Benutzername"
              placeholderTextColor="#555"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

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

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={tab === "login" ? login : register}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>
                {tab === "login" ? "Einloggen" : "Konto erstellen"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>Zurück</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0f0f23" },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 42,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 2,
    textAlign: "center",
  },
  subtitle: {
    color: "#8888aa",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 40,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  activeTab: { backgroundColor: "#3498DB" },
  tabText: { color: "#8888aa", fontWeight: "600", fontSize: 15 },
  activeTabText: { color: "#fff" },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: "#3498DB",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  backBtn: { marginTop: 24, alignItems: "center", padding: 12 },
  backText: { color: "#8888aa", fontSize: 14 },
});

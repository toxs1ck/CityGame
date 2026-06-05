import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { router } from "expo-router";

export default function LandingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>CityGame</Text>
        <Text style={styles.subtitle}>Ein Stadtdetektiv-Spiel</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => router.push("/(game)/join")}
        >
          <Text style={styles.buttonText}>🎮 Spiel beitreten</Text>
          <Text style={styles.buttonSub}>Join-Code eingeben</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push("/host/setup")}
        >
          <Text style={styles.buttonText}>🏠 Spiel hosten</Text>
          <Text style={styles.buttonSub}>Ohne Account – für Freundesgruppen</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.tertiaryButton]}
          onPress={() => router.push("/(gm)")}
        >
          <Text style={styles.buttonText}>🎓 Game Master Login</Text>
          <Text style={styles.buttonSub}>Für Lehrkräfte & Organisatoren</Text>
        </TouchableOpacity>
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
  hero: {
    alignItems: "center",
    marginTop: 48,
  },
  title: {
    fontSize: 48,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 16,
    color: "#8888aa",
    marginTop: 8,
  },
  buttons: {
    gap: 16,
  },
  button: {
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  primaryButton: {
    backgroundColor: "#3498DB",
  },
  secondaryButton: {
    backgroundColor: "#2ECC71",
  },
  tertiaryButton: {
    backgroundColor: "#1a1a3e",
    borderWidth: 1,
    borderColor: "#444",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  buttonSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: 4,
  },
});

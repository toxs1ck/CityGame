import { View, ActivityIndicator } from "react-native";
import { Redirect, Stack } from "expo-router";
import { usePlayerStore } from "../../store/playerStore";

export default function GMLayout() {
  const { user, profile, authLoaded } = usePlayerStore();

  if (!authLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#9B59B6" size="large" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/auth/login?from=gm" />;
  }

  // User exists but profile not yet fetched — wait briefly
  if (profile === null) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#9B59B6" size="large" />
      </View>
    );
  }

  if (!profile.is_gm) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1a1a2e" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Game Master" }} />
      <Stack.Screen name="scenarios/index" options={{ title: "Szenarien" }} />
      <Stack.Screen name="scenarios/new" options={{ title: "Neues Szenario" }} />
      <Stack.Screen name="scenarios/[id]/index" options={{ title: "Szenario bearbeiten" }} />
      <Stack.Screen name="scenarios/[id]/pois" options={{ title: "POIs verwalten" }} />
      <Stack.Screen name="scenarios/[id]/boundary" options={{ title: "Spielfeldbegrenzung" }} />
      <Stack.Screen name="scenarios/[id]/tasks" options={{ title: "Aufgaben verwalten" }} />
      <Stack.Screen name="session/setup" options={{ title: "Spiel konfigurieren" }} />
      <Stack.Screen name="session/[id]/monitor" options={{ title: "Live-Überwachung", headerShown: false }} />
      <Stack.Screen name="session/[id]/review" options={{ title: "Foto-Prüfung" }} />
    </Stack>
  );
}

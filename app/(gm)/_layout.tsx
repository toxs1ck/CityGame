import { Stack } from "expo-router";

export default function GMLayout() {
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

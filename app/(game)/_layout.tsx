import { Stack } from "expo-router";

export default function GameLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1a1a2e" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="join" options={{ title: "Spiel beitreten" }} />
      <Stack.Screen name="lobby" options={{ title: "Lobby", headerBackVisible: false }} />
      <Stack.Screen name="abilities" options={{ title: "Fähigkeiten wählen" }} />
      <Stack.Screen name="starting-point" options={{ title: "Zum Startpunkt navigieren" }} />
      <Stack.Screen name="map" options={{ headerShown: false }} />
      <Stack.Screen name="task/[id]" options={{ title: "Aufgabe" }} />
      <Stack.Screen name="abilities-active" options={{ title: "Meine Fähigkeiten" }} />
      <Stack.Screen name="drone-placement" options={{ title: "Drohnen platzieren" }} />
      <Stack.Screen name="game-over" options={{ title: "Spiel beendet", headerBackVisible: false }} />
    </Stack>
  );
}

import { Stack } from "expo-router";

export default function HostLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1a1a2e" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="setup" options={{ title: "Spiel hosten" }} />
      <Stack.Screen name="[id]/controls" options={{ title: "Host-Steuerung", headerShown: false }} />
    </Stack>
  );
}

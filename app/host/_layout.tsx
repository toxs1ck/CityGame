import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Redirect, Stack, router } from "expo-router";
import { usePlayerStore } from "../../store/playerStore";

export default function HostLayout() {
  const { user, authLoaded } = usePlayerStore();

  if (!authLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#2ECC71" size="large" />
      </View>
    );
  }

  if (!user) {
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
      <Stack.Screen name="setup" options={{ title: "Spiel hosten" }} />
      <Stack.Screen name="[id]/controls" options={{ title: "Host-Steuerung", headerShown: false }} />
    </Stack>
  );
}

import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import { usePlayerStore } from "../store/playerStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

export default function RootLayout() {
  const { deviceId, setDeviceId } = usePlayerStore();

  useEffect(() => {
    if (!deviceId) {
      const id = Crypto.randomUUID();
      setDeviceId(id);
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#1a1a2e" },
            headerTintColor: "#fff",
            headerTitleStyle: { fontWeight: "bold" },
            contentStyle: { backgroundColor: "#0f0f23" },
          }}
        >
          <Stack.Screen name="index" options={{ title: "CityGame", headerShown: false }} />
          <Stack.Screen name="(gm)" options={{ headerShown: false }} />
          <Stack.Screen name="host" options={{ headerShown: false }} />
          <Stack.Screen name="(game)" options={{ headerShown: false }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

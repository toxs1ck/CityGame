import { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import { usePlayerStore } from "../store/playerStore";
import { useAuth } from "../hooks/useAuth";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

const DEVICE_ID_KEY = "citygame_device_id";

export default function RootLayout() {
  const { deviceId, setDeviceId } = usePlayerStore();
  useAuth();

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (stored) {
        setDeviceId(stored);
      } else {
        const id = Crypto.randomUUID();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
        setDeviceId(id);
      }
      await SplashScreen.hideAsync();
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
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
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="(gm)" options={{ headerShown: false }} />
          <Stack.Screen name="host" options={{ headerShown: false }} />
          <Stack.Screen name="(game)" options={{ headerShown: false }} />
        </Stack>
      </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

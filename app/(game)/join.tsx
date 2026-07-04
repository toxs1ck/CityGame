import { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Keyboard,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";
import { useGameStore } from "../../store/gameStore";
import { GROUP_COLORS } from "../../constants/game";
import type { GameSession, Group, POI } from "../../types/game";

export default function JoinScreen() {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const scannedRef = useRef(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const { deviceId, setMyGroup, user, profile } = usePlayerStore();
  const { setSession, setPois } = useGameStore();

  const isLoggedIn = !!user;

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert("Kamera", "Kamerazugriff wird benötigt, um den QR-Code zu scannen.");
        return;
      }
    }
    scannedRef.current = false;
    setScannerVisible(true);
  }

  function handleBarcodeScan({ data }: { data: string }) {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScannerVisible(false);
    const scannedCode = data.trim().toUpperCase().slice(0, 6);
    setCode(scannedCode);
    if (isLoggedIn && profile?.username) {
      join(scannedCode, profile.username);
    }
  }

  async function join(codeOverride?: string, nameOverride?: string) {
    const trimmedCode = (codeOverride ?? code).trim().toUpperCase();
    const trimmedName = (
      nameOverride ?? (isLoggedIn ? profile?.username ?? "" : groupName)
    ).trim();

    if (trimmedCode.length < 6) {
      Alert.alert("Fehler", "Bitte einen gültigen 6-stelligen Code eingeben.");
      return;
    }
    if (!trimmedName) {
      Alert.alert(
        "Fehler",
        isLoggedIn ? "Kein Profilname gefunden." : "Bitte einen Gruppennamen eingeben."
      );
      return;
    }

    setLoading(true);

    const { data: sessionData, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*, scenario:scenarios(*)")
      .eq("join_code", trimmedCode)
      .in("status", ["lobby", "active"])
      .single();

    if (sessionError || !sessionData) {
      Alert.alert("Nicht gefunden", "Kein aktives Spiel mit diesem Code.");
      setLoading(false);
      return;
    }

    const session = sessionData as GameSession;

    const { data: existingGroup } = await supabase
      .from("groups")
      .select("*")
      .eq("session_id", session.id)
      .eq("device_id", deviceId!)
      .maybeSingle();

    let myGroup: Group;

    if (existingGroup) {
      myGroup = existingGroup as Group;
    } else {
      const { data: existingGroups } = await supabase
        .from("groups")
        .select("color")
        .eq("session_id", session.id);

      const usedColors = new Set(existingGroups?.map((g) => g.color) ?? []);
      const color = GROUP_COLORS.find((c) => !usedColors.has(c)) ?? GROUP_COLORS[0];

      const { data: newGroup, error: groupError } = await supabase
        .from("groups")
        .insert({
          session_id: session.id,
          name: trimmedName,
          role: "unassigned",
          device_id: deviceId!,
          color,
        })
        .select()
        .single();

      if (groupError || !newGroup) {
        Alert.alert("Fehler", "Konnte der Gruppe nicht beitreten.");
        setLoading(false);
        return;
      }
      myGroup = newGroup as Group;
    }

    const { data: pois } = await supabase
      .from("pois")
      .select("*")
      .eq("scenario_id", session.scenario_id);

    setSession(session);
    setMyGroup(myGroup);
    setPois((pois as POI[]) ?? []);

    setLoading(false);

    if (session.status === "active") {
      router.replace("/(game)/map");
    } else {
      router.replace("/(game)/lobby");
    }
  }

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.inner}>
        {/* QR scanner modal */}
        <Modal
          visible={scannerVisible}
          animationType="slide"
          onRequestClose={() => setScannerVisible(false)}
        >
          <View style={styles.scannerContainer}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={handleBarcodeScan}
            />
            <View style={styles.scannerOverlay}>
              <Text style={styles.scannerHint}>QR-Code ins Bild halten</Text>
              <TouchableOpacity
                style={styles.scannerClose}
                onPress={() => setScannerVisible(false)}
              >
                <Text style={styles.scannerCloseText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Text style={styles.title}>Spiel beitreten</Text>

        <Text style={styles.label}>JOIN-CODE</Text>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="ABCD12"
          placeholderTextColor="#444"
          maxLength={6}
          autoCapitalize="characters"
        />
        <TouchableOpacity style={styles.qrButton} onPress={openScanner}>
          <Text style={styles.qrButtonText}>⬛ QR-Code scannen</Text>
        </TouchableOpacity>

        {isLoggedIn ? (
          <>
            <Text style={styles.label}>BEITRETEN ALS</Text>
            <View style={styles.profileBadge}>
              <Text style={styles.profileBadgeText}>{profile?.username ?? user?.email}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>GRUPPENNAME</Text>
            <TextInput
              style={styles.input}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="z. B. Die Wölfe"
              placeholderTextColor="#444"
              maxLength={30}
            />
          </>
        )}

        <TouchableOpacity style={styles.button} onPress={() => join()} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Beitreten →</Text>
          )}
        </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0f0f23" },
  container: {
    flex: 1,
    backgroundColor: "#0f0f23",
    padding: 24,
    justifyContent: "center",
  },
  inner: { flex: 1 },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", marginBottom: 40 },
  label: { color: "#8888aa", fontSize: 12, letterSpacing: 2, marginBottom: 10 },
  codeInput: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 20,
    color: "#fff",
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 28,
  },
  input: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 18,
    color: "#fff",
    fontSize: 18,
    marginBottom: 28,
  },
  profileBadge: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 18,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#3498DB",
  },
  profileBadgeText: {
    color: "#3498DB",
    fontSize: 18,
    fontWeight: "700",
  },
  qrButton: {
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3498DB",
    marginBottom: 28,
  },
  qrButtonText: { color: "#3498DB", fontSize: 15, fontWeight: "600" },
  scannerContainer: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  scannerOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  scannerHint: { color: "#fff", fontSize: 16, fontWeight: "600" },
  scannerClose: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  scannerCloseText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  button: {
    backgroundColor: "#3498DB",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 20, fontWeight: "800" },
});

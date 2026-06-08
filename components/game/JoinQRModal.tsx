import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";

interface Props {
  joinCode: string | undefined;
  visible: boolean;
  onClose: () => void;
}

export function JoinQRModal({ joinCode, visible, onClose }: Props) {
  if (!joinCode) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.card}>
          <Text style={styles.title}>Spiel beitreten</Text>
          <View style={styles.qrWrapper}>
            <QRCode value={joinCode} size={220} color="#fff" backgroundColor="#0f0f23" />
          </View>
          <Text style={styles.code}>{joinCode}</Text>
          <Text style={styles.hint}>QR-Code scannen oder Code manuell eingeben</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Schließen</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#0f0f23",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    gap: 16,
    width: 300,
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  qrWrapper: {
    padding: 16,
    backgroundColor: "#0f0f23",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#333355",
  },
  code: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 6,
    fontVariant: ["tabular-nums"],
  },
  hint: { color: "#8888aa", fontSize: 13, textAlign: "center" },
  closeBtn: {
    backgroundColor: "#1a1a3e",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    marginTop: 4,
  },
  closeBtnText: { color: "#fff", fontWeight: "700" },
});

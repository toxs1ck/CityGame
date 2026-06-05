import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import MapView, { Marker, MapPressEvent } from "react-native-maps";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import type { POI, StartingPoint } from "../../../../types/game";

type Tab = "pois" | "starting_points";

export default function POIsScreen() {
  const { id: scenarioId } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("pois");
  const [pois, setPois] = useState<POI[]>([]);
  const [startingPoints, setStartingPoints] = useState<StartingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState<{ lat: number; lng: number } | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAll();
  }, [scenarioId]);

  async function fetchAll() {
    setLoading(true);
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from("pois").select("*").eq("scenario_id", scenarioId),
      supabase.from("starting_points").select("*").eq("scenario_id", scenarioId),
    ]);
    if (p) setPois(p as POI[]);
    if (s) setStartingPoints(s as StartingPoint[]);
    setLoading(false);
  }

  function onMapPress(e: MapPressEvent) {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setNewName("");
    setNewDesc("");
    setAddModal({ lat: latitude, lng: longitude });
  }

  async function saveNew() {
    if (!newName.trim()) {
      Alert.alert("Fehler", "Bitte einen Namen eingeben.");
      return;
    }
    if (!addModal) return;
    setSaving(true);

    if (tab === "pois") {
      const { error } = await supabase.from("pois").insert({
        scenario_id: scenarioId,
        name: newName.trim(),
        description: newDesc.trim(),
        lat: addModal.lat,
        lng: addModal.lng,
      });
      if (error) Alert.alert("Fehler", error.message);
    } else {
      const { error } = await supabase.from("starting_points").insert({
        scenario_id: scenarioId,
        name: newName.trim(),
        lat: addModal.lat,
        lng: addModal.lng,
      });
      if (error) Alert.alert("Fehler", error.message);
    }

    setSaving(false);
    setAddModal(null);
    fetchAll();
  }

  async function deleteItem(item: POI | StartingPoint) {
    Alert.alert("Löschen?", `"${item.name}" wirklich löschen?`, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          if (tab === "pois") {
            await supabase.from("pois").delete().eq("id", item.id);
          } else {
            await supabase.from("starting_points").delete().eq("id", item.id);
          }
          fetchAll();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "pois" && styles.activeTab]}
          onPress={() => setTab("pois")}
        >
          <Text style={styles.tabText}>📍 POIs ({pois.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "starting_points" && styles.activeTab]}
          onPress={() => setTab("starting_points")}
        >
          <Text style={styles.tabText}>🚩 Startpunkte ({startingPoints.length})</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>Tippe auf die Karte, um einen neuen Punkt hinzuzufügen</Text>

      <MapView
        style={styles.map}
        onPress={onMapPress}
        showsUserLocation
      >
        {pois.map((poi) => (
          <Marker
            key={poi.id}
            coordinate={{ latitude: poi.lat, longitude: poi.lng }}
            title={poi.name}
            pinColor="#E74C3C"
            onCalloutPress={() => deleteItem(poi)}
          />
        ))}
        {startingPoints.map((sp) => (
          <Marker
            key={sp.id}
            coordinate={{ latitude: sp.lat, longitude: sp.lng }}
            title={sp.name}
            pinColor="#F39C12"
            onCalloutPress={() => deleteItem(sp)}
          />
        ))}
      </MapView>

      <FlatList
        data={tab === "pois" ? pois : startingPoints}
        keyExtractor={(i) => i.id}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <Text style={styles.itemName}>{item.name}</Text>
            <TouchableOpacity onPress={() => deleteItem(item)}>
              <Text style={styles.deleteBtn}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Modal visible={!!addModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {tab === "pois" ? "Neuer POI" : "Neuer Startpunkt"}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor="#555"
              value={newName}
              onChangeText={setNewName}
            />
            {tab === "pois" && (
              <TextInput
                style={styles.input}
                placeholder="Beschreibung"
                placeholderTextColor="#555"
                value={newDesc}
                onChangeText={setNewDesc}
              />
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setAddModal(null)}
              >
                <Text style={styles.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveNew} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Speichern</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  tabs: { flexDirection: "row", padding: 12, gap: 8 },
  tab: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#1a1a3e",
    alignItems: "center",
  },
  activeTab: { backgroundColor: "#3498DB" },
  tabText: { color: "#fff", fontWeight: "600" },
  hint: { color: "#8888aa", fontSize: 12, textAlign: "center", paddingBottom: 8 },
  map: { height: 280 },
  list: { flex: 1, padding: 12 },
  listItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    backgroundColor: "#1a1a3e",
    borderRadius: 10,
    marginBottom: 8,
  },
  itemName: { color: "#fff", fontSize: 15 },
  deleteBtn: { color: "#E74C3C", fontSize: 18, paddingHorizontal: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#1a1a2e",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 16 },
  input: {
    backgroundColor: "#0f0f23",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 15,
    marginBottom: 12,
  },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#2a2a4e", alignItems: "center" },
  cancelText: { color: "#fff" },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#3498DB", alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
});

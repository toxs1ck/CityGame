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
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import type { POI, Task, TaskType } from "../../../../types/game";

export default function TasksScreen() {
  const { id: scenarioId } = useLocalSearchParams<{ id: string }>();
  const [pois, setPois] = useState<POI[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null);
  const [showModal, setShowModal] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("multiple_choice");
  const [points, setPoints] = useState("1");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [photoHint, setPhotoHint] = useState("");

  useEffect(() => {
    fetchAll();
  }, [scenarioId]);

  async function fetchAll() {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("pois").select("*").eq("scenario_id", scenarioId),
      supabase
        .from("tasks")
        .select("*, poi:pois!inner(*)")
        .eq("poi.scenario_id", scenarioId),
    ]);
    if (p) setPois(p as POI[]);
    if (t) setTasks(t as Task[]);
    if (p && p.length > 0 && !selectedPoi) setSelectedPoi(p[0] as POI);
  }

  function buildContent(): Record<string, unknown> {
    if (type === "multiple_choice") {
      return { options: options.filter((o) => o.trim()), correct_index: correctIndex };
    }
    if (type === "text_answer") {
      return { expected_answer: expectedAnswer, case_sensitive: false };
    }
    return { hint: photoHint };
  }

  async function saveTask() {
    if (!selectedPoi) return;
    if (!title.trim()) { Alert.alert("Fehler", "Titel fehlt."); return; }

    const { error } = await supabase.from("tasks").insert({
      poi_id: selectedPoi.id,
      type,
      title: title.trim(),
      description: description.trim(),
      content: buildContent(),
      action_points: parseInt(points) || 1,
    });

    if (error) { Alert.alert("Fehler", error.message); return; }
    setShowModal(false);
    resetForm();
    fetchAll();
  }

  function resetForm() {
    setTitle(""); setDescription(""); setType("multiple_choice");
    setPoints("1"); setOptions(["", "", "", ""]); setCorrectIndex(0);
    setExpectedAnswer(""); setPhotoHint("");
  }

  const poiTasks = tasks.filter((t) => t.poi?.id === selectedPoi?.id);

  return (
    <View style={styles.container}>
      <ScrollView horizontal style={styles.poiSelector} showsHorizontalScrollIndicator={false}>
        {pois.map((poi) => (
          <TouchableOpacity
            key={poi.id}
            style={[styles.poiChip, selectedPoi?.id === poi.id && styles.poiChipActive]}
            onPress={() => setSelectedPoi(poi)}
          >
            <Text style={styles.poiChipText}>{poi.name}</Text>
            <Text style={styles.poiChipCount}>
              {tasks.filter((t) => t.poi?.id === poi.id).length}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {pois.length === 0 ? (
        <Text style={styles.empty}>Erstelle zuerst POIs, bevor du Aufgaben hinzufügst.</Text>
      ) : (
        <FlatList
          data={poiTasks}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.taskType}>{item.type}</Text>
                <Text style={styles.taskPoints}>{item.action_points} AP</Text>
              </View>
              <Text style={styles.taskTitle}>{item.title}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Noch keine Aufgaben für diesen POI.</Text>
          }
        />
      )}

      {selectedPoi && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowModal(true)}>
          <Text style={styles.fabText}>+ Aufgabe</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modal} contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>Neue Aufgabe – {selectedPoi?.name}</Text>

            <Text style={styles.label}>Typ</Text>
            <View style={styles.typeRow}>
              {(["multiple_choice", "text_answer", "photo"] as TaskType[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, type === t && styles.typeChipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={styles.typeChipText}>
                    {t === "multiple_choice" ? "Multiple Choice" : t === "text_answer" ? "Texteingabe" : "Foto"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Titel</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Aufgabentitel" placeholderTextColor="#555" />

            <Text style={styles.label}>Beschreibung</Text>
            <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription} multiline placeholder="Aufgabenbeschreibung…" placeholderTextColor="#555" />

            <Text style={styles.label}>Aktionspunkte</Text>
            <TextInput style={styles.input} value={points} onChangeText={setPoints} keyboardType="number-pad" placeholder="1" placeholderTextColor="#555" />

            {type === "multiple_choice" && (
              <>
                <Text style={styles.label}>Antwortmöglichkeiten (tippe auf ✓ für richtige)</Text>
                {options.map((opt, i) => (
                  <View key={i} style={styles.optionRow}>
                    <TouchableOpacity onPress={() => setCorrectIndex(i)} style={[styles.correctBtn, correctIndex === i && styles.correctBtnActive]}>
                      <Text style={styles.correctBtnText}>✓</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.input, { flex: 1, marginBottom: 0 }]}
                      value={opt}
                      onChangeText={(v) => setOptions(options.map((o, j) => j === i ? v : o))}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor="#555"
                    />
                  </View>
                ))}
              </>
            )}

            {type === "text_answer" && (
              <>
                <Text style={styles.label}>Erwartete Antwort</Text>
                <TextInput style={styles.input} value={expectedAnswer} onChangeText={setExpectedAnswer} placeholder="Richtige Antwort" placeholderTextColor="#555" />
              </>
            )}

            {type === "photo" && (
              <>
                <Text style={styles.label}>Hinweis für die Gruppe</Text>
                <TextInput style={styles.input} value={photoHint} onChangeText={setPhotoHint} placeholder="z. B. Fotografiert den Brunnen" placeholderTextColor="#555" />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowModal(false); resetForm(); }}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveTask}>
                <Text style={styles.saveText}>Speichern</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  poiSelector: { maxHeight: 60, paddingHorizontal: 12, paddingVertical: 8 },
  poiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1a1a3e",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  poiChipActive: { backgroundColor: "#3498DB" },
  poiChipText: { color: "#fff", fontWeight: "600" },
  poiChipCount: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  list: { padding: 12, paddingBottom: 100 },
  card: { backgroundColor: "#1a1a3e", borderRadius: 12, padding: 16, marginBottom: 10 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  taskType: { color: "#8888aa", fontSize: 12, textTransform: "uppercase" },
  taskPoints: { color: "#F39C12", fontWeight: "700" },
  taskTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  empty: { color: "#8888aa", textAlign: "center", marginTop: 48, fontSize: 15 },
  fab: { position: "absolute", bottom: 32, right: 24, backgroundColor: "#3498DB", borderRadius: 24, paddingHorizontal: 24, paddingVertical: 14 },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#1a1a2e", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  modalContent: { padding: 24, paddingBottom: 48 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 20 },
  label: { color: "#8888aa", fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: { backgroundColor: "#0f0f23", borderRadius: 10, padding: 14, color: "#fff", fontSize: 15, marginBottom: 16 },
  textarea: { height: 80, textAlignVertical: "top" },
  typeRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  typeChip: { flex: 1, padding: 10, backgroundColor: "#0f0f23", borderRadius: 10, alignItems: "center" },
  typeChipActive: { backgroundColor: "#3498DB" },
  typeChipText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  optionRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 10 },
  correctBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#0f0f23", alignItems: "center", justifyContent: "center" },
  correctBtnActive: { backgroundColor: "#2ECC71" },
  correctBtnText: { color: "#fff", fontWeight: "700" },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#2a2a4e", alignItems: "center" },
  cancelText: { color: "#fff" },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#3498DB", alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
});

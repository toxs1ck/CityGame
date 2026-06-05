import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { usePlayerStore } from "../../../store/playerStore";
import { useGameStore } from "../../../store/gameStore";
import type { AssignedTask, MultipleChoiceContent, TextAnswerContent, PhotoContent } from "../../../types/game";

export default function TaskScreen() {
  const { id: assignedTaskId } = useLocalSearchParams<{ id: string }>();
  const { myTasks, updateTaskStatus, myGroup, setMyGroup } = usePlayerStore();
  const { session } = useGameStore();
  const [submitting, setSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [result, setResult] = useState<"correct" | "incorrect" | "submitted" | null>(null);

  const assigned = myTasks.find((t) => t.id === assignedTaskId);
  const task = assigned?.task;

  if (!assigned || !task) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Aufgabe nicht gefunden.</Text>
      </View>
    );
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function submit() {
    if (!myGroup || !session) return;

    if (task!.type === "multiple_choice" && selectedOption === null) {
      Alert.alert("Hinweis", "Bitte eine Antwort auswählen.");
      return;
    }
    if (task!.type === "text_answer" && !textAnswer.trim()) {
      Alert.alert("Hinweis", "Bitte eine Antwort eingeben.");
      return;
    }
    if (task!.type === "photo" && !photoUri) {
      Alert.alert("Hinweis", "Bitte ein Foto aufnehmen.");
      return;
    }

    setSubmitting(true);

    let submissionData: Record<string, unknown> = {};
    let isCorrect = false;

    if (task!.type === "multiple_choice") {
      const content = task!.content as MultipleChoiceContent;
      isCorrect = selectedOption === content.correct_index;
      submissionData = { selected_index: selectedOption };
    } else if (task!.type === "text_answer") {
      const content = task!.content as TextAnswerContent;
      isCorrect = content.case_sensitive
        ? textAnswer.trim() === content.expected_answer
        : textAnswer.trim().toLowerCase() === content.expected_answer.toLowerCase();
      submissionData = { answer: textAnswer.trim() };
    } else if (task!.type === "photo") {
      // Upload to Supabase Storage
      const fileName = `${session.id}/${myGroup.id}/${assignedTaskId}.jpg`;
      const base64 = await fetch(photoUri!).then((r) => r.blob());
      const { error: uploadError } = await supabase.storage
        .from("task-photos")
        .upload(fileName, base64, { contentType: "image/jpeg", upsert: true });
      if (uploadError) {
        Alert.alert("Fehler", "Foto konnte nicht hochgeladen werden.");
        setSubmitting(false);
        return;
      }
      submissionData = { photo_url: fileName };
      isCorrect = false; // requires GM review
    }

    // Insert completion record
    const { error: completionError } = await supabase
      .from("task_completions")
      .insert({
        assigned_task_id: assignedTaskId,
        session_id: session.id,
        submission_data: submissionData,
        status: task!.type === "photo" ? "pending" : isCorrect ? "approved" : "rejected",
        points_awarded: task!.type === "photo" ? 0 : isCorrect ? task!.action_points : 0,
      });

    if (completionError) {
      Alert.alert("Fehler", completionError.message);
      setSubmitting(false);
      return;
    }

    // Mark assigned task as completed
    await supabase
      .from("group_assigned_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", assignedTaskId);

    // Award points if correct (non-photo)
    if (isCorrect && task!.type !== "photo") {
      const { data: updatedGroup } = await supabase
        .from("groups")
        .update({ action_points: (myGroup.action_points ?? 0) + task!.action_points })
        .eq("id", myGroup.id)
        .select()
        .single();
      if (updatedGroup) setMyGroup(updatedGroup as any);
    }

    updateTaskStatus(assignedTaskId, "completed");
    setResult(task!.type === "photo" ? "submitted" : isCorrect ? "correct" : "incorrect");
    setSubmitting(false);
  }

  if (result) {
    return (
      <View style={styles.resultContainer}>
        {result === "correct" && (
          <>
            <Text style={styles.resultIcon}>🎉</Text>
            <Text style={styles.resultTitle}>Richtig!</Text>
            <Text style={styles.resultSub}>+{task.action_points} Aktionspunkte</Text>
          </>
        )}
        {result === "incorrect" && (
          <>
            <Text style={styles.resultIcon}>❌</Text>
            <Text style={styles.resultTitle}>Falsch</Text>
            <Text style={styles.resultSub}>Leider keine Punkte. Neue Aufgabe wartet!</Text>
          </>
        )}
        {result === "submitted" && (
          <>
            <Text style={styles.resultIcon}>📸</Text>
            <Text style={styles.resultTitle}>Foto eingereicht!</Text>
            <Text style={styles.resultSub}>Der Game Master prüft dein Foto.</Text>
          </>
        )}
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Zurück zur Karte</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskType}>
          {task.type === "multiple_choice" ? "Multiple Choice" : task.type === "text_answer" ? "Texteingabe" : "📸 Foto"}
        </Text>
        <Text style={styles.taskPoints}>+{task.action_points} AP</Text>
      </View>

      <Text style={styles.taskTitle}>{task.title}</Text>
      {task.description ? <Text style={styles.taskDesc}>{task.description}</Text> : null}

      {task.type === "multiple_choice" && (
        <View style={styles.options}>
          {(task.content as MultipleChoiceContent).options.map((opt, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.option, selectedOption === i && styles.optionSelected]}
              onPress={() => setSelectedOption(i)}
            >
              <Text style={styles.optionText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {task.type === "text_answer" && (
        <TextInput
          style={styles.textInput}
          value={textAnswer}
          onChangeText={setTextAnswer}
          placeholder="Deine Antwort…"
          placeholderTextColor="#555"
          multiline
        />
      )}

      {task.type === "photo" && (
        <View style={styles.photoSection}>
          <Text style={styles.photoHint}>
            {(task.content as PhotoContent).hint}
          </Text>
          <TouchableOpacity style={styles.cameraButton} onPress={pickPhoto}>
            <Text style={styles.cameraButtonText}>📷 Foto aufnehmen</Text>
          </TouchableOpacity>
          {photoUri && (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
          )}
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.submitDisabled]}
        onPress={submit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Antwort absenden</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  taskHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  taskType: { color: "#8888aa", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  taskPoints: { color: "#F39C12", fontWeight: "700", fontSize: 14 },
  taskTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 12 },
  taskDesc: { color: "#aaaacc", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  options: { gap: 10, marginBottom: 24 },
  option: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 18,
    borderWidth: 2,
    borderColor: "transparent",
  },
  optionSelected: { borderColor: "#3498DB", backgroundColor: "#1a2a4e" },
  optionText: { color: "#fff", fontSize: 16 },
  textInput: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 18,
    color: "#fff",
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 24,
  },
  photoSection: { marginBottom: 24 },
  photoHint: { color: "#aaaacc", fontSize: 15, marginBottom: 16 },
  cameraButton: {
    backgroundColor: "#1a1a3e",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
  },
  cameraButtonText: { color: "#fff", fontSize: 16 },
  photoPreview: { width: "100%", height: 200, borderRadius: 14, marginTop: 12 },
  submitButton: {
    backgroundColor: "#2ECC71",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  submitDisabled: { backgroundColor: "#1a3a1a" },
  submitText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  resultContainer: {
    flex: 1,
    backgroundColor: "#0f0f23",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  resultIcon: { fontSize: 72, marginBottom: 20 },
  resultTitle: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 8 },
  resultSub: { color: "#8888aa", fontSize: 16, textAlign: "center", marginBottom: 40 },
  backButton: { backgroundColor: "#3498DB", borderRadius: 16, padding: 18, width: "100%", alignItems: "center" },
  backButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#E74C3C", fontSize: 16 },
});

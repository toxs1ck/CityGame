import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../../lib/supabase";

interface PendingReview {
  id: string;
  assigned_task_id: string;
  submitted_at: string;
  submission_data: { photo_url?: string };
  group_name: string;
  task_title: string;
  task_points: number;
}

export default function ReviewScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    fetchPending();
  }, [sessionId]);

  async function fetchPending() {
    setLoading(true);
    const { data } = await supabase
      .from("task_completions")
      .select(`
        id, assigned_task_id, submitted_at, submission_data,
        assigned_task:group_assigned_tasks(
          group:groups(name),
          task:tasks(title, action_points)
        )
      `)
      .eq("session_id", sessionId)
      .eq("status", "pending");

    if (data) {
      const parsed = data.map((r: any) => ({
        id: r.id,
        assigned_task_id: r.assigned_task_id,
        submitted_at: r.submitted_at,
        submission_data: r.submission_data,
        group_name: r.assigned_task?.group?.name ?? "?",
        task_title: r.assigned_task?.task?.title ?? "?",
        task_points: r.assigned_task?.task?.action_points ?? 0,
      }));
      setReviews(parsed);

      // Get signed URLs for photos
      for (const r of parsed) {
        if (r.submission_data?.photo_url) {
          const { data: url } = await supabase.storage
            .from("task-photos")
            .createSignedUrl(r.submission_data.photo_url, 300);
          if (url) {
            setPhotoUrls((prev) => new Map(prev).set(r.id, url.signedUrl));
          }
        }
      }
    }
    setLoading(false);
  }

  async function decide(review: PendingReview, approved: boolean) {
    const { data: taskData } = await supabase
      .from("group_assigned_tasks")
      .select("group_id")
      .eq("id", review.assigned_task_id)
      .single();

    await supabase
      .from("task_completions")
      .update({
        status: approved ? "approved" : "rejected",
        points_awarded: approved ? review.task_points : 0,
      })
      .eq("id", review.id);

    if (approved && taskData) {
      const { data: g } = await supabase
        .from("groups")
        .select("action_points")
        .eq("id", taskData.group_id)
        .single();
      if (g) {
        await supabase
          .from("groups")
          .update({ action_points: g.action_points + review.task_points })
          .eq("id", taskData.group_id);
      }
    }

    await supabase
      .from("group_assigned_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", review.assigned_task_id);

    fetchPending();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={reviews}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.groupName}>{item.group_name}</Text>
              <Text style={styles.taskPoints}>+{item.task_points} AP</Text>
            </View>
            <Text style={styles.taskTitle}>{item.task_title}</Text>

            {photoUrls.has(item.id) && (
              <Image
                source={{ uri: photoUrls.get(item.id) }}
                style={styles.photo}
                resizeMode="cover"
              />
            )}

            <View style={styles.buttons}>
              <TouchableOpacity
                style={styles.rejectBtn}
                onPress={() => decide(item, false)}
              >
                <Text style={styles.btnText}>✕ Ablehnen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.approveBtn}
                onPress={() => decide(item, true)}
              >
                <Text style={styles.btnText}>✓ Genehmigen</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Keine ausstehenden Foto-Einreichungen.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  list: { padding: 16, gap: 16 },
  card: { backgroundColor: "#1a1a3e", borderRadius: 16, padding: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  groupName: { color: "#8888aa", fontSize: 13 },
  taskPoints: { color: "#F39C12", fontWeight: "700" },
  taskTitle: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 12 },
  photo: { width: "100%", height: 200, borderRadius: 12, marginBottom: 12 },
  buttons: { flexDirection: "row", gap: 10 },
  rejectBtn: { flex: 1, backgroundColor: "#E74C3C", borderRadius: 12, padding: 14, alignItems: "center" },
  approveBtn: { flex: 1, backgroundColor: "#2ECC71", borderRadius: 12, padding: 14, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  empty: { color: "#8888aa", textAlign: "center", marginTop: 64, fontSize: 15 },
});

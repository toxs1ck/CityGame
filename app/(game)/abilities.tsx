import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useGameStore } from "../../store/gameStore";
import { usePlayerStore } from "../../store/playerStore";
import { MAX_NORMAL_ABILITIES, MAX_ULTIMATE_ABILITIES } from "../../constants/game";
import type { AbilityDefinition } from "../../types/game";

const ABILITY_ICONS: Record<string, string> = {
  compass:             "🧭",
  distance_reveal:     "📏",
  poi_proximity_reveal:"📍",
  stealth:             "👻",
  motion_detector:     "📡",
  trail_reader:        "🐾",
  exclusion_zone:      "🚫",
  exact_location:      "🎯",
  drone_view:          "🚁",
  tripwire:            "⚡",
  zone_pass:           "🚶",
  radar_jam:           "📟",
  freeze:              "❄️",
  trap:                "🪤",
  reveal_static:       "🔦",
  skip_ping:           "🔕",
  dark_mode:           "🌑",
  roadblock:           "🚧",
};

// ── Info Modal ────────────────────────────────────────────────────────────────

function InfoModal({ ability, onClose }: { ability: AbilityDefinition; onClose: () => void }) {
  const isNormal = ability.tier === "normal";
  const accentColor = isNormal ? "#3498DB" : "#9B59B6";

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={modal.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={modal.card}>
          <Text style={modal.icon}>{ABILITY_ICONS[ability.type] ?? "✨"}</Text>
          <Text style={modal.name}>{ability.name}</Text>
          <View style={[modal.tierBadge, { backgroundColor: accentColor + "33", borderColor: accentColor }]}>
            <Text style={[modal.tierText, { color: accentColor }]}>
              {isNormal ? "Normal" : "Ultimate"}
            </Text>
          </View>

          <Text style={modal.desc}>{ability.description}</Text>

          <View style={modal.stats}>
            {ability.cooldown_seconds != null && (
              <View style={modal.statRow}>
                <Text style={modal.statIcon}>⏱</Text>
                <Text style={modal.statLabel}>Cooldown</Text>
                <Text style={modal.statValue}>{Math.round(ability.cooldown_seconds / 60)} min</Text>
              </View>
            )}
            {ability.ap_cost != null && (
              <View style={modal.statRow}>
                <Text style={modal.statIcon}>⚡</Text>
                <Text style={modal.statLabel}>Kosten</Text>
                <Text style={modal.statValue}>{ability.ap_cost} AP</Text>
              </View>
            )}
            {ability.duration_seconds != null && (
              <View style={modal.statRow}>
                <Text style={modal.statIcon}>⏳</Text>
                <Text style={modal.statLabel}>Dauer</Text>
                <Text style={modal.statValue}>{Math.round(ability.duration_seconds / 60)} min</Text>
              </View>
            )}
          </View>

          <TouchableOpacity style={modal.closeBtn} onPress={onClose}>
            <Text style={modal.closeBtnText}>Schließen</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Ability Card (grid cell) ──────────────────────────────────────────────────

function AbilityCard({
  ability, isSelected, accentColor, cardWidth, onPress, onInfo,
}: {
  ability: AbilityDefinition;
  isSelected: boolean;
  accentColor: string;
  cardWidth: number;
  onPress: () => void;
  onInfo: () => void;
}) {
  return (
    <TouchableOpacity
      style={[card.root, { width: cardWidth }, isSelected && { borderColor: accentColor, backgroundColor: accentColor + "18" }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Info button */}
      <TouchableOpacity
        style={card.infoBtn}
        onPress={onInfo}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Text style={card.infoBtnText}>ⓘ</Text>
      </TouchableOpacity>

      {/* Selection dot */}
      {isSelected && <View style={[card.dot, { backgroundColor: accentColor }]} />}

      {/* Icon */}
      <Text style={card.icon}>{ABILITY_ICONS[ability.type] ?? "✨"}</Text>

      {/* Name */}
      <Text style={card.name} numberOfLines={2}>{ability.name}</Text>

      {/* Cooldown / cost badge */}
      <Text style={card.badge}>
        {ability.tier === "normal"
          ? `⏱ ${Math.round((ability.cooldown_seconds ?? 0) / 60)} min`
          : `⚡ ${ability.ap_cost} AP`}
      </Text>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AbilitySelectionScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { session } = useGameStore();
  const { myGroup, setMyAbilities } = usePlayerStore();
  const [abilities, setAbilities] = useState<AbilityDefinition[]>([]);
  const [selectedNormal, setSelectedNormal] = useState<string[]>([]);
  const [selectedUltimate, setSelectedUltimate] = useState<string[]>([]);
  const [infoAbility, setInfoAbility] = useState<AbilityDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 2-column grid: screen width minus horizontal padding (16 each side) minus gap
  const COLS = 2;
  const GAP = 10;
  const PADDING = 16;
  const cardWidth = (width - PADDING * 2 - GAP * (COLS - 1)) / COLS;

  useEffect(() => {
    fetchAbilities();
  }, [session?.id, myGroup?.role]);

  async function fetchAbilities() {
    if (!session || !myGroup) return;
    setLoading(true);

    const role = myGroup.role;
    const { data, error } = await supabase
      .from("ability_definitions")
      .select("*")
      .or(`scenario_id.is.null,scenario_id.eq.${session.scenario_id}`)
      .or(`for_role.eq.${role},for_role.eq.both`)
      .order("tier")
      .order("name");

    if (data) setAbilities(data as AbilityDefinition[]);
    setLoading(false);
  }

  function toggleAbility(ability: AbilityDefinition) {
    if (ability.tier === "normal") {
      setSelectedNormal((prev) => {
        if (prev.includes(ability.id)) return prev.filter((id) => id !== ability.id);
        if (prev.length >= MAX_NORMAL_ABILITIES) {
          Alert.alert("Limit", `Maximal ${MAX_NORMAL_ABILITIES} normale Fähigkeiten.`);
          return prev;
        }
        return [...prev, ability.id];
      });
    } else {
      setSelectedUltimate((prev) => {
        if (prev.includes(ability.id)) return prev.filter((id) => id !== ability.id);
        if (prev.length >= MAX_ULTIMATE_ABILITIES) {
          Alert.alert("Limit", `Maximal ${MAX_ULTIMATE_ABILITIES} Ultimate-Fähigkeit.`);
          return prev;
        }
        return [...prev, ability.id];
      });
    }
  }

  async function confirm() {
    if (selectedNormal.length < MAX_NORMAL_ABILITIES) {
      Alert.alert("Auswahl unvollständig", `Bitte ${MAX_NORMAL_ABILITIES} normale Fähigkeiten wählen.`);
      return;
    }
    if (selectedUltimate.length < MAX_ULTIMATE_ABILITIES) {
      Alert.alert("Auswahl unvollständig", "Bitte 1 Ultimate-Fähigkeit wählen.");
      return;
    }
    if (!session || !myGroup) return;

    setSaving(true);
    const allSelected = [...selectedNormal, ...selectedUltimate];
    const rows = allSelected.map((abilityId) => ({
      group_id: myGroup.id,
      session_id: session.id,
      ability_id: abilityId,
    }));

    const { data, error } = await supabase
      .from("group_abilities")
      .insert(rows)
      .select("*, ability:ability_definitions(*)");

    setSaving(false);
    if (error) { Alert.alert("Fehler", error.message); return; }
    if (data) setMyAbilities(data as any);

    const startingMode = session.settings?.starting_mode ?? "headstart";
    router.replace(startingMode === "starting_points" ? "/(game)/starting-point" : "/(game)/map");
  }

  const normalAbilities  = abilities.filter((a) => a.tier === "normal");
  const ultimateAbilities = abilities.filter((a) => a.tier === "ultimate");

  const isFugitive = myGroup?.role === "fugitive";
  const normalDone   = selectedNormal.length >= MAX_NORMAL_ABILITIES;
  const ultimateDone = selectedUltimate.length >= MAX_ULTIMATE_ABILITIES;
  const canConfirm   = normalDone && ultimateDone;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3498DB" size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Info modal */}
      {infoAbility && (
        <InfoModal ability={infoAbility} onClose={() => setInfoAbility(null)} />
      )}

      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: PADDING }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Fähigkeiten wählen</Text>
          <Text style={styles.role}>{isFugitive ? "🏃 Flüchtig" : "🔍 Detektiv"}</Text>
        </View>

        {/* Progress pills */}
        <View style={styles.pills}>
          <View style={[styles.pill, normalDone && styles.pillDone]}>
            <Text style={styles.pillText}>Normal {selectedNormal.length}/{MAX_NORMAL_ABILITIES}</Text>
          </View>
          <View style={[styles.pill, ultimateDone && styles.pillDone]}>
            <Text style={styles.pillText}>Ultimate {selectedUltimate.length}/{MAX_ULTIMATE_ABILITIES}</Text>
          </View>
        </View>

        {abilities.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Keine Fähigkeiten verfügbar.</Text>
            <Text style={styles.emptyHint}>Stelle sicher, dass die Supabase-Migration 001_initial_schema.sql ausgeführt wurde.</Text>
          </View>
        )}

        {/* Normal abilities */}
        {normalAbilities.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              Normale Fähigkeiten — wähle {MAX_NORMAL_ABILITIES}
            </Text>
            <View style={[styles.grid, { gap: GAP }]}>
              {normalAbilities.map((a) => (
                <AbilityCard
                  key={a.id}
                  ability={a}
                  isSelected={selectedNormal.includes(a.id)}
                  accentColor="#3498DB"
                  cardWidth={cardWidth}
                  onPress={() => toggleAbility(a)}
                  onInfo={() => setInfoAbility(a)}
                />
              ))}
            </View>
          </>
        )}

        {/* Ultimate abilities */}
        {ultimateAbilities.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
              Ultimate — wähle {MAX_ULTIMATE_ABILITIES}
            </Text>
            <View style={[styles.grid, { gap: GAP }]}>
              {ultimateAbilities.map((a) => (
                <AbilityCard
                  key={a.id}
                  ability={a}
                  isSelected={selectedUltimate.includes(a.id)}
                  accentColor="#9B59B6"
                  cardWidth={cardWidth}
                  onPress={() => toggleAbility(a)}
                  onInfo={() => setInfoAbility(a)}
                />
              ))}
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky confirm button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.confirmBtn, !canConfirm && styles.confirmDisabled]}
          onPress={confirm}
          disabled={saving || !canConfirm}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>Auswahl bestätigen →</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  center: { flex: 1, backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" },
  scroll: { paddingTop: 24, paddingBottom: 16 },
  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff" },
  role: { color: "#8888aa", fontSize: 15, marginTop: 4 },
  pills: { flexDirection: "row", gap: 10, marginBottom: 20 },
  pill: {
    backgroundColor: "#1a1a3e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "transparent",
  },
  pillDone: { borderColor: "#2ECC71", backgroundColor: "#0d2a1a" },
  pillText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  sectionTitle: {
    color: "#8888aa",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center" },
  emptyHint: { color: "#8888aa", fontSize: 13, textAlign: "center" },
  footer: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, backgroundColor: "#0f0f23" },
  confirmBtn: {
    backgroundColor: "#2ECC71",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  confirmDisabled: { backgroundColor: "#1a3a1a" },
  confirmText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});

const card = StyleSheet.create({
  root: {
    aspectRatio: 1,
    backgroundColor: "#1a1a3e",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: 10,
    position: "relative",
  },
  infoBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    padding: 2,
  },
  infoBtnText: { color: "#8888aa", fontSize: 16, fontWeight: "700" },
  dot: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  icon: { fontSize: 36, marginBottom: 8 },
  name: { color: "#fff", fontSize: 12, fontWeight: "700", textAlign: "center" },
  badge: { color: "#8888aa", fontSize: 10, marginTop: 4 },
});

const modal = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    alignItems: "center",
  },
  icon: { fontSize: 52, marginBottom: 12 },
  name: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  tierBadge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  tierText: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  desc: { color: "#aaaacc", fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 20 },
  stats: { width: "100%", gap: 10, marginBottom: 24 },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  statIcon: { fontSize: 16 },
  statLabel: { flex: 1, color: "#8888aa", fontSize: 13 },
  statValue: { color: "#fff", fontWeight: "700", fontSize: 13 },
  closeBtn: {
    backgroundColor: "#2a2a4e",
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
  },
  closeBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

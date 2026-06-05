import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";
import { useGameStore } from "../../store/gameStore";
import { isCooldownReady, cooldownRemainingSeconds } from "../../lib/gameLogic";
import type { GroupAbility } from "../../types/game";

export default function AbilitiesActiveScreen() {
  const { myAbilities, myGroup, updateAbilityLastUsed } = usePlayerStore();
  const { session } = useGameStore();
  const [activating, setActivating] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function activate(ability: GroupAbility) {
    if (!myGroup || !session) return;

    const def = ability.ability;
    if (!def) return;

    if (def.tier === "ultimate") {
      if ((myGroup.action_points ?? 0) < (def.ap_cost ?? 0)) {
        Alert.alert("Zu wenig AP", `Du brauchst ${def.ap_cost} AP, hast aber ${myGroup.action_points}.`);
        return;
      }
    } else if (!isCooldownReady(ability)) {
      const remaining = cooldownRemainingSeconds(ability);
      Alert.alert("Abklingzeit", `Noch ${Math.ceil(remaining / 60)} Min. ${remaining % 60} Sek. warten.`);
      return;
    }

    Alert.alert(
      `${def.name} aktivieren?`,
      def.description + (def.tier === "ultimate" ? `\n\nKosten: ${def.ap_cost} AP` : ""),
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Aktivieren",
          onPress: async () => {
            setActivating(ability.id);
            const expiresAt = def.duration_seconds
              ? new Date(Date.now() + def.duration_seconds * 1000).toISOString()
              : null;

            await supabase.from("active_abilities").insert({
              group_id: myGroup.id,
              session_id: session.id,
              ability_id: def.id,
              expires_at: expiresAt,
            });

            if (def.tier === "ultimate") {
              await supabase
                .from("groups")
                .update({ action_points: myGroup.action_points - (def.ap_cost ?? 0) })
                .eq("id", myGroup.id);
            }

            await supabase
              .from("group_abilities")
              .update({ last_used_at: new Date().toISOString() })
              .eq("id", ability.id);

            updateAbilityLastUsed(def.id);
            setActivating(null);

            Alert.alert("Aktiviert!", `${def.name} ist jetzt aktiv.`);
          },
        },
      ]
    );
  }

  const normal = myAbilities.filter((a) => a.ability?.tier === "normal");
  const ultimate = myAbilities.filter((a) => a.ability?.tier === "ultimate");

  function renderAbility(item: GroupAbility) {
    const def = item.ability;
    if (!def) return null;
    const ready = isCooldownReady(item);
    const remaining = cooldownRemainingSeconds(item);
    const canAfford = def.tier !== "ultimate" || (myGroup?.action_points ?? 0) >= (def.ap_cost ?? 0);

    return (
      <TouchableOpacity
        style={[styles.card, !ready && styles.cardCooldown, !canAfford && styles.cardNoAP]}
        onPress={() => activate(item)}
        disabled={activating === item.id}
      >
        <View style={styles.cardTop}>
          <Text style={styles.abilityName}>{def.name}</Text>
          {def.tier === "ultimate" ? (
            <Text style={[styles.cost, !canAfford && styles.costRed]}>⚡ {def.ap_cost} AP</Text>
          ) : (
            <Text style={[styles.cost, ready && styles.costGreen]}>
              {ready ? "Bereit" : `${Math.ceil(remaining / 60)}m ${remaining % 60}s`}
            </Text>
          )}
        </View>
        <Text style={styles.abilityDesc}>{def.description}</Text>
        {def.duration_seconds && (
          <Text style={styles.duration}>Dauer: {def.duration_seconds / 60} min</Text>
        )}
        {activating === item.id && <ActivityIndicator style={{ marginTop: 8 }} color="#fff" />}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.apBar}>
        <Text style={styles.apLabel}>Aktionspunkte</Text>
        <Text style={styles.apValue}>⚡ {myGroup?.action_points ?? 0} AP</Text>
      </View>

      {normal.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Normale Fähigkeiten</Text>
          <FlatList
            data={normal}
            keyExtractor={(a) => a.id}
            renderItem={({ item }) => renderAbility(item)}
            extraData={tick}
            scrollEnabled={false}
          />
        </>
      )}

      {ultimate.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Ultimate</Text>
          <FlatList
            data={ultimate}
            keyExtractor={(a) => a.id}
            renderItem={({ item }) => renderAbility(item)}
            extraData={tick}
            scrollEnabled={false}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23", padding: 16 },
  apBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  apLabel: { color: "#8888aa", fontSize: 14 },
  apValue: { color: "#F39C12", fontWeight: "800", fontSize: 18 },
  sectionTitle: { color: "#8888aa", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, marginTop: 8 },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  cardCooldown: { opacity: 0.6 },
  cardNoAP: { opacity: 0.5 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  abilityName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cost: { color: "#8888aa", fontSize: 13 },
  costGreen: { color: "#2ECC71", fontWeight: "700" },
  costRed: { color: "#E74C3C" },
  abilityDesc: { color: "#aaaacc", fontSize: 13, lineHeight: 18 },
  duration: { color: "#9B59B6", fontSize: 12, marginTop: 4 },
});

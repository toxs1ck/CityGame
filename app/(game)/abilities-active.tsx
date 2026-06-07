import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import * as Location from "expo-location";
import { supabase } from "../../lib/supabase";
import { usePlayerStore } from "../../store/playerStore";
import { useGameStore } from "../../store/gameStore";
import {
  isCooldownReady,
  cooldownRemainingSeconds,
} from "../../lib/gameLogic";
import {
  haversineDistance,
  bearingDegrees,
  compassDirection,
  formatDistance,
  computeGameAreaScale,
} from "../../lib/geo";
import type { GroupAbility, AbilityDefinition, GeoPolygon } from "../../types/game";

/** Abilities that compute an instant result and don't need a map object. */
const INSTANT_ABILITIES = new Set([
  "compass",
  "distance_reveal",
  "poi_proximity_reveal",
  "exact_location",
]);

/** Abilities that place a persistent object on the map. */
const PLACEMENT_ABILITIES = new Set([
  "exclusion_zone",
  "motion_detector",
  "trap",
  "roadblock",
  "drone_view",
]);

async function getCurrentPos(): Promise<{ lat: number; lng: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}

export default function AbilitiesActiveScreen() {
  const { myAbilities, myGroup, updateAbilityLastUsed, isOobPunished, isFrozen, isTrapped } = usePlayerStore();
  const { session, pois, groups, latestLocations } = useGameStore();
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
        Alert.alert(
          "Zu wenig AP",
          `Du brauchst ${def.ap_cost} AP, hast aber ${myGroup.action_points}.`
        );
        return;
      }
    } else if (!isCooldownReady(ability)) {
      const remaining = cooldownRemainingSeconds(ability);
      Alert.alert(
        "Abklingzeit",
        `Noch ${Math.ceil(remaining / 60)} Min. ${Math.round(remaining % 60)} Sek. warten.`
      );
      return;
    }

    Alert.alert(
      `${def.name} aktivieren?`,
      def.description +
        (def.tier === "ultimate" ? `\n\nKosten: ${def.ap_cost} AP` : ""),
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Aktivieren",
          onPress: async () => {
            setActivating(ability.id);
            await runAbility(def, ability);
            setActivating(null);
          },
        },
      ]
    );
  }

  async function recordUsage(def: AbilityDefinition, ability: GroupAbility) {
    if (!myGroup || !session) return;

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
  }

  async function runAbility(def: AbilityDefinition, ga: GroupAbility) {
    if (INSTANT_ABILITIES.has(def.type)) {
      await activateInstant(def, ga);
    } else if (PLACEMENT_ABILITIES.has(def.type)) {
      await activatePlacement(def, ga);
    } else if (def.type === "freeze") {
      await activateFreeze(def, ga);
    } else {
      // Timed/passive abilities (radar_jam, stealth, skip_ping, dark_mode, zone_pass)
      await recordUsage(def, ga);
      Alert.alert("Aktiviert!", `${def.name} ist jetzt aktiv.`);
    }
  }

  async function activateFreeze(def: AbilityDefinition, ga: GroupAbility) {
    if (!myGroup || !session) return;
    const myPos = await getCurrentPos();
    if (!myPos) {
      Alert.alert("Fehler", "GPS-Position nicht verfügbar.");
      return;
    }

    const seekerGroups = groups.filter((g) => g.role === "seeker");
    let nearest: { groupId: string; name: string } | null = null;
    let nearestDist = Infinity;

    for (const sg of seekerGroups) {
      const loc = latestLocations.get(sg.id);
      if (!loc) continue;
      const d = haversineDistance(myPos, { lat: loc.lat, lng: loc.lng });
      if (d < nearestDist) {
        nearestDist = d;
        nearest = { groupId: sg.id, name: sg.name };
      }
    }

    if (!nearest) {
      Alert.alert("Kein Ziel", "Kein Detektiv-Standort bekannt.");
      return;
    }

    await recordUsage(def, ga);
    const durationS = def.duration_seconds ?? 180;

    supabase.channel(`game:${session.id}:freeze`).send({
      type: "broadcast",
      event: "freeze_applied",
      payload: { target_group_id: nearest.groupId, duration_s: durationS },
    });

    Alert.alert(
      "❄️ Eingefroren!",
      `${nearest.name} wurde für ${Math.round(durationS / 60)} Min. eingefroren.`
    );
  }

  async function activateInstant(def: AbilityDefinition, ga: GroupAbility) {
    const myPos = await getCurrentPos();
    if (!myPos) {
      Alert.alert("Fehler", "GPS-Position nicht verfügbar.");
      return;
    }

    // All instant abilities need the fugitive's actual current position from DB
    const fugitiveGroup = groups.find((g) => g.role === "fugitive");
    if (!fugitiveGroup) {
      Alert.alert("Fehler", "Kein Flüchtiger gefunden.");
      return;
    }

    const { data: fugLoc } = await supabase
      .from("group_locations")
      .select("lat, lng, recorded_at")
      .eq("group_id", fugitiveGroup.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    if (!fugLoc) {
      Alert.alert(
        "Kein Signal",
        "Noch kein Standort des Flüchtigen verfügbar. Versuche es später erneut."
      );
      return;
    }

    const fugPos = { lat: fugLoc.lat, lng: fugLoc.lng };
    const age = Math.round(
      (Date.now() - new Date(fugLoc.recorded_at).getTime()) / 1000
    );
    const ageLabel = age < 60 ? `vor ${age}s` : `vor ${Math.round(age / 60)} min`;

    if (def.type === "compass") {
      const bearing = bearingDegrees(myPos, fugPos);
      const dir = compassDirection(bearing);
      Alert.alert(
        "🧭 Kompass",
        `Richtung zum Flüchtigen:\n\n${dir}  (${Math.round(bearing)}°)\n\nStandort aktualisiert ${ageLabel}.`
      );
    }

    if (def.type === "distance_reveal") {
      const dist = haversineDistance(myPos, fugPos);
      Alert.alert(
        "📏 Distanz",
        `Entfernung zum Flüchtigen:\n\n${formatDistance(dist)}\n\nStandort aktualisiert ${ageLabel}.`
      );
    }

    if (def.type === "poi_proximity_reveal") {
      if (pois.length === 0) {
        Alert.alert("Keine POIs", "Keine Standorte im Szenario vorhanden.");
        return;
      }
      let closest = pois[0];
      let closestDist = haversineDistance(fugPos, {
        lat: pois[0].lat,
        lng: pois[0].lng,
      });
      for (const poi of pois.slice(1)) {
        const d = haversineDistance(fugPos, { lat: poi.lat, lng: poi.lng });
        if (d < closestDist) {
          closestDist = d;
          closest = poi;
        }
      }
      Alert.alert(
        "📍 POI-Nähe",
        `Der Flüchtige ist in der Nähe von:\n\n${closest.name}\n(${formatDistance(closestDist)} entfernt)\n\nStandort aktualisiert ${ageLabel}.`
      );
    }

    if (def.type === "exact_location") {
      const bearing = bearingDegrees(myPos, fugPos);
      const dist = haversineDistance(myPos, fugPos);
      Alert.alert(
        "🎯 Exakter Standort",
        `Aktueller Standort des Flüchtigen:\n\n` +
          `Richtung: ${compassDirection(bearing)} (${Math.round(bearing)}°)\n` +
          `Entfernung: ${formatDistance(dist)}\n\n` +
          `Standort aktualisiert ${ageLabel}.`
      );
    }

    await recordUsage(def, ga);
  }

  async function activatePlacement(def: AbilityDefinition, ga: GroupAbility) {
    const myPos = await getCurrentPos();
    if (!myPos) {
      Alert.alert("Fehler", "GPS-Position nicht verfügbar. Bitte GPS aktivieren.");
      return;
    }

    const expiresAt = def.duration_seconds
      ? new Date(Date.now() + def.duration_seconds * 1000).toISOString()
      : null;

    const gameArea = session
      ? ((session as any).scenario?.game_area as GeoPolygon | null)
      : null;
    const areaScale = gameArea ? computeGameAreaScale(gameArea) : 1.0;
    const radiusM = Math.round(
      ((def.effect_config?.radius_m as number | undefined) ??
        (def.type === "motion_detector" ? 50 : 100)) * areaScale
    );

    const { error } = await supabase.from("ability_objects").insert({
      session_id: session!.id,
      placed_by_group_id: myGroup!.id,
      type: def.type,
      geometry: { lat: myPos.lat, lng: myPos.lng },
      expires_at: expiresAt,
      metadata: {
        radius_m: radiusM,
        ...(def.type === "trap"
          ? { duration_s: (def.effect_config?.duration_s as number) ?? 300 }
          : {}),
      },
    });

    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }

    await recordUsage(def, ga);

    const label =
      def.type === "exclusion_zone"
        ? `Sperrzone platziert (${radiusM} m Radius)`
        : def.type === "trap"
        ? "Falle platziert an deinem Standort"
        : def.type === "roadblock"
        ? "Straßensperre errichtet"
        : def.type === "motion_detector"
        ? `Bewegungsmelder aktiv (${radiusM} m)`
        : `${def.name} platziert`;

    Alert.alert("Platziert!", label);
  }

  const normal = myAbilities.filter((a) => a.ability?.tier === "normal");
  const ultimate = myAbilities.filter((a) => a.ability?.tier === "ultimate");

  function renderAbility(item: GroupAbility) {
    const def = item.ability;
    if (!def) return null;
    const ready = isCooldownReady(item);
    const remaining = cooldownRemainingSeconds(item);
    const canAfford =
      def.tier !== "ultimate" ||
      (myGroup?.action_points ?? 0) >= (def.ap_cost ?? 0);
    const isPlacement = PLACEMENT_ABILITIES.has(def.type);
    const isInstant = INSTANT_ABILITIES.has(def.type);

    return (
      <TouchableOpacity
        style={[
          styles.card,
          !ready && !isInstant && styles.cardCooldown,
          !canAfford && styles.cardNoAP,
        ]}
        onPress={() => activate(item)}
        disabled={activating === item.id || isOobPunished || isFrozen || isTrapped}
      >
        <View style={styles.cardTop}>
          <Text style={styles.abilityName}>{def.name}</Text>
          {def.tier === "ultimate" ? (
            <Text style={[styles.badge, !canAfford && styles.badgeRed]}>
              ⚡ {def.ap_cost} AP
            </Text>
          ) : (
            <Text style={[styles.badge, ready && styles.badgeGreen]}>
              {ready ? "Bereit" : `${Math.ceil(remaining / 60)}m ${Math.round(remaining % 60)}s`}
            </Text>
          )}
        </View>

        <Text style={styles.abilityDesc}>{def.description}</Text>

        <View style={styles.tagRow}>
          {isPlacement && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>📍 Platzierung</Text>
            </View>
          )}
          {isInstant && (
            <View style={[styles.tag, styles.tagInstant]}>
              <Text style={styles.tagText}>⚡ Sofortergebnis</Text>
            </View>
          )}
          {def.duration_seconds && !isPlacement && (
            <View style={[styles.tag, styles.tagDuration]}>
              <Text style={styles.tagText}>⏱ {def.duration_seconds / 60} min</Text>
            </View>
          )}
        </View>

        {activating === item.id && (
          <ActivityIndicator style={{ marginTop: 8 }} color="#fff" />
        )}
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.apBar}>
        <Text style={styles.apLabel}>Aktionspunkte</Text>
        <Text style={styles.apValue}>⚡ {myGroup?.action_points ?? 0} AP</Text>
      </View>

      {isOobPunished && (
        <View style={styles.oobBanner}>
          <Text style={styles.oobBannerText}>Außerhalb des Spielfelds – Fähigkeiten gesperrt</Text>
        </View>
      )}

      {isFrozen && (
        <View style={styles.frozenBanner}>
          <Text style={styles.frozenBannerText}>❄️ Eingefroren – Fähigkeiten gesperrt</Text>
        </View>
      )}

      {isTrapped && (
        <View style={styles.trapBanner}>
          <Text style={styles.trapBannerText}>🪤 In einer Falle – Fähigkeiten gesperrt</Text>
        </View>
      )}

      {normal.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Normale Fähigkeiten</Text>
          {normal.map((a) => (
            <View key={a.id}>{renderAbility(a)}</View>
          ))}
        </>
      )}

      {ultimate.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Ultimate</Text>
          {ultimate.map((a) => (
            <View key={a.id}>{renderAbility(a)}</View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f23" },
  content: { padding: 16, paddingBottom: 48 },
  oobBanner: {
    backgroundColor: "#CC0000",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  oobBannerText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  frozenBanner: {
    backgroundColor: "#0055AA",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  frozenBannerText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  trapBanner: {
    backgroundColor: "#6B3A2A",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  trapBannerText: { color: "#fff", fontWeight: "700", fontSize: 14 },
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
  sectionTitle: {
    color: "#8888aa",
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    backgroundColor: "#1a1a3e",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  cardCooldown: { opacity: 0.55 },
  cardNoAP: { opacity: 0.45 },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  abilityName: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1 },
  badge: { color: "#8888aa", fontSize: 13, marginLeft: 8 },
  badgeGreen: { color: "#2ECC71", fontWeight: "700" },
  badgeRed: { color: "#E74C3C" },
  abilityDesc: { color: "#aaaacc", fontSize: 13, lineHeight: 18 },
  tagRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  tag: {
    backgroundColor: "rgba(52,152,219,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagInstant: { backgroundColor: "rgba(243,156,18,0.2)" },
  tagDuration: { backgroundColor: "rgba(155,89,182,0.2)" },
  tagText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});

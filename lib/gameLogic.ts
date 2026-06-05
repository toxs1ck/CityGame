import type {
  AbilityDefinition,
  AssignedTask,
  GameSession,
  Group,
  GroupAbility,
  ScenarioSettings,
  SessionSettings,
  Task,
} from "../types/game";
import {
  DEFAULT_DURATION_S,
  DEFAULT_HEADSTART_S,
  DEFAULT_LOCATION_UPDATE_INTERVAL_S,
  DEFAULT_MAX_ACTION_POINTS,
  DEFAULT_REVEAL_INTERVAL_S,
  DEFAULT_TASK_COUNT,
  POI_RADIUS_M,
} from "../constants/game";

export function resolveSettings(
  defaults: ScenarioSettings,
  overrides: SessionSettings
): ScenarioSettings {
  return {
    reveal_interval_s: overrides.reveal_interval_s ?? defaults.reveal_interval_s ?? DEFAULT_REVEAL_INTERVAL_S,
    duration_s: overrides.duration_s ?? defaults.duration_s ?? DEFAULT_DURATION_S,
    task_count: overrides.task_count ?? defaults.task_count ?? DEFAULT_TASK_COUNT,
    max_action_points: overrides.max_action_points ?? defaults.max_action_points ?? DEFAULT_MAX_ACTION_POINTS,
    starting_mode: overrides.starting_mode ?? defaults.starting_mode ?? "headstart",
    headstart_s: overrides.headstart_s ?? defaults.headstart_s ?? DEFAULT_HEADSTART_S,
    poi_radius_m: overrides.poi_radius_m ?? defaults.poi_radius_m ?? POI_RADIUS_M,
    location_update_interval_s:
      overrides.location_update_interval_s ??
      defaults.location_update_interval_s ??
      DEFAULT_LOCATION_UPDATE_INTERVAL_S,
  };
}

/**
 * Task assignment: distribute tasks across groups so no two groups share
 * the same task simultaneously, and POIs are spread across groups.
 *
 * Returns a map of group_id → assigned task ids.
 */
export function assignTasksToGroups(
  groups: Group[],
  tasks: Task[],
  taskCount: number
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const usedTaskIds = new Set<string>();

  // Shuffle tasks for randomness
  const shuffled = [...tasks].sort(() => Math.random() - 0.5);

  // Group tasks by POI to avoid giving same POI's tasks to all groups first
  const byPoi = new Map<string, Task[]>();
  for (const t of shuffled) {
    if (!byPoi.has(t.poi_id)) byPoi.set(t.poi_id, []);
    byPoi.get(t.poi_id)!.push(t);
  }

  const poiOrder = [...byPoi.keys()].sort(() => Math.random() - 0.5);

  for (const group of groups) {
    const assigned: string[] = [];
    const poisUsed = new Set<string>();

    // Round-robin across POIs to spread groups out
    for (const poiId of poiOrder) {
      if (assigned.length >= taskCount) break;
      const poiTasks = byPoi.get(poiId) ?? [];
      const available = poiTasks.find(
        (t) => !usedTaskIds.has(t.id) && !poisUsed.has(t.poi_id)
      );
      if (available) {
        assigned.push(available.id);
        usedTaskIds.add(available.id);
        poisUsed.add(available.poi_id);
      }
    }

    // Fill remaining slots from any unused tasks
    if (assigned.length < taskCount) {
      for (const t of shuffled) {
        if (assigned.length >= taskCount) break;
        if (!usedTaskIds.has(t.id)) {
          assigned.push(t.id);
          usedTaskIds.add(t.id);
        }
      }
    }

    result.set(group.id, assigned);
  }

  return result;
}

/** Pick the next task to assign when a group completes one. */
export function pickNextTask(
  allTasks: Task[],
  currentAssigned: AssignedTask[],
  completedTaskIds: Set<string>
): Task | null {
  const activeTaskIds = new Set(
    currentAssigned
      .filter((a) => a.status === "active")
      .map((a) => a.task_id)
  );
  const activePois = new Set(
    currentAssigned
      .filter((a) => a.status === "active")
      .map((a) => a.task?.poi_id)
      .filter(Boolean) as string[]
  );

  // Prefer tasks from POIs not already in the active queue
  const candidates = allTasks.filter(
    (t) => !activeTaskIds.has(t.id) && !completedTaskIds.has(t.id)
  );

  const fresh = candidates.find((t) => !activePois.has(t.poi_id));
  return fresh ?? candidates[0] ?? null;
}

export function isCooldownReady(ability: GroupAbility): boolean {
  if (!ability.last_used_at || !ability.ability?.cooldown_seconds) return true;
  const elapsed = (Date.now() - new Date(ability.last_used_at).getTime()) / 1000;
  return elapsed >= ability.ability.cooldown_seconds;
}

export function cooldownRemainingSeconds(ability: GroupAbility): number {
  if (!ability.last_used_at || !ability.ability?.cooldown_seconds) return 0;
  const elapsed = (Date.now() - new Date(ability.last_used_at).getTime()) / 1000;
  return Math.max(0, ability.ability.cooldown_seconds - elapsed);
}

export function isSessionHost(session: GameSession, deviceId: string): boolean {
  return session.mode === "host" && session.host_device_id === deviceId;
}

export function isSessionGm(session: GameSession, userId: string | null): boolean {
  return session.mode === "managed" && session.gm_id === userId;
}

export function canControl(
  session: GameSession,
  deviceId: string,
  userId: string | null
): boolean {
  return isSessionHost(session, deviceId) || isSessionGm(session, userId);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s > 0 ? `${s}s` : ""}`.trim();
  return `${s}s`;
}

export function generateJoinCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

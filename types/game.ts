export type SessionMode = "managed" | "host";
export type SessionStatus = "lobby" | "active" | "finished" | "aborted";
export type GroupRole = "fugitive" | "seeker" | "unassigned";
export type TaskType = "multiple_choice" | "photo" | "text_answer";
export type TaskStatus = "active" | "completed" | "skipped";
export type CompletionStatus = "pending" | "approved" | "rejected";
export type AbilityTier = "normal" | "ultimate";
export type StartingMode = "headstart" | "starting_points";

export interface Profile {
  id: string;
  username: string | null;
  is_gm: boolean;
  created_at: string;
}

export type AbilityType =
  // Seeker normal
  | "compass"
  | "distance_reveal"
  | "poi_proximity_reveal"
  | "stealth"
  | "motion_detector"
  | "trail_reader"
  // Seeker ultimate
  | "exclusion_zone"
  | "exact_location"
  | "drone_view"
  | "tripwire"
  // Fugitive normal
  | "zone_pass"
  | "radar_jam"
  | "freeze"
  | "trap"
  | "reveal_static"
  // Fugitive ultimate
  | "skip_ping"
  | "dark_mode"
  | "roadblock";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface ScenarioSettings {
  reveal_interval_s: number;
  duration_s: number;
  task_count: number;
  max_action_points: number;
  starting_mode: StartingMode;
  headstart_s: number;
  poi_radius_m: number;
  location_update_interval_s: number;
  catch_window_s: number;
  catch_radius_m: number;
  auto_fugitive: boolean;
}

export interface Scenario {
  id: string;
  created_by: string | null;
  name: string;
  description: string;
  game_area: GeoPolygon | null;
  default_settings: ScenarioSettings;
  is_public: boolean;
  created_at: string;
}

export interface POI {
  id: string;
  scenario_id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
}

export interface StartingPoint {
  id: string;
  scenario_id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface MultipleChoiceContent {
  options: string[];
  correct_index: number;
}

export interface TextAnswerContent {
  expected_answer: string;
  case_sensitive: boolean;
}

export interface PhotoContent {
  hint: string;
}

export interface Task {
  id: string;
  poi_id: string;
  type: TaskType;
  title: string;
  description: string;
  content: MultipleChoiceContent | TextAnswerContent | PhotoContent;
  action_points: number;
  poi?: POI;
}

export interface AbilityDefinition {
  id: string;
  scenario_id: string | null;
  name: string;
  description: string;
  tier: AbilityTier;
  type: AbilityType;
  cooldown_seconds: number | null;
  ap_cost: number | null;
  duration_seconds: number | null;
  effect_config: Record<string, unknown>;
  for_role: GroupRole | "both";
}

export interface SessionSettings extends Partial<ScenarioSettings> {
  available_ability_ids?: string[];
  selected_poi_ids?: string[];
}

export interface GameSession {
  id: string;
  scenario_id: string;
  gm_id: string | null;
  host_device_id: string | null;
  mode: SessionMode;
  status: SessionStatus;
  join_code: string;
  settings: SessionSettings;
  started_at: string | null;
  finished_at: string | null;
  scenario?: Scenario;
}

export interface Group {
  id: string;
  session_id: string;
  name: string;
  role: GroupRole;
  action_points: number;
  color: string;
  device_id: string;
  joined_at: string;
  starting_point_id: string | null;
}

export interface GroupLocation {
  id: string;
  group_id: string;
  session_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
  group?: Group;
}

export interface AssignedTask {
  id: string;
  group_id: string;
  task_id: string;
  session_id: string;
  status: TaskStatus;
  assigned_at: string;
  completed_at: string | null;
  task?: Task;
}

export interface TaskCompletion {
  id: string;
  assigned_task_id: string;
  session_id: string;
  submitted_at: string;
  submission_data: { answer?: string; photo_url?: string };
  status: CompletionStatus;
  points_awarded: number;
}

export interface GroupAbility {
  id: string;
  group_id: string;
  session_id: string;
  ability_id: string;
  last_used_at: string | null;
  ability?: AbilityDefinition;
}

export interface ActiveAbility {
  id: string;
  group_id: string;
  session_id: string;
  ability_id: string;
  activated_at: string;
  expires_at: string | null;
  ability?: AbilityDefinition;
}

export interface AbilityObject {
  id: string;
  session_id: string;
  placed_by_group_id: string;
  type: AbilityType;
  geometry: GeoPoint | { points: GeoPoint[] };
  expires_at: string | null;
  metadata: Record<string, unknown>;
}

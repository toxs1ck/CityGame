-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- SCENARIOS
-- ============================================================
create table scenarios (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text not null default '',
  game_area jsonb,
  default_settings jsonb not null default '{}',
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- POINTS OF INTEREST
-- ============================================================
create table pois (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  name text not null,
  description text not null default '',
  lat float8 not null,
  lng float8 not null
);

-- ============================================================
-- STARTING POINTS (for starting_points mode)
-- ============================================================
create table starting_points (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  name text not null,
  lat float8 not null,
  lng float8 not null
);

-- ============================================================
-- TASKS
-- ============================================================
create table tasks (
  id uuid primary key default gen_random_uuid(),
  poi_id uuid not null references pois(id) on delete cascade,
  type text not null check (type in ('multiple_choice', 'photo', 'text_answer')),
  title text not null,
  description text not null default '',
  content jsonb not null default '{}',
  action_points int not null default 1
);

-- ============================================================
-- ABILITY DEFINITIONS
-- ============================================================
create table ability_definitions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references scenarios(id) on delete cascade,
  name text not null,
  description text not null default '',
  tier text not null check (tier in ('normal', 'ultimate')),
  type text not null,
  cooldown_seconds int,
  ap_cost int,
  duration_seconds int,
  effect_config jsonb not null default '{}',
  for_role text not null default 'both' check (for_role in ('fugitive', 'seeker', 'both'))
);

-- ============================================================
-- GAME SESSIONS
-- ============================================================
create table game_sessions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id),
  gm_id uuid references auth.users(id) on delete set null,
  host_device_id text,
  mode text not null check (mode in ('managed', 'host')),
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  join_code text not null,
  settings jsonb not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint unique_active_join_code unique (join_code, status)
);

create index idx_sessions_join_code on game_sessions(join_code) where status != 'finished';

-- ============================================================
-- GROUPS
-- ============================================================
create table groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions(id) on delete cascade,
  name text not null,
  role text not null default 'unassigned' check (role in ('fugitive', 'seeker', 'unassigned')),
  action_points int not null default 0,
  color text not null default '#3498DB',
  device_id text not null,
  joined_at timestamptz not null default now()
);

create index idx_groups_session on groups(session_id);
create index idx_groups_device on groups(device_id);

-- ============================================================
-- GROUP LOCATIONS
-- ============================================================
create table group_locations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  session_id uuid not null references game_sessions(id) on delete cascade,
  lat float8 not null,
  lng float8 not null,
  recorded_at timestamptz not null default now()
);

create index idx_locations_session_group_time
  on group_locations(session_id, group_id, recorded_at desc);

-- ============================================================
-- ASSIGNED TASKS (per group task queue)
-- ============================================================
create table group_assigned_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  session_id uuid not null references game_sessions(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'skipped')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_assigned_tasks_group on group_assigned_tasks(group_id, status);
-- Prevent duplicate active assignments of the same task across groups
create unique index idx_unique_active_task
  on group_assigned_tasks(task_id, session_id)
  where status = 'active';

-- ============================================================
-- TASK COMPLETIONS
-- ============================================================
create table task_completions (
  id uuid primary key default gen_random_uuid(),
  assigned_task_id uuid not null references group_assigned_tasks(id) on delete cascade,
  session_id uuid not null references game_sessions(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  submission_data jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  points_awarded int not null default 0
);

-- ============================================================
-- GROUP ABILITIES (selected in lobby)
-- ============================================================
create table group_abilities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  session_id uuid not null references game_sessions(id) on delete cascade,
  ability_id uuid not null references ability_definitions(id) on delete cascade,
  last_used_at timestamptz,
  unique (group_id, ability_id)
);

-- ============================================================
-- ACTIVE ABILITIES (currently in effect)
-- ============================================================
create table active_abilities (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  session_id uuid not null references game_sessions(id) on delete cascade,
  ability_id uuid not null references ability_definitions(id) on delete cascade,
  activated_at timestamptz not null default now(),
  expires_at timestamptz
);

-- ============================================================
-- ABILITY OBJECTS (placed on the map: detectors, traps, zones...)
-- ============================================================
create table ability_objects (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions(id) on delete cascade,
  placed_by_group_id uuid not null references groups(id) on delete cascade,
  type text not null,
  geometry jsonb not null,
  expires_at timestamptz,
  metadata jsonb not null default '{}'
);

create index idx_ability_objects_session on ability_objects(session_id);

-- ============================================================
-- SEED: Global ability definitions
-- ============================================================
insert into ability_definitions
  (name, description, tier, type, cooldown_seconds, ap_cost, duration_seconds, effect_config, for_role)
values
  -- Seeker Normal
  ('Kompass',           'Erhalte eine Richtungsangabe zu den Flüchtigen.',                                  'normal',   'compass',               900,  null, null, '{}', 'seeker'),
  ('Distanz',           'Erhalte die aktuelle Entfernung zu den Flüchtigen.',                               'normal',   'distance_reveal',       600,  null, null, '{}', 'seeker'),
  ('POI-Nähe',          'Erhalte eine Info darüber, in der Nähe welches POI sich die Flüchtigen aufhalten.','normal',   'poi_proximity_reveal',  900,  null, null, '{}', 'seeker'),
  ('Tarnmodus',         'Verberge deine Position für 5 Minuten vor den anderen Gruppen.',                   'normal',   'stealth',               900,  null, 300,  '{}', 'seeker'),
  ('Bewegungsmelder',   'Platziere einen verborgenen Bewegungsmelder mit 50 m Radius.',                     'normal',   'motion_detector',       900,  null, null, '{"radius_m": 50}', 'seeker'),
  ('Fährtenleser',      'Decke die frischeste Spur der Flüchtigen in 50 m Radius auf.',                    'normal',   'trail_reader',          900,  null, null, '{"radius_m": 50}', 'seeker'),
  -- Seeker Ultimate
  ('Sperrzone',         'Sperre eine Zone des Spielbereichs für 20 Minuten.',                               'ultimate', 'exclusion_zone',        null, 2,    1200, '{}', 'seeker'),
  ('Exakter Standort',  'Erhalte den genauen Standort der Flüchtigen.',                                     'ultimate', 'exact_location',        null, 3,    null, '{}', 'seeker'),
  ('Drohnensicht',      'Decke 3 Bereiche mit 50 m Durchmesser für 2 Minuten auf.',                        'ultimate', 'drone_view',            null, 3,    120,  '{"area_count": 3, "radius_m": 50}', 'seeker'),
  ('Stolperdraht',      'Stelle bis zu 2 Verbindungen her, die bei Durchquerung der Flüchtigen alarmieren.','ultimate', 'tripwire',              null, 2,    null, '{"max_wires": 2}', 'seeker'),
  -- Fugitive Normal
  ('Durchquerung',      'Erlaubt es, eine Sperrzone auf direktem Weg zu durchqueren.',                      'normal',   'zone_pass',             1200, null, null, '{}', 'fugitive'),
  ('Radarstörung',      'Die nächste Standortmeldung ist auf 50 Meter ungenau.',                            'normal',   'radar_jam',             900,  null, null, '{"offset_m": 50}', 'fugitive'),
  ('Einfrieren',        'Verhindere die Bewegung einer Detektivgruppe für 3 Minuten.',                      'normal',   'freeze',                900,  null, 180,  '{}', 'fugitive'),
  ('Fallen legen',      'Platziere bis zu 2 Fallen, die eine Detektivgruppe 5 Minuten festhält.',           'normal',   'trap',                  600,  null, 300,  '{"max_traps": 2}', 'fugitive'),
  ('Offenlegung',       'Deckt statische Fähigkeiten in 100 m Radius auf; ermöglicht Hacking.',             'normal',   'reveal_static',         600,  null, null, '{"radius_m": 100}', 'fugitive'),
  -- Fugitive Ultimate
  ('Ping-Block',        'Der nächste reguläre Ping wird ausgesetzt.',                                        'ultimate', 'skip_ping',             null, 1,    null, '{}', 'fugitive'),
  ('Dark Modus',        'Für 5 Minuten werden die Positionen aller Gruppen verborgen.',                     'ultimate', 'dark_mode',             null, 3,    300,  '{}', 'fugitive'),
  ('Straßensperre',     'An deiner aktuellen Position wird eine Straßensperre errichtet.',                  'ultimate', 'roadblock',             null, 2,    null, '{}', 'fugitive');

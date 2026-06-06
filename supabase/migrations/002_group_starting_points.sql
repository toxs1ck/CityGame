-- Add starting point assignment column to groups
alter table groups
  add column starting_point_id uuid references starting_points(id) on delete set null;

import { useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";
import { useGameStore } from "../store/gameStore";
import { pickNextTask } from "../lib/gameLogic";
import type { AssignedTask, Task } from "../types/game";

export function useTaskSubscription() {
  const { myGroup, setMyTasks } = usePlayerStore();
  const { session } = useGameStore();

  const loadTasks = useCallback(async () => {
    if (!myGroup || !session) return;
    const { data } = await supabase
      .from("group_assigned_tasks")
      .select("*, task:tasks(*, poi:pois(*))")
      .eq("group_id", myGroup.id)
      .eq("session_id", session.id)
      .order("assigned_at");
    if (data) setMyTasks(data as AssignedTask[]);
  }, [myGroup?.id, session?.id]);

  const autoRefill = useCallback(async () => {
    if (!myGroup || !session) return;

    const { data: current } = await supabase
      .from("group_assigned_tasks")
      .select("*, task:tasks(*, poi:pois(*))")
      .eq("group_id", myGroup.id)
      .eq("session_id", session.id);

    if (!current) return;
    if (current.some((t) => t.status === "active")) return;

    const completedIds = new Set(current.map((t: AssignedTask) => t.task_id));

    const { data: allTasks } = await supabase
      .from("tasks")
      .select("*, poi:pois!inner(*)")
      .eq("poi.scenario_id", session.scenario_id);

    if (!allTasks || allTasks.length === 0) return;

    const next = pickNextTask(allTasks as Task[], current as AssignedTask[], completedIds);
    if (!next) return;

    await supabase.from("group_assigned_tasks").insert({
      group_id: myGroup.id,
      task_id: next.id,
      session_id: session.id,
      status: "active",
    });
  }, [myGroup?.id, session?.id, session?.scenario_id]);

  useEffect(() => {
    if (!myGroup || !session || session.status !== "active") return;

    loadTasks();

    const channel = supabase
      .channel(`tasks:${myGroup.id}:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "group_assigned_tasks",
          filter: `group_id=eq.${myGroup.id}`,
        },
        async (payload) => {
          await loadTasks();
          if (payload.eventType === "UPDATE" && (payload.new as any).status === "completed") {
            await autoRefill();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [myGroup?.id, session?.id, session?.status]);
}

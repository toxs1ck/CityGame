import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { usePlayerStore } from "../store/playerStore";

/**
 * Call once at the root layout. Subscribes to Supabase auth state changes
 * and keeps the playerStore's user/profile/authLoaded fields in sync.
 */
export function useAuth() {
  const { setUser, setProfile, setAuthLoaded } = usePlayerStore();

  useEffect(() => {
    let mounted = true;

    async function fetchProfile(userId: string) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (mounted) setProfile(data ?? null);
    }

    // Resolve initial session (AsyncStorage read — fast)
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) await fetchProfile(u.id);
      setAuthLoaded(true);
    });

    // Keep in sync for sign-in / sign-out while app is open
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchProfile(u.id); // non-blocking; layout handles the loading state
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);
}

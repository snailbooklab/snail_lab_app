import { supabase } from "../lib/supabase";

export async function upsertPushToken(token: string): Promise<void> {
  const { error } = await supabase.from("expo_push_tokens").upsert({ token }, { onConflict: "token" });
  if (error) throw new Error(error.message);
}

// choi-media 웹의 app/admin/calendar/_actions/schedules.ts와 동일한 쿼리를 Server Action 대신
// supabase-js로 직접 호출한다 (RLS가 authenticated role만 보므로 로그인한 세션이면 그대로 동작).

import { supabase } from "../lib/supabase";
import type { RecurringScheduleInput, ScheduleInput, ScheduleItem } from "../types";

export async function getSchedules(range?: { from: string; to: string }): Promise<ScheduleItem[]> {
  let query = supabase
    .from("schedules")
    .select("id, date, title, memo, remind_at, created_at")
    .order("date", { ascending: true });
  if (range) query = query.gte("date", range.from).lte("date", range.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** 알림 동기화용 — 지금부터 7일 이내의 remind_at만(달력에 보이는 월 범위와 무관).
 *  1년치를 한꺼번에 로컬알람으로 등록하지 않고 "가까운 일주일치"만 등록한다. 앱을 열거나
 *  일정이 바뀔 때마다(App.tsx 포그라운드 재동기화 / FCM 백그라운드 태스크) 현재 시점 기준으로
 *  다시 조회·재등록되므로 창(window)이 자동으로 앞으로 굴러간다. */
const REMINDER_WINDOW_DAYS = 7;
export async function getUpcomingReminders(): Promise<Pick<ScheduleItem, "id" | "title" | "remind_at">[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("schedules")
    .select("id, title, remind_at")
    .not("remind_at", "is", null)
    .gte("remind_at", now.toISOString())
    .lte("remind_at", horizon.toISOString())
    .order("remind_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSchedule(input: ScheduleInput) {
  const { data, error } = await supabase
    .from("schedules")
    .insert({
      date: input.date,
      title: input.title,
      memo: input.memo || null,
      ...(input.remindAt !== undefined ? { remind_at: input.remindAt, remind_sent: false } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSchedule(id: string, input: ScheduleInput) {
  const { error } = await supabase
    .from("schedules")
    .update({
      date: input.date,
      title: input.title,
      memo: input.memo || null,
      ...(input.remindAt !== undefined ? { remind_at: input.remindAt, remind_sent: false } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { id };
}

/** 반복 일정 — 계산된 날짜 목록만큼 schedules 행을 한 번에 만든다. */
export async function createRecurringSchedules(input: RecurringScheduleInput): Promise<{ created: number }> {
  const rows = input.dates.map((d) => ({
    date: d.date,
    title: input.title,
    memo: input.memo || null,
    remind_at: d.remindAt,
    remind_sent: false,
  }));

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("schedules").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }

  return { created: rows.length };
}

export async function deleteSchedule(id: string) {
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { id };
}

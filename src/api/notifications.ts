// choi-media 웹의 app/admin/notifications/_actions/notifications.ts와 같은 쿼리를 Server Action
// 대신 supabase-js로 직접 호출한다 (RLS가 authenticated role만 보므로 로그인 세션이면 그대로 동작).

import { supabase } from "../lib/supabase";
import {
  NOTIFICATION_COLUMNS,
  type NotificationCategory,
  type NotificationEvent,
  type ScheduleFromEventInput,
} from "../types";

const LIST_LIMIT = 200;

export async function getNotifications(): Promise<NotificationEvent[]> {
  // status='filtered'는 걸러진 원문까지 저장하던 시절의 과거 행이라 목록에서 뺀다(웹과 동일).
  const { data, error } = await supabase
    .from("notification_events")
    .select(NOTIFICATION_COLUMNS)
    .neq("status", "filtered")
    .order("posted_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as NotificationEvent[];
}

/** 메뉴 뱃지용 — 목록 전체를 받지 않고 "미확인 몇 건"만 센다. */
export async function getUnhandledCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notification_events")
    .select("id", { count: "exact", head: true })
    .neq("status", "filtered")
    .eq("handled", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** "확인 완료" — 읽음과 처리 완료를 한 상태로 합쳐서 다룬다. */
export async function setHandled(id: string, handled: boolean) {
  const { error } = await supabase
    .from("notification_events")
    .update({ handled, is_read: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 전체 읽음 — 남아 있는 미확인을 한 번에 확인 완료로. */
export async function markAllHandled(): Promise<void> {
  const { error } = await supabase
    .from("notification_events")
    .update({ handled: true, is_read: true })
    .eq("handled", false)
    .neq("status", "filtered");
  if (error) throw new Error(error.message);
}

/** AI가 잘못 분류했을 때 직접 교정. */
export async function setCategory(id: string, category: NotificationCategory) {
  const { error } = await supabase
    .from("notification_events")
    .update({ category, status: "classified", confidence: 1, error: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * 알림에서 뽑은 값으로 schedules에 일정을 만들고 알림과 연결한다.
 * 웹과 같은 두 단계(일정 insert → 알림에 schedule_id 연결)라, 어느 쪽에서 만들든 결과가 같다.
 */
export async function createScheduleFromEvent(input: ScheduleFromEventInput) {
  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      date: input.date,
      title: input.title,
      memo: input.memo || null,
      remind_at: input.remindAt,
      remind_sent: false,
    })
    .select("id")
    .single();
  if (scheduleError) throw new Error(scheduleError.message);

  const { error } = await supabase
    .from("notification_events")
    .update({ schedule_id: schedule.id, handled: true, is_read: true })
    .eq("id", input.id);
  if (error) throw new Error(error.message);

  return schedule;
}

// choi-media 웹의 app/admin/calendar/_lib/shared.tsx에서 순수 로직만 포팅.

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** date input 값 검증 — 잘못된/불완전한 값을 걸러낸다. */
export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !isNaN(new Date(`${v}T00:00:00`).getTime());
}

// 알림 날짜는 항상 일정 당일로 고정 — 시각(시/분)만 선택 가능.
export const DEFAULT_REMINDER_HOUR = 7;
export const DEFAULT_REMINDER_MINUTE = 0;

export function reminderIsoFor(date: string, hour: number = DEFAULT_REMINDER_HOUR, minute: number = DEFAULT_REMINDER_MINUTE): string {
  return new Date(`${date}T${pad(hour)}:${pad(minute)}:00`).toISOString();
}

/** remind_at(ISO)에서 로컬 시/분을 추출 — 수정 화면에서 기존 알림 시각을 시간 선택기에 채우는 용도. */
export function hourMinuteFromIso(iso: string): { hour: number; minute: number } {
  const d = new Date(iso);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

/** 24시간제 시/분을 "오전/오후 h:mm" 형식으로. */
export function formatAmPmTime(hour: number, minute: number): string {
  const period = hour < 12 ? "오전" : "오후";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${h12}:${pad(minute)}`;
}

// 반복 일정 최대 생성 개수(약 2년치 주간 반복) — 실수로 종료일을 너무 멀리 잡는 걸 방지.
export const MAX_RECURRING_DATES = 104;

/** start와 같은 요일로, start부터 end까지 매주 반복되는 날짜 목록(YYYY-MM-DD, start 포함). */
export function datesWeekly(start: string, end: string): string[] {
  if (end < start) return [start];
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cur <= endDate && dates.length < MAX_RECURRING_DATES) {
    dates.push(toISO(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return dates;
}

/** base 월에서 offset개월만큼 이동한 { year, month }. */
export function shiftMonth(base: Date, offset: number): { year: number; month: number } {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function fmtSelected(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const last = new Date(year, month + 1, 0);
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));

  const days: Date[] = [];
  const cur = new Date(gridStart);
  while (cur <= gridEnd) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

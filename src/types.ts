export type ScheduleItem = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  memo: string | null;
  remind_at: string | null; // ISO datetime — 설정 시 이 시각에 로컬 알림 발송
  created_at: string;
};

export type ScheduleInput = {
  date: string;
  title: string;
  memo?: string;
  /** 지정하지 않으면(undefined) 기존 알림 설정을 건드리지 않는다. null이면 알림 해제. */
  remindAt?: string | null;
};

export type RecurringScheduleInput = {
  title: string;
  memo?: string;
  dates: { date: string; remindAt: string | null }[];
};

// ---------------------------------------------------------------------------
// 알림함(notification_events) — choi-media 웹 app/_lib/notifications.ts와 같은 정의.
// 이 앱이 가로채 보낸 카톡·문자가 서버에서 분류돼 돌아오는 형태다.
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  "강의문의",
  "시간조율",
  "강의취소",
  "강사모집",
  "강의확정",
  "정산/계약",
  "기타",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** "filtered"는 1차 필터를 저장 뒤에 돌리던 시절의 과거 값 — 목록에서 제외한다. */
export type NotificationStatus = "pending" | "classified" | "filtered" | "error";

export type NotificationSource = "kakao" | "sms" | "band" | "other";

export type NotificationExtracted = {
  org: string | null;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:mm
  audience: string | null;
  headcount: number | null;
  contact: string | null;
  amount: string | null;
};

export type NotificationEvent = {
  id: string;
  source: NotificationSource;
  sender: string | null;
  body: string;
  posted_at: string;
  status: NotificationStatus;
  category: NotificationCategory | null;
  summary: string | null;
  extracted: NotificationExtracted | null;
  is_read: boolean;
  handled: boolean;
  schedule_id: string | null;
  error: string | null;
};

/** 목록에서 실제로 쓰는 컬럼만. 웹과 달리 기기·필터 관련 컬럼은 화면에 안 쓰므로 받지 않는다. */
export const NOTIFICATION_COLUMNS =
  "id, source, sender, body, posted_at, status, category, summary, extracted, " +
  "is_read, handled, schedule_id, error";

export const SOURCE_LABELS: Record<NotificationSource, string> = {
  kakao: "카톡",
  sms: "문자",
  band: "밴드",
  other: "기타",
};

export type ScheduleFromEventInput = {
  id: string;
  date: string;
  title: string;
  memo?: string;
  /** ISO datetime. null이면 알림 없음. */
  remindAt: string | null;
};

// ---------------------------------------------------------------------------
// 일정표 사진 → 일정 초안 (choi-media 웹 /api/schedules/parse-image 응답과 같은 정의).
// ---------------------------------------------------------------------------

export type DraftConfidence = "high" | "medium" | "low";

export type DraftEvent = {
  date: string | null; // YYYY-MM-DD — 못 읽었으면 null
  title: string; // 시각이 있으면 "10:00 ○○초 강의"처럼 제목 앞에 붙어서 온다
  memo: string | null;
  confidence: DraftConfidence;
};

export type ScheduleExtraction = {
  events: DraftEvent[];
  notes: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number | null;
};

export type BulkScheduleRow = {
  date: string;
  title: string;
  memo?: string;
  /** ISO datetime. null이면 알림 없음. */
  remindAt: string | null;
};

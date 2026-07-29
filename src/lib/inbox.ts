// 알림함 표시용 값 — 웹의 app/admin/notifications/_lib/shared.ts에 대응(색은 앱 팔레트로).

import { pad } from "./calendar";
import type { NotificationCategory } from "../types";

/** 카테고리별 칩 색 — 목록을 훑을 때 유형이 색으로 먼저 읽히도록. */
export const CATEGORY_COLORS: Record<NotificationCategory, { bg: string; text: string }> = {
  강의문의: { bg: "#ffe6da", text: "#9a3411" },
  시간조율: { bg: "#dfebfb", text: "#1b4a88" },
  강의취소: { bg: "#fbdcd8", text: "#a32b1c" },
  강사모집: { bg: "#fdeacd", text: "#8a5a12" },
  강의확정: { bg: "#dff1e4", text: "#215d34" },
  "정산/계약": { bg: "#f3ecd8", text: "#6b5a24" },
  기타: { bg: "#efe9dd", text: "#6b6250" },
};

/** 알림이 뜬 시각을 "방금 / 12분 전 / 3시간 전 / 어제 14:30 / 7월 12일" 로. */
export function fmtWhen(iso: string): string {
  const then = new Date(iso);
  const diffMin = Math.floor((Date.now() - then.getTime()) / 60_000);

  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;

  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return `${Math.floor(diffMin / 60)}시간 전`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (isYesterday) return `어제 ${pad(then.getHours())}:${pad(then.getMinutes())}`;

  return `${then.getMonth() + 1}월 ${then.getDate()}일`;
}

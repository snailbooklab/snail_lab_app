// 일정표 사진을 choi-media 웹 서버(/api/schedules/parse-image)로 보내 Claude 비전 분석 결과를 받는다.
// Anthropic API 키는 서버에만 있다 — 앱은 로그인 세션 토큰으로 자기 신원만 증명한다.

import { supabase } from "../lib/supabase";
import type { ScheduleExtraction } from "../types";

export type ScheduleImagePayload = { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };

function webBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // 인제스트 엔드포인트와 같은 서버이므로 거기서 origin만 빌려 쓴다.
  const ingest = process.env.EXPO_PUBLIC_INGEST_ENDPOINT;
  if (ingest) return new URL(ingest).origin;
  throw new Error("EXPO_PUBLIC_WEB_BASE_URL이 설정되지 않았습니다 (.env 확인).");
}

export async function parseScheduleImages(
  images: ScheduleImagePayload[],
  hint: string | null,
): Promise<ScheduleExtraction> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");

  const res = await fetch(`${webBaseUrl()}/api/schedules/parse-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ images, hint }),
  });

  const json = (await res.json().catch(() => null)) as (ScheduleExtraction & { error?: string }) | null;
  if (!res.ok || !json) {
    throw new Error(json?.error ?? `서버 오류 (${res.status})`);
  }
  return json;
}

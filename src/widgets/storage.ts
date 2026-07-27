// 위젯은 앱과 별개의 headless JS 태스크에서 렌더링된다 — 앱이 떠 있지 않을 수도 있으므로
// Supabase를 직접 조회하지 않고, 앱이 미리 채워둔 AsyncStorage 캐시만 읽는다.
// (네트워크·인증 세션에 의존하면 잠금화면에서 빈 위젯이 뜨는 경우가 생긴다.)

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScheduleItem } from "../types";

const CACHE_KEY = "widget:schedules:v1";

/** 오늘 하루치만 캐시하면 자정을 넘겼는데 앱이 안 열린 경우 어제 것이 그대로 남는다.
 *  며칠치를 담아두고 렌더링 시점에 "오늘" 날짜로 골라내면 날짜가 저절로 굴러간다. */
export const WIDGET_CACHE_DAYS = 14;

export type WidgetSchedule = Pick<ScheduleItem, "id" | "date" | "title">;

type WidgetCache = {
  /** 캐시를 채운 시각(ISO) — 너무 오래된 캐시인지 판단하는 용도. */
  updatedAt: string;
  items: WidgetSchedule[];
};

export async function writeWidgetCache(items: WidgetSchedule[]): Promise<void> {
  const cache: WidgetCache = { updatedAt: new Date().toISOString(), items };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function readWidgetCache(): Promise<WidgetCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WidgetCache;
    if (!Array.isArray(parsed?.items)) return null;
    return parsed;
  } catch {
    // 캐시가 깨졌으면 없는 것으로 취급 — 위젯이 죽는 것보단 빈 상태로 뜨는 게 낫다.
    return null;
  }
}

/** 캐시에서 특정 날짜(YYYY-MM-DD)의 일정만. */
export function schedulesOn(cache: WidgetCache | null, date: string): WidgetSchedule[] {
  if (!cache) return [];
  return cache.items.filter((s) => s.date === date);
}

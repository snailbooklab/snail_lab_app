// 공공데이터포털 "특일 정보" API(getRestDeInfo)로 그 해의 공휴일을 받아온다.
// 응답 한 건: { dateKind: "01", dateName: "추석", isHoliday: "Y", locdate: 20260925, seq: 1 }
//
// 달력은 네트워크 없이도 떠야 하므로 받아온 결과는 연도별로 AsyncStorage에 넣어두고,
// 다음에 켤 땐 캐시를 먼저 쓴다(오프라인이면 만료된 캐시라도 쓴다).

import AsyncStorage from "@react-native-async-storage/async-storage";

const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

// 공공데이터포털이 발급하는 "Encoding" 키를 그대로 쓴다 — 이미 퍼센트 인코딩된 문자열이라
// encodeURIComponent를 다시 걸면 %2B가 %252B가 돼서 인증에 실패한다.
const SERVICE_KEY = process.env.EXPO_PUBLIC_HOLIDAY_API_KEY;

/** 캐시 버전 — 아래 파싱/필터 규칙을 바꾸면 올려서 옛 캐시를 버린다. */
const CACHE_VERSION = 1;
/** 임시공휴일이 중간에 지정될 수 있어 주 단위로 다시 확인한다. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * getRestDeInfo는 이 둘도 isHoliday=Y로 주지만 달력상 빨간날이 아니다.
 * 제헌절은 국경일이긴 해도 2008년부터 공휴일이 아니고, 노동절(근로자의 날)은 공휴일도 국경일도 아니다.
 * 둘의 "대체공휴일(제헌절)", "대체공휴일(노동절)"까지 함께 걸러야 한다.
 */
const NOT_RED_DAYS = ["제헌절", "노동절"];

/** 달력 칸에 쓰기엔 낯선 API 표기를 흔히 쓰는 이름으로. */
const RENAME: Record<string, string> = {
  "1월1일": "신정",
  기독탄신일: "성탄절",
  전국동시지방선거: "선거일",
  국회의원선거: "선거일",
  대통령선거: "선거일",
};

/** "YYYY-MM-DD" → 공휴일 이름. */
export type HolidayMap = Record<string, string>;

type CacheEntry = { at: number; map: HolidayMap };

function cacheKey(year: number): string {
  return `holidays:v${CACHE_VERSION}:${year}`;
}

async function readCache(year: number): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(year));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    return parsed && typeof parsed.at === "number" && parsed.map ? parsed : null;
  } catch {
    return null;
  }
}

/** "대체공휴일(삼일절)" → { name: "대체공휴일", origin: "삼일절" }. 달력 칸이 좁아 괄호 앞만 쓴다. */
function parseName(dateName: string): { name: string; origin: string } {
  const m = dateName.trim().match(/^(.*?)\s*\((.*)\)$/);
  const base = (m ? m[1] : dateName).trim();
  const origin = (m ? m[2] : "").trim();
  return { name: RENAME[base] ?? base, origin };
}

async function fetchYear(year: number): Promise<HolidayMap> {
  const url =
    `${ENDPOINT}?serviceKey=${SERVICE_KEY}&solYear=${year}&numOfRows=100&_type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`특일 정보 API ${res.status}`);

  // 키가 잘못됐거나 서버가 막히면 _type=json이어도 XML 에러 문서가 온다.
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`특일 정보 API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`);
  }

  const code = json?.response?.header?.resultCode;
  if (code && code !== "00") {
    throw new Error(`특일 정보 API 오류(${code}): ${json?.response?.header?.resultMsg ?? ""}`);
  }

  // 결과가 하나면 배열이 아니라 객체로, 없으면 빈 문자열("")로 온다.
  const raw = json?.response?.body?.items?.item;
  const items: any[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];

  const map: HolidayMap = {};
  for (const item of items) {
    if (item?.isHoliday !== "Y") continue;
    const { name, origin } = parseName(String(item.dateName ?? ""));
    if (!name || NOT_RED_DAYS.includes(name) || NOT_RED_DAYS.includes(origin)) continue;
    const d = String(item.locdate ?? "");
    if (!/^\d{8}$/.test(d)) continue;
    map[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`] = name;
  }
  return map;
}

/** 한 해의 공휴일. 캐시가 살아 있으면 네트워크를 타지 않는다. */
export async function getHolidays(year: number): Promise<HolidayMap> {
  const cached = await readCache(year);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.map;

  // 키가 없으면(로컬 .env.local 누락 등) 공휴일만 빠지고 달력은 그대로 동작한다.
  if (!SERVICE_KEY) return cached?.map ?? {};

  try {
    const map = await fetchYear(year);
    await AsyncStorage.setItem(cacheKey(year), JSON.stringify({ at: Date.now(), map } satisfies CacheEntry));
    return map;
  } catch (e) {
    if (cached) return cached.map; // 오프라인 — 공휴일은 잘 안 바뀌니 만료된 캐시가 없는 것보단 낫다.
    throw e;
  }
}

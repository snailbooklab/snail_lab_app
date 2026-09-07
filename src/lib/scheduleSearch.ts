// 일정 검색 — 서버에 묻지 않고 받아둔 목록을 앱 안에서 거른다(수천 건 규모라 즉시 응답).
// choi-media 웹 app/admin/calendar/_lib/scheduleSearch.ts 와 같은 로직.
//
// 매칭 규칙
//  - 대소문자·공백 무시: "한빛초" → "한빛 초등학교" 일치
//  - 초성만 입력하면 초성 검색: "ㅎㅂㅊ" → "한빛초등학교" 일치
//  - 제목과 메모 둘 다 대상. 일치 구간(원문 기준 인덱스)을 돌려줘서 화면에서 강조할 수 있게 한다.

const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function isChosungChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x3131 && code <= 0x314e && CHOSUNG.includes(ch);
}

/** 완성형 한글 한 글자의 초성. 한글이 아니면 그대로. */
function chosungOf(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return ch;
  return CHOSUNG[Math.floor((code - HANGUL_START) / 588)];
}

/** 공백을 빼고 소문자로 만든 문자열과, 그 문자열의 각 UTF-16 단위가 원문의 몇 번째 단위였는지의 대응표.
 *  (이모지 같은 서로게이트 쌍이 섞여도 indexOf 결과를 원문 위치로 되돌릴 수 있게 단위별로 기록한다.) */
function normalize(text: string, chosung: boolean): { s: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let origIndex = 0;
  for (const ch of Array.from(text)) {
    if (!/\s/.test(ch)) {
      const conv = chosung ? chosungOf(ch) : ch.toLowerCase();
      out.push(conv);
      for (let k = 0; k < conv.length; k++) map.push(origIndex + Math.min(k, ch.length - 1));
    }
    origIndex += ch.length;
  }
  return { s: out.join(""), map };
}

export type MatchRange = { start: number; end: number };

/** query가 text 안에 있으면 원문 기준 [start, end) 구간, 없으면 null. */
export function findMatch(text: string, query: string): MatchRange | null {
  const q = query.replace(/\s+/g, "");
  if (!q) return null;
  const chosungMode = Array.from(q).every(isChosungChar);
  const { s, map } = normalize(text, chosungMode);
  const needle = chosungMode ? q : q.toLowerCase();
  const at = s.indexOf(needle);
  if (at < 0) return null;
  const lastUnit = map[at + needle.length - 1];
  // 마지막 단위가 서로게이트 쌍의 앞 절반이면 쌍 전체를 포함시킨다.
  const end = lastUnit + Array.from(text.slice(lastUnit))[0].length;
  return { start: map[at], end };
}

export type Searchable = { date: string; title: string; memo: string | null };

export type SearchHit<T extends Searchable> = {
  item: T;
  titleMatch: MatchRange | null;
  memoMatch: MatchRange | null;
};

/**
 * 제목·메모 중 하나라도 일치하는 일정을, 다가오는 것(오늘 포함, 가까운 순) → 지난 것(최근 순)
 * 순서로 돌려준다. 호출하는 쪽에서 today 기준으로 두 그룹으로 나눠 보여준다.
 */
export function searchSchedules<T extends Searchable>(items: T[], query: string, today: string): SearchHit<T>[] {
  if (!query.replace(/\s+/g, "")) return [];
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    const titleMatch = findMatch(item.title, query);
    const memoMatch = item.memo ? findMatch(item.memo, query) : null;
    if (titleMatch || memoMatch) hits.push({ item, titleMatch, memoMatch });
  }
  const upcoming = hits.filter((h) => h.item.date >= today).sort((a, b) => a.item.date.localeCompare(b.item.date));
  const past = hits.filter((h) => h.item.date < today).sort((a, b) => b.item.date.localeCompare(a.item.date));
  return [...upcoming, ...past];
}

/** 원문을 [앞, 일치, 뒤] 세 조각으로 — 강조 표시용. */
export function splitByMatch(text: string, m: MatchRange | null): [string, string, string] {
  if (!m) return [text, "", ""];
  return [text.slice(0, m.start), text.slice(m.start, m.end), text.slice(m.end)];
}

import { useQuery } from "@tanstack/react-query";
import { getHolidays, type HolidayMap } from "../api/holidays";

const EMPTY: HolidayMap = {};

/**
 * 달력 한 페이지에 쓸 공휴일 표. 달력 그리드는 앞뒤 달을 물고 있어 12월/1월 페이지가
 * 이웃 해로 넘어가므로 year-1 ~ year+1을 함께 받아둔다(대부분 AsyncStorage 캐시에서 바로 나온다).
 */
export function useHolidays(year: number): HolidayMap {
  const { data } = useQuery({
    queryKey: ["holidays", year],
    queryFn: async () => {
      const maps = await Promise.all([year - 1, year, year + 1].map(getHolidays));
      return Object.assign({}, ...maps) as HolidayMap;
    },
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: Infinity,
  });
  return data ?? EMPTY;
}

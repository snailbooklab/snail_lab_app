// choi-media 웹의 app/admin/calendar/_hooks/schedules.ts와 동일한 react-query 훅 구조.
// 차이점: 성공 시 기기 쪽 파생 상태(로컬 알림 + 홈/잠금화면 위젯)도 함께 맞춘다(resyncDevice).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRecurringSchedules,
  createSchedule,
  deleteSchedule,
  getSchedules,
  updateSchedule,
} from "../api/schedules";
import { resyncDevice } from "../lib/resync";
import type { RecurringScheduleInput, ScheduleInput, ScheduleItem } from "../types";

export function useSchedules(range: { from: string; to: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["schedules", range.from, range.to],
    queryFn: () => getSchedules(range),
    enabled: options?.enabled ?? true,
  });
}

function useInvalidateSchedules() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["schedules"] });
}

function useResync() {
  const invalidate = useInvalidateSchedules();
  return () => {
    invalidate();
    void resyncDevice();
  };
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  const resync = useResync();
  return useMutation({
    mutationFn: (input: ScheduleInput) => createSchedule(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["schedules"] });
      const previous = qc.getQueriesData<ScheduleItem[]>({ queryKey: ["schedules"] });

      const optimisticItem: ScheduleItem = {
        id: `optimistic-${Date.now()}`,
        date: input.date,
        title: input.title,
        memo: input.memo || null,
        remind_at: input.remindAt ?? null,
        created_at: new Date().toISOString(),
      };

      for (const [key] of previous) {
        const [, from, to] = key as [string, string, string];
        if (input.date < from || input.date > to) continue;
        qc.setQueryData<ScheduleItem[]>(key, (old) =>
          old ? [...old, optimisticItem].sort((a, b) => a.date.localeCompare(b.date)) : old,
        );
      }

      return { previous };
    },
    onError: (_err, _input, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: resync,
  });
}

export function useCreateRecurringSchedules() {
  const resync = useResync();
  return useMutation({
    mutationFn: (input: RecurringScheduleInput) => createRecurringSchedules(input),
    onSuccess: resync,
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  const resync = useResync();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ScheduleInput }) => updateSchedule(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ["schedules"] });
      const previous = qc.getQueriesData<ScheduleItem[]>({ queryKey: ["schedules"] });

      // 날짜 자체가 바뀔 수 있으니, range별로 "이 범위에 속하면 갱신본을 넣고, 벗어났으면 지운다".
      for (const [key, data] of previous) {
        if (!data) continue;
        const [, from, to] = key as [string, string, string];
        const existing = data.find((s) => s.id === id);
        const without = data.filter((s) => s.id !== id);
        if (input.date < from || input.date > to) {
          qc.setQueryData<ScheduleItem[]>(key, without);
          continue;
        }
        const updated: ScheduleItem = {
          id,
          date: input.date,
          title: input.title,
          memo: input.memo || null,
          remind_at: input.remindAt !== undefined ? input.remindAt : (existing?.remind_at ?? null),
          created_at: existing?.created_at ?? new Date().toISOString(),
        };
        qc.setQueryData<ScheduleItem[]>(key, [...without, updated].sort((a, b) => a.date.localeCompare(b.date)));
      }

      return { previous };
    },
    onError: (_err, _input, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: resync,
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  const resync = useResync();
  return useMutation({
    mutationFn: (s: ScheduleItem) => deleteSchedule(s.id),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: ["schedules"] });
      const previous = qc.getQueriesData<ScheduleItem[]>({ queryKey: ["schedules"] });

      for (const [key, data] of previous) {
        if (!data) continue;
        qc.setQueryData<ScheduleItem[]>(
          key,
          data.filter((item) => item.id !== s.id),
        );
      }

      return { previous };
    },
    onError: (_err, _input, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: resync,
  });
}

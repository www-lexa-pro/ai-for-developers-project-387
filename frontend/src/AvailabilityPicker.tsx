import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { getAvailability } from "./api/sdk.gen";
import type { Availability, AvailableSlot } from "./api/types.gen";

type Props = {
  meetingTypeId: string;
  disabled?: boolean;
  selectionDisabled?: boolean;
  refreshGeneration?: number;
  resetGeneration?: number;
  onLoaded?: () => void;
  onSelectionChange?: (slot: AvailableSlot | null) => void;
};
type State =
  | { id: string; status: "loading" | "error" | "missing" }
  | { id: string; status: "ready"; data: Availability };
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Moscow",
});
const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function AvailabilityPicker({
  meetingTypeId,
  onSelectionChange,
  disabled = false,
  selectionDisabled = false,
  refreshGeneration = 0,
  resetGeneration = 0,
  onLoaded,
}: Props) {
  const [state, setState] = useState<State>({ id: meetingTypeId, status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const previousType = useRef(meetingTypeId);
  const callback = useRef(onSelectionChange);
  callback.current = onSelectionChange;
  const loadedCallback = useRef(onLoaded);
  loadedCallback.current = onLoaded;
  useEffect(() => {
    setSlot(null);
    callback.current?.(null);
  }, [resetGeneration]);
  useEffect(() => {
    let active = true;
    if (previousType.current !== meetingTypeId) {
      setDate(null);
      previousType.current = meetingTypeId;
    }
    setSlot(null);
    callback.current?.(null);
    setState({ id: meetingTypeId, status: "loading" });
    async function load() {
      try {
        const result = await getAvailability({
          baseUrl: window.location.origin,
          path: { id: meetingTypeId },
        });
        if (!active) return;
        if (result.response?.status === 404) setState({ id: meetingTypeId, status: "missing" });
        else if (result.data && Array.isArray(result.data.days)) {
          const data = result.data;
          setDate((current) =>
            data.days.some((day) => day.date === current && day.slots.length > 0) ? current : null,
          );
          setState({ id: meetingTypeId, status: "ready", data });
          loadedCallback.current?.();
        } else setState({ id: meetingTypeId, status: "error" });
      } catch {
        if (active) setState({ id: meetingTypeId, status: "error" });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [meetingTypeId, attempt, refreshGeneration]);
  function refresh() {
    setSlot(null);
    callback.current?.(null);
    setState({ id: meetingTypeId, status: "loading" });
    setAttempt((value) => value + 1);
  }
  if (state.id !== meetingTypeId || state.status === "loading")
    return <Text role="status">Загрузка свободного времени…</Text>;
  if (state.status === "missing")
    return <Text role="alert">Этот тип встречи больше недоступен</Text>;
  if (state.status === "error")
    return (
      <div role="alert">
        <Text>Не удалось загрузить свободное время</Text>
        <Button disabled={disabled} onClick={refresh}>
          Повторить
        </Button>
      </div>
    );
  if (state.status !== "ready") return null;
  const selectedDay = state.data.days.find((day) => day.date === date);
  return (
    <Stack mt="lg" aria-label="Выбор времени">
      <Title order={2}>Выберите дату и время</Title>
      <Text>Московское время (Europe/Moscow, UTC+3)</Text>
      {!state.data.days.some((day) => day.slots.length > 0) && <Text>Нет свободного времени</Text>}
      <Group>
        {state.data.days.map((day) => {
          const reason =
            day.unavailableReason === "weekend"
              ? "Выходной"
              : day.unavailableReason === "fully_booked"
                ? "Нет свободного времени"
                : "";
          return (
            <Button
              key={day.date}
              disabled={disabled || selectionDisabled || day.slots.length === 0}
              aria-pressed={date === day.date}
              variant={date === day.date ? "filled" : "outline"}
              onClick={() => {
                setDate(day.date);
                setSlot(null);
                callback.current?.(null);
              }}
            >
              {dateFormat.format(new Date(`${day.date}T12:00:00+03:00`))}
              {reason && ` · ${reason}`}
            </Button>
          );
        })}
      </Group>
      {selectedDay && (
        <Group aria-label="Свободное время">
          {selectedDay.slots.map((item) => (
            <Button
              key={item.start}
              disabled={disabled || selectionDisabled}
              aria-pressed={slot === item.start}
              variant={slot === item.start ? "filled" : "outline"}
              onClick={() => {
                setSlot(item.start);
                callback.current?.(item);
              }}
            >
              {timeFormat.format(new Date(item.start))}–{timeFormat.format(new Date(item.end))}
            </Button>
          ))}
        </Group>
      )}
      <Button disabled={disabled} variant="subtle" onClick={refresh}>
        Обновить календарь
      </Button>
    </Stack>
  );
}

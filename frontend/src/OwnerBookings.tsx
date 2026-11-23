import { Button, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { isBooking } from "./booking";
import { listBookings } from "./api/sdk.gen";
import type { Booking } from "./api/types.gen";

const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" });
const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
export function OwnerBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const result = await listBookings({ baseUrl: window.location.origin });
      if (!active.current) return;
      if (!Array.isArray(result.data) || !result.data.every(isBooking))
        throw new Error("invalid response");
      setBookings(result.data);
      setError(false);
    } catch {
      if (active.current) setError(true);
    } finally {
      pending.current = false;
      if (active.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  return (
    <section aria-label="Предстоящие встречи">
      <Title order={2}>Предстоящие встречи</Title>
      {loading && (
        <Text role="status">{bookings === null ? "Загрузка встреч…" : "Обновление встреч…"}</Text>
      )}
      {error && (
        <Text role="alert">
          {bookings === null
            ? "Не удалось загрузить встречи"
            : "Не удалось обновить, данные могут устареть"}
        </Text>
      )}
      <Button disabled={loading} onClick={() => void load()}>
        {error ? "Повторить загрузку встреч" : "Обновить встречи"}
      </Button>
      {bookings?.length === 0 && <Text>Предстоящих встреч нет</Text>}
      {bookings?.map((booking) => (
        <article key={booking.id}>
          <Title order={3}>{booking.meetingTypeName}</Title>
          {booking.topic && <Text>{booking.topic}</Text>}
          <Text>{date.format(new Date(booking.start))}</Text>
          <Text>
            {time.format(new Date(booking.start))}–{time.format(new Date(booking.end))} (Москва)
          </Text>
          <Text>{booking.durationMinutes} мин</Text>
          <Text>{booking.name}</Text>
          <Text>{booking.email}</Text>
        </article>
      ))}
    </section>
  );
}

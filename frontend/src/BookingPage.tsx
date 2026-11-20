import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Stack, Text, TextInput, Title } from "@mantine/core";
import { AvailabilityPicker } from "./AvailabilityPicker";
import { isBooking } from "./booking";
import { createBooking } from "./api/sdk.gen";
import type { AvailableSlot, Booking } from "./api/types.gen";

type Guest = { name: string; email: string };
type Props = {
  meetingTypeId: string;
  guest: Guest;
  onGuestChange: (guest: Guest) => void;
  onSendingChange: (sending: boolean) => void;
  onSuccess: () => void;
  unknown: boolean;
  onUnknownChange: (unknown: boolean) => void;
};
const trim = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Moscow",
});
const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});
export function BookingPage({
  meetingTypeId,
  guest,
  onGuestChange,
  onSendingChange,
  onSuccess,
  unknown,
  onUnknownChange,
}: Props) {
  const [selection, setSelection] = useState<AvailableSlot | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [confirmation, setConfirmation] = useState<
    (Booking & { previousResultUnknown: boolean }) | null
  >(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [resetGeneration, setResetGeneration] = useState(0);
  function uncertain() {
    onUnknownChange(true);
    setNeedsRefresh(true);
    setSelection(null);
    setResetGeneration((value) => value + 1);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current || !selection || needsRefresh) return;
    const name = trim(guest.name),
      email = trim(guest.email);
    const errors: Record<string, string> = {};
    if (Array.from(name).length < 1 || Array.from(name).length > 100)
      errors.name = "Введите имя от 1 до 100 символов";
    if (
      email.length > 254 ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)
    )
      errors.email = "Введите email до 254 символов, например name@example.com";
    setFields(errors);
    if (Object.keys(errors).length) return;
    sendingRef.current = true;
    setSending(true);
    onSendingChange(true);
    try {
      const result = await createBooking({
        baseUrl: window.location.origin,
        body: {
          meetingTypeId,
          start: selection.start,
          name: trim(guest.name),
          email: trim(guest.email),
        },
      });
      if (
        result.response?.status === 201 &&
        isBooking(result.data) &&
        result.data.meetingTypeId === meetingTypeId &&
        Date.parse(result.data.start) === Date.parse(selection.start) &&
        Date.parse(result.data.end) === Date.parse(selection.end) &&
        result.data.name === name &&
        result.data.email === email &&
        Date.parse(result.data.end) - Date.parse(result.data.start) ===
          result.data.durationMinutes * 60_000
      ) {
        setConfirmation({ ...result.data, previousResultUnknown: unknown });
        onSuccess();
      } else if (
        result.response?.status === 422 &&
        result.error?.code === "validation_error" &&
        result.error.fields &&
        typeof result.error.fields === "object" &&
        !Array.isArray(result.error.fields) &&
        Object.keys(result.error.fields).length > 0 &&
        Object.entries(result.error.fields).every(
          ([key, value]) =>
            ["name", "email", "start"].includes(key) &&
            typeof value === "string" &&
            value.length > 0,
        )
      ) {
        setFields(result.error.fields);
        setNotice("Проверьте поля формы");
      } else if (result.response?.status === 400 && result.error?.code === "invalid_request") {
        setNotice("Не удалось отправить запись. Проверьте данные формы");
      } else if (
        result.response?.status === 409 &&
        (result.error?.code === "time_busy" || result.error?.code === "invalid_time")
      ) {
        setNotice(
          result.error.code === "time_busy"
            ? "Это время уже занято"
            : "Выберите новое время: прежнее время больше не входит в расписание или окно записи",
        );
        setSelection(null);
        setRefreshGeneration((value) => value + 1);
      } else if (
        result.response?.status === 404 &&
        result.error?.code === "meeting_type_not_found"
      ) {
        setMissing(true);
        setSelection(null);
        setNotice("Этот тип встречи больше недоступен");
      } else uncertain();
    } catch {
      uncertain();
    } finally {
      sendingRef.current = false;
      setSending(false);
      onSendingChange(false);
    }
  }
  if (confirmation)
    return (
      <Stack mt="lg">
        <Title order={2}>Вы записаны</Title>
        {confirmation.previousResultUnknown && (
          <Text role="alert">Запись могла создаться и при предыдущей попытке.</Text>
        )}
        <Text>{confirmation.meetingTypeName}</Text>
        <Text>
          {dateFormat.format(new Date(confirmation.start))},{" "}
          {timeFormat.format(new Date(confirmation.start))}–
          {timeFormat.format(new Date(confirmation.end))} (Москва)
        </Text>
        <Text>{confirmation.name}</Text>
        <Text>{confirmation.email}</Text>
      </Stack>
    );
  return (
    <>
      {!missing && (
        <AvailabilityPicker
          refreshGeneration={refreshGeneration}
          meetingTypeId={meetingTypeId}
          onSelectionChange={setSelection}
          disabled={sending}
          selectionDisabled={needsRefresh}
          resetGeneration={resetGeneration}
          onLoaded={() => setNeedsRefresh(false)}
        />
      )}
      {fields.start && <Text role="alert">{fields.start}</Text>}
      {notice && <Text role="alert">{notice}</Text>}
      {unknown && (
        <Text role="alert">
          Запись могла создаться. Обновите календарь и выберите новое время. Не повторяйте
          предыдущую запись без проверки.
        </Text>
      )}
      <form onSubmit={submit} noValidate>
        <Stack mt="md">
          <TextInput
            label="Имя"
            error={fields.name}
            value={guest.name}
            disabled={sending}
            onChange={(event) => onGuestChange({ ...guest, name: event.currentTarget.value })}
          />
          <TextInput
            label="Email"
            error={fields.email}
            value={guest.email}
            disabled={sending}
            onChange={(event) => onGuestChange({ ...guest, email: event.currentTarget.value })}
          />
          <Button
            type="submit"
            disabled={sending || missing || !selection || needsRefresh}
            loading={sending}
            aria-busy={sending}
          >
            Записаться
          </Button>
          {sending && <Text role="status">Отправляем запись…</Text>}
        </Stack>
      </form>
    </>
  );
}

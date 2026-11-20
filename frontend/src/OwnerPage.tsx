import { Button, Group, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createMeetingType, listMeetingTypes } from "./api/sdk.gen";
import { OwnerBookings } from "./OwnerBookings";
import type { MeetingType } from "./api/types.gen";

type Fields = Record<string, string>;
// Unicode White_Space matches Go strings.TrimSpace, including U+0085.
const trim = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const size = (value: string) => Array.from(value).length;
function isMeetingType(value: unknown): value is MeetingType {
  if (!value || typeof value !== "object") return false;
  const type = value as MeetingType;
  return (
    typeof type.id === "string" &&
    type.id.length > 0 &&
    typeof type.name === "string" &&
    typeof type.description === "string" &&
    Number.isInteger(type.durationMinutes) &&
    type.durationMinutes >= 1 &&
    type.durationMinutes <= 540
  );
}

export function OwnerPage() {
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [created, setCreated] = useState<{ type: MeetingType; version: number }[]>([]);
  const creationVersion = useRef(0);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("");
  const [fields, setFields] = useState<Fields>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    let active = true;
    const startedAtVersion = creationVersion.current;
    setListState("loading");
    async function load() {
      try {
        const result = await listMeetingTypes({ baseUrl: window.location.origin });
        if (!active) return;
        if (result.data && Array.isArray(result.data) && result.data.every(isMeetingType)) {
          setTypes(result.data);
          setCreated((previous) => previous.filter((item) => item.version > startedAtVersion));
          setListState("ready");
        } else setListState("error");
      } catch {
        if (active) setListState("error");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sendingRef.current) return;
    const normalizedName = trim(name);
    const normalizedDescription = trim(description);
    const minutes = Number(duration);
    const errors: Fields = {};
    if (size(normalizedName) < 1 || size(normalizedName) > 100)
      errors.name = "Введите название от 1 до 100 символов";
    if (size(normalizedDescription) > 1000)
      errors.description = "Описание должно содержать не больше 1000 символов";
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 540)
      errors.durationMinutes = "Введите целое число от 1 до 540";
    setFields(errors);
    if (Object.keys(errors).length) return;
    sendingRef.current = true;
    setSending(true);
    setNotice("");
    try {
      const result = await createMeetingType({
        baseUrl: window.location.origin,
        body: {
          name: normalizedName,
          description: normalizedDescription,
          durationMinutes: minutes,
        },
      });
      if (result.response?.status === 201 && isMeetingType(result.data)) {
        creationVersion.current += 1;
        setCreated((previous) => [
          ...previous,
          { type: result.data!, version: creationVersion.current },
        ]);
        setName("");
        setDescription("");
        setDuration("");
        setUnknown(false);
        setNotice("Тип встречи создан");
      } else if (
        result.response?.status === 422 &&
        result.error?.code === "validation_error" &&
        result.error.fields &&
        typeof result.error.fields === "object" &&
        !Array.isArray(result.error.fields) &&
        Object.keys(result.error.fields).length > 0 &&
        Object.entries(result.error.fields).every(
          ([key, value]) =>
            ["name", "description", "durationMinutes"].includes(key) &&
            typeof value === "string" &&
            value.length > 0,
        )
      ) {
        setFields(result.error.fields);
        setNotice("Проверьте поля формы");
      } else if (
        result.response?.status === 400 &&
        result.error?.code === "invalid_request" &&
        typeof result.error.message === "string"
      ) {
        setNotice(result.error.message);
      } else setUnknown(true);
    } catch {
      setUnknown(true);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  const visibleTypes = [
    ...types,
    ...created
      .map((item) => item.type)
      .filter((type) => !types.some((item) => item.id === type.id)),
  ];
  return (
    <Stack gap="xl">
      <Title order={1}>Для владельца</Title>
      <Text>Страница доступна без входа любому, кто знает адрес.</Text>
      <OwnerBookings />
      <section aria-label="Типы встреч владельца">
        <Title order={2}>Типы встреч</Title>
        {listState === "loading" && <Text role="status">Загрузка типов встреч…</Text>}
        {listState === "error" && (
          <div role="alert">
            <Text>Не удалось загрузить типы встреч</Text>
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Повторить загрузку типов
            </Button>
          </div>
        )}
        {listState === "ready" && visibleTypes.length === 0 && <Text>Нет типов встреч</Text>}
        {visibleTypes.map((type) => (
          <article key={type.id}>
            <Title order={3}>{type.name}</Title>
            <Text style={{ whiteSpace: "pre-wrap" }}>{type.description}</Text>
            <Text>{type.durationMinutes} мин</Text>
          </article>
        ))}
      </section>
      <section aria-label="Создание типа встречи">
        <Title order={2}>Создать тип встречи</Title>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <Stack>
            <TextInput
              label="Название"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={fields.name}
              disabled={sending}
            />
            <Textarea
              label="Описание"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              error={fields.description}
              disabled={sending}
            />
            <TextInput
              label="Длительность, минут"
              type="number"
              value={duration}
              onChange={(event) => setDuration(event.currentTarget.value)}
              error={fields.durationMinutes}
              disabled={sending}
            />
            <Group>
              <Button type="submit" disabled={sending} loading={sending} aria-busy={sending}>
                Создать тип
              </Button>
            </Group>
            {sending && <Text role="status">Создаём тип встречи…</Text>}
          </Stack>
        </form>
        {notice && <Text role="status">{notice}</Text>}
        {unknown && (
          <div role="alert">
            <Text>
              Тип мог быть создан. Проверьте список типов перед повторным созданием. Совпадение
              названия не доказывает успех.
            </Text>
            <Button
              disabled={listState === "loading"}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Проверить список типов
            </Button>
          </div>
        )}
      </section>
    </Stack>
  );
}

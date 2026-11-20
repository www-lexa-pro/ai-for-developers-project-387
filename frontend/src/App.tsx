import "@mantine/core/styles.css";
import { Badge, Button, Container, Group, MantineProvider, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { getMeetingType, listMeetingTypes } from "./api/sdk.gen";
import type { MeetingType } from "./api/types.gen";
import "./styles.css";
import { BookingPage } from "./BookingPage";
import { OwnerPage } from "./OwnerPage";

type Screen =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; types: MeetingType[] };

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [attempt, setAttempt] = useState(0);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [sending, setSending] = useState(false);
  const [unknownBooking, setUnknownBooking] = useState(false);
  const [screen, setScreen] = useState<Screen>({ status: "loading" });
  const owner = path === "/owner";
  const id = /^\/meeting-types\/([^/]+)$/.exec(path)?.[1];

  useEffect(() => {
    const onPop = () => {
      if (sending) {
        window.history.pushState(null, "", path);
        return;
      }
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sending, path]);

  useEffect(() => {
    if (owner) return;
    let active = true;
    setScreen({ status: "loading" });
    async function load() {
      try {
        const options = { baseUrl: window.location.origin };
        if (id) {
          const result = await getMeetingType({ ...options, path: { id: decodeURIComponent(id) } });
          if (!active) return;
          if (result.response?.status === 404) setScreen({ status: "missing" });
          else if (result.data) setScreen({ status: "ready", types: [result.data] });
          else setScreen({ status: "error" });
        } else {
          const result = await listMeetingTypes(options);
          if (active)
            setScreen(result.data ? { status: "ready", types: result.data } : { status: "error" });
        }
      } catch {
        if (active) setScreen({ status: "error" });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id, attempt, owner]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    if (sending || destination === path) return;
    window.history.pushState(null, "", destination);
    setScreen({ status: "loading" });
    setPath(destination);
  }

  return (
    <MantineProvider theme={{ primaryColor: "dark", fontFamily: "Inter, Arial, sans-serif" }}>
      <Container size={1120} className="page">
        <header className="header">
          <a
            className="brand"
            href="/"
            onClick={(event) => navigate(event, "/")}
            aria-label="Запись на звонок — главная"
          >
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
            Запись на звонок
          </a>
          <Button
            component="a"
            href="/owner"
            onClick={(event) => navigate(event, "/owner")}
            aria-disabled={sending}
            variant="subtle"
            color="dark"
          >
            Для владельца
          </Button>
        </header>
        <main>
          {owner ? (
            <OwnerPage />
          ) : (
            <>
              <section className="intro" aria-labelledby="page-title">
                <Badge variant="light" color="dark" radius="sm">
                  Время для разговора
                </Badge>
                <Title id="page-title" order={1}>
                  {id ? (
                    "Выбранный формат встречи"
                  ) : (
                    <>
                      Хороший разговор
                      <br />
                      начинается со встречи.
                    </>
                  )}
                </Title>
                <Text className="lead">Выберите формат, который подходит вашему вопросу.</Text>
                <Group gap="xs" className="schedule">
                  <span className="status-dot" aria-hidden="true" />
                  <Text size="sm">Пн–пт, 09:00–18:00</Text>
                  <span aria-hidden="true">·</span>
                  <Text size="sm">Московское время (UTC+3)</Text>
                </Group>
              </section>
              <section className="formats" aria-label="Типы встреч">
                {screen.status === "loading" && <Text role="status">Загрузка типов встреч…</Text>}
                {screen.status === "error" && (
                  <div role="alert">
                    <Text>Не удалось загрузить типы встреч</Text>
                    <Button onClick={() => setAttempt((value) => value + 1)}>Повторить</Button>
                  </div>
                )}
                {screen.status === "missing" && (
                  <Text role="alert">Этот тип встречи больше недоступен</Text>
                )}
                {screen.status === "ready" && screen.types.length === 0 && (
                  <Text>Нет типов встреч</Text>
                )}
                {screen.status === "ready" && (
                  <div className="meeting-grid">
                    {screen.types.map((meeting, index) => (
                      <article
                        key={meeting.id}
                        className={`meeting-card ${["sage", "sand", "lilac"][index % 3]}`}
                      >
                        <div className="card-top">
                          <span className="meeting-symbol" aria-hidden="true">
                            ↗
                          </span>
                          <span className="duration">{meeting.durationMinutes} мин</span>
                        </div>
                        <Title order={id ? 2 : 3}>{meeting.name}</Title>
                        <Text className="description">{meeting.description}</Text>
                        {!id && (
                          <Button
                            component="a"
                            href={`/meeting-types/${encodeURIComponent(meeting.id)}`}
                            onClick={(event) =>
                              navigate(event, `/meeting-types/${encodeURIComponent(meeting.id)}`)
                            }
                            aria-label={`Выбрать ${meeting.name}`}
                            fullWidth
                            variant="white"
                            className="booking-button"
                          >
                            Выбрать формат
                          </Button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {id && screen.status === "ready" && (
                  <BookingPage
                    key={id}
                    meetingTypeId={decodeURIComponent(id)}
                    guest={guest}
                    onGuestChange={setGuest}
                    unknown={unknownBooking}
                    onUnknownChange={setUnknownBooking}
                    onSendingChange={setSending}
                    onSuccess={() => {
                      setGuest({ name: "", email: "" });
                      setUnknownBooking(false);
                    }}
                  />
                )}
                {id && (
                  <Button
                    component="a"
                    href="/"
                    aria-disabled={sending}
                    onClick={(event) => navigate(event, "/")}
                    mt="md"
                  >
                    Вернуться к типам встреч
                  </Button>
                )}
              </section>
              <aside className="booking-info" aria-label="Условия записи">
                <span className="info-symbol" aria-hidden="true">
                  ↗
                </span>
                <div>
                  <Text fw={600}>Ваш вопрос. Подходящий формат. Удобное время.</Text>
                  <Text size="sm" c="dimmed">
                    Выберите свободное время по московскому календарю.
                  </Text>
                </div>
              </aside>
            </>
          )}
        </main>
        <footer className="footer">
          <Text size="sm">Запись на звонок</Text>
          <Text size="sm">Меньше переписки — больше разговора.</Text>
        </footer>
      </Container>
    </MantineProvider>
  );
}

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
const meeting = {
  id: "intro",
  name: "Знакомство",
  description: "Обсудим ваш вопрос.",
  durationMinutes: 15,
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("гость читает каталог из API и открывает выбранный тип", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) =>
      respond(new URL(request.url).pathname.endsWith("/intro") ? meeting : [meeting]),
    ),
  );
  render(<App />);
  expect(await screen.findByText("Обсудим ваш вопрос.")).toBeTruthy();
  expect(screen.getByText("15 мин")).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "Выбрать Знакомство" }));
  expect(await screen.findByRole("heading", { name: "Знакомство" })).toBeTruthy();
  expect(window.location.pathname).toBe("/meeting-types/intro");
});

test("прямая ссылка загружает тип без предварительного открытия каталога", async () => {
  window.history.replaceState(null, "", "/meeting-types/intro");
  vi.stubGlobal("fetch", async (request: Request) =>
    respond(new URL(request.url).pathname.endsWith("/intro") ? meeting : [meeting]),
  );
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Знакомство" })).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  expect(window.location.pathname).toBe("/");
  expect(await screen.findByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
});

test("во время загрузки гость видит ожидание, а успешный пустой ответ отличается от ошибки", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  render(<App />);
  expect(screen.getByRole("status").textContent).toContain("Загрузка");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish(respond([]));
  expect(await screen.findByText("Нет типов встреч")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["catalog", "type"])("ошибка чтения %s допускает только ручной повтор", async (kind) => {
  if (kind === "type") window.history.replaceState(null, "", "/meeting-types/intro");
  let failed = true;
  const fetch = vi.fn(async () => {
    if (failed) throw new TypeError("network");
    return respond(kind === "type" ? meeting : [meeting]);
  });
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetch.mock.calls.length).toBe(1);
  failed = false;
  await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByRole("heading", { name: "Знакомство" })).toBeTruthy();
});

test("недоступный тип не вызывает автоматический переход и позволяет вернуться в каталог", async () => {
  window.history.replaceState(null, "", "/meeting-types/old-id");
  vi.stubGlobal("fetch", async (request: Request) =>
    new URL(request.url).pathname.endsWith("/old-id")
      ? respond(
          { code: "meeting_type_not_found", message: "Этот тип встречи больше недоступен" },
          404,
        )
      : respond([meeting]),
  );
  render(<App />);
  expect(await screen.findByText("Этот тип встречи больше недоступен")).toBeTruthy();
  expect(window.location.pathname).toBe("/meeting-types/old-id");
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  expect(await screen.findByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
});

test("запоздавший ответ типа не подменяет каталог после возврата", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", (request: Request) =>
    new URL(request.url).pathname.endsWith("/intro")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(respond([meeting])),
  );
  render(<App />);
  await userEvent.click(await screen.findByRole("link", { name: "Выбрать Знакомство" }));
  expect(screen.getByRole("status")).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  expect(await screen.findByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
  await act(async () => {
    finish(respond({ ...meeting, name: "Запоздавший ответ" }));
  });
  expect(screen.queryByText("Запоздавший ответ")).toBeNull();
  expect(screen.getByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
});

test("повторный переход на главную сохраняет доступный каталог", async () => {
  vi.stubGlobal("fetch", async () => respond([meeting]));
  render(<App />);
  expect(await screen.findByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "Запись на звонок — главная" }));
  expect(screen.getByRole("link", { name: "Выбрать Знакомство" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

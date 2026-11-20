import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
const booking = {
  id: "b",
  meetingTypeId: "t",
  meetingTypeName: "Разбор задачи",
  durationMinutes: 45,
  start: "2026-11-17T09:00:00+03:00",
  end: "2026-11-17T09:45:00+03:00",
  name: "Алексей",
  email: "A+tag@Example.com",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  window.history.replaceState(null, "", "/owner");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("встречи загружаются независимо от типов и формы", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", (request: Request) =>
    request.url.endsWith("/api/bookings")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(response({}, 500)),
  );
  render(<App />);
  expect(screen.getByText("Загрузка встреч…")).toBeTruthy();
  await screen.findByText("Не удалось загрузить типы встреч");
  expect((screen.getByLabelText("Название") as HTMLInputElement).disabled).toBe(false);
  finish(response([booking]));
  const section = await screen.findByRole("region", { name: "Предстоящие встречи" });
  expect(await within(section).findByText("Разбор задачи")).toBeTruthy();
  for (const text of [
    "Алексей",
    "A+tag@Example.com",
    "45 мин",
    "17.11.2026",
    "09:00–09:45 (Москва)",
  ])
    expect(within(section).getByText(text)).toBeTruthy();
});

test("ошибка первой загрузки имеет повтор и пустое состояние", async () => {
  let fail = true;
  vi.stubGlobal("fetch", async (request: Request) =>
    request.url.endsWith("/api/bookings") && fail ? response({}, 500) : response([]),
  );
  render(<App />);
  expect(await screen.findByText("Не удалось загрузить встречи")).toBeTruthy();
  expect(screen.getByText("Нет типов встреч")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Название"), "Новый тип");
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Повторить загрузку встреч" }));
  expect(await screen.findByText("Предстоящих встреч нет")).toBeTruthy();
  expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("Новый тип");
});

test("плановое, ручное и обновление при возврате не дублируются; старые данные переживают сбой", async () => {
  let calls = 0;
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", (request: Request) => {
    if (!request.url.endsWith("/api/bookings")) return Promise.resolve(response([]));
    calls++;
    if (calls === 1) return Promise.resolve(response([booking]));
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.useFakeTimers();
  await act(async () => {
    render(<App />);
  });
  expect(screen.getByText("Разбор задачи")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(30000);
  });
  expect(calls).toBe(2);
  expect(screen.getByText("Обновление встреч…")).toBeTruthy();
  expect(screen.getByText("Алексей")).toBeTruthy();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => {
    fireEvent(document, new Event("visibilitychange"));
    vi.advanceTimersByTime(30000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Обновить встречи" }));
  expect(calls).toBe(2);
  await act(async () => {
    finish(response({}, 500));
  });
  expect(screen.getByText("Не удалось обновить, данные могут устареть")).toBeTruthy();
  expect(screen.getByText("Алексей")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(30000);
  });
  expect(calls).toBe(3);
  await act(async () => {
    finish(response([]));
  });
  expect(screen.getByText("Предстоящих встреч нет")).toBeTruthy();
  expect(screen.queryByText("Не удалось обновить, данные могут устареть")).toBeNull();
  await act(async () => {
    fireEvent(document, new Event("visibilitychange"));
  });
  expect(calls).toBe(4);
  await act(async () => {
    finish(response([booking]));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Обновить встречи" }));
  });
  expect(calls).toBe(5);
  await act(async () => {
    finish(response([booking]));
  });
});

test("неверная длительность встречи показывает ошибку чтения вместо записи", async () => {
  vi.stubGlobal("fetch", async (request: Request) =>
    response(request.url.endsWith("/api/bookings") ? [{ ...booking, durationMinutes: 541 }] : []),
  );
  render(<App />);
  expect(await screen.findByText("Не удалось загрузить встречи")).toBeTruthy();
  expect(screen.queryByText("541 мин")).toBeNull();
  expect(screen.queryByText("Алексей")).toBeNull();
});

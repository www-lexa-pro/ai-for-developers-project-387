import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { AvailabilityPicker } from "../src/AvailabilityPicker";

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
});
const snapshot = {
  timeZone: "Europe/Moscow",
  windowStart: "2026-11-17",
  windowEnd: "2026-11-30",
  days: [
    {
      date: "2026-11-17",
      slots: [{ start: "2026-11-17T09:00:00+03:00", end: "2026-11-17T09:45:00+03:00" }],
    },
    {
      date: "2026-11-18",
      slots: [{ start: "2026-11-18T10:00:00+03:00", end: "2026-11-18T10:45:00+03:00" }],
    },
    { date: "2026-11-21", unavailableReason: "weekend", slots: [] },
    { date: "2026-11-23", unavailableReason: "fully_booked", slots: [] },
  ],
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function show(id = "intro", onSelectionChange = vi.fn()) {
  return render(
    <MantineProvider>
      <AvailabilityPicker meetingTypeId={id} onSelectionChange={onSelectionChange} />
    </MantineProvider>,
  );
}

test("гость сам выбирает дату и время по Москве без дополнительных запросов", async () => {
  const fetch = vi.fn(async () => respond(snapshot));
  vi.stubGlobal("fetch", fetch);
  const selected = vi.fn();
  show("intro", selected);
  expect(screen.getByRole("status").textContent).toContain("Загрузка");
  await screen.findByRole("button", { name: /17 ноября/ });
  expect(screen.queryByRole("button", { name: "09:00–09:45" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: /21 ноября.*Выходной/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: /23 ноября.*Нет свободного времени/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:45" }));
  expect(selected).toHaveBeenLastCalledWith(snapshot.days[0].slots[0]);
  await userEvent.click(screen.getByRole("button", { name: /18 ноября/ }));
  expect(selected).toHaveBeenLastCalledWith(null);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("обновление сбрасывает время, сохраняет доступную дату и не выбирает слот автоматически", async () => {
  vi.stubGlobal("fetch", async () => respond(snapshot));
  const selected = vi.fn();
  show("intro", selected);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:45" }));
  await userEvent.click(screen.getByRole("button", { name: "Обновить календарь" }));
  expect(selected).toHaveBeenLastCalledWith(null);
  expect(
    (await screen.findByRole("button", { name: /17 ноября/ })).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "09:00–09:45" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
});

test("ошибка позволяет повторить чтение, пустое окно отличается от ошибки", async () => {
  let failed = true;
  const fetch = vi.fn(async () => {
    if (failed) throw new Error("network");
    return respond({
      ...snapshot,
      days: snapshot.days.map((day) => ({ ...day, slots: [], unavailableReason: "fully_booked" })),
    });
  });
  vi.stubGlobal("fetch", fetch);
  show();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
  failed = false;
  await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Нет свободного времени")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("смена типа сразу скрывает слоты, запоздавший ответ предыдущего типа игнорируется", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", (request: Request) =>
    new URL(request.url).pathname.includes("/old/")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(respond(snapshot)),
  );
  const view = show("old");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(
    <MantineProvider>
      <AvailabilityPicker meetingTypeId="new" />
    </MantineProvider>,
  );
  await screen.findByRole("button", { name: /17 ноября/ });
  await act(async () => {
    finish(respond({ ...snapshot, days: [{ date: "2026-12-01", slots: [] }] }));
  });
  expect(screen.queryByRole("button", { name: /1 декабря/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /17 ноября/ }));
  expect(screen.getByRole("button", { name: "09:00–09:45" })).toBeTruthy();
  view.rerender(
    <MantineProvider>
      <AvailabilityPicker meetingTypeId="old" />
    </MantineProvider>,
  );
  expect(screen.queryByRole("button", { name: "09:00–09:45" })).toBeNull();
});

test("после обновления недоступная дата сбрасывается без нового автоматического выбора", async () => {
  let booked = false;
  vi.stubGlobal("fetch", async () =>
    respond(
      booked
        ? {
            ...snapshot,
            days: snapshot.days.map((day) =>
              day.date === "2026-11-17"
                ? { ...day, slots: [], unavailableReason: "fully_booked" }
                : day,
            ),
          }
        : snapshot,
    ),
  );
  show();
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  booked = true;
  await userEvent.click(screen.getByRole("button", { name: "Обновить календарь" }));
  const unavailable = await screen.findByRole("button", {
    name: /17 ноября.*Нет свободного времени/,
  });
  expect(unavailable.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: /18 ноября/ }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(screen.queryByRole("button", { name: "10:00–10:45" })).toBeNull();
});

test("исчезнувший тип показывает объяснение вместо календаря", async () => {
  vi.stubGlobal("fetch", async () =>
    respond({ code: "meeting_type_not_found", message: "Этот тип встречи больше недоступен" }, 404),
  );
  show();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Этот тип встречи больше недоступен",
  );
  expect(screen.queryByRole("button", { name: "Обновить календарь" })).toBeNull();
});

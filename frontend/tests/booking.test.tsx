import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

const type = { id: "intro", name: "Знакомство", description: "Описание", durationMinutes: 15 };
const slot = { start: "2026-11-17T09:00:00+03:00", end: "2026-11-17T09:15:00+03:00" };
const snapshot = {
  timeZone: "Europe/Moscow",
  windowStart: "2026-11-17",
  windowEnd: "2026-11-30",
  days: [{ date: "2026-11-17", slots: [slot] }],
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => {
  window.history.replaceState(null, "", "/meeting-types/intro");
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
test("гость записывается и видит точное подтверждение, новая запись начинается с пустых полей", async () => {
  let submitted: unknown;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      submitted = await request.json();
      return respond(
        {
          id: "booking",
          meetingTypeId: type.id,
          meetingTypeName: type.name,
          durationMinutes: 15,
          ...slot,
          name: "Алексей",
          email: "A+tag@Example.com",
        },
        201,
      );
    }
    const path = new URL(request.url).pathname;
    return respond(
      path.endsWith("/availability") ? snapshot : path === "/api/meeting-types" ? [type] : type,
    );
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), " Алексей ");
  await userEvent.type(screen.getByLabelText("Email"), " A+tag@Example.com ");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  expect(await screen.findByText("Вы записаны")).toBeTruthy();
  expect(submitted).toEqual({
    meetingTypeId: "intro",
    start: slot.start,
    name: "Алексей",
    email: "A+tag@Example.com",
  });
  expect(screen.getByText("A+tag@Example.com")).toBeTruthy();
  expect(screen.getByText(/09:00–09:15/)).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  await userEvent.click(await screen.findByRole("link", { name: "Выбрать Знакомство" }));
  expect(await screen.findByLabelText("Имя")).toHaveProperty("value", "");
});

test.each(["network", "500", "malformed"])(
  "неизвестный результат %s требует обновления и нового выбора, без повторного POST",
  async (failure) => {
    let posts = 0;
    let reads = 0;
    let failRefresh = false;
    vi.stubGlobal("fetch", async (request: Request) => {
      if (request.method === "POST") {
        posts++;
        if (failure === "network") throw Error("lost");
        return failure === "500"
          ? respond({ code: "internal_error", message: "Ошибка" }, 500)
          : respond({ id: "incomplete" }, 201);
      }
      if (new URL(request.url).pathname.endsWith("/availability")) {
        reads++;
        if (failRefresh) throw Error("offline");
        return respond(snapshot);
      }
      return respond(type);
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
    await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
    await userEvent.type(screen.getByLabelText("Имя"), "Алексей");
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText(/Запись могла создаться/)).toBeTruthy();
    expect(screen.getByLabelText("Имя")).toHaveProperty("value", "Алексей");
    expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
    expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", true);
    expect(posts).toBe(1);
    expect(reads).toBe(1);
    failRefresh = true;
    await userEvent.click(screen.getByRole("button", { name: "Обновить календарь" }));
    await screen.findByText("Не удалось загрузить свободное время");
    expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", true);
    failRefresh = false;
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await userEvent.click(await screen.findByRole("button", { name: "09:00–09:15" }));
    expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", false);
    expect(screen.getByText(/Запись могла создаться/)).toBeTruthy();
    expect(posts).toBe(1);
  },
);

test.each(["time_busy", "invalid_time", "meeting_type_not_found"])(
  "ответ %s сохраняет ввод и объясняет следующий шаг",
  async (code) => {
    let reads = 0;
    let posts = 0;
    vi.stubGlobal("fetch", async (request: Request) => {
      if (request.method === "POST") {
        posts++;
        return respond({ code, message: "Сбой" }, code === "meeting_type_not_found" ? 404 : 409);
      }
      if (new URL(request.url).pathname.endsWith("/availability")) {
        reads++;
        return respond(snapshot);
      }
      return respond(type);
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
    await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
    await userEvent.type(screen.getByLabelText("Имя"), "Алексей");
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
    if (code === "meeting_type_not_found") {
      expect(await screen.findByText("Этот тип встречи больше недоступен")).toBeTruthy();
      expect(window.location.pathname).toBe("/meeting-types/intro");
      expect(screen.getByRole("link", { name: "Вернуться к типам встреч" })).toBeTruthy();
    } else {
      expect(
        await screen.findByText(
          code === "time_busy"
            ? "Это время уже занято"
            : "Выберите новое время: прежнее время больше не входит в расписание или окно записи",
        ),
      ).toBeTruthy();
      await screen.findByRole("button", { name: "09:00–09:15" });
      expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", true);
      expect(reads).toBe(2);
    }
    expect(screen.getByLabelText("Имя")).toHaveProperty("value", "Алексей");
    expect(posts).toBe(1);
  },
);

test("проверка полей показывает все ошибки до отправки, Unicode и email сохраняют точные границы", async () => {
  let posts = 0;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posts++;
      return respond(
        {
          code: "validation_error",
          message: "Проверьте поля формы",
          fields: { name: "Ошибка имени", email: "Ошибка email" },
        },
        422,
      );
    }
    return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  expect(await screen.findByText("Введите имя от 1 до 100 символов")).toBeTruthy();
  expect(screen.getByText("Введите email до 254 символов, например name@example.com")).toBeTruthy();
  expect(posts).toBe(0);
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  expect(await screen.findByText("Ошибка имени")).toBeTruthy();
  expect(screen.getByText("Ошибка email")).toBeTruthy();
  expect(screen.getByLabelText("Имя")).toHaveProperty("value", "Я");
  expect(posts).toBe(1);
});

test("отправка блокирует поля, даты, обновление и переходы приложения до ответа", async () => {
  let finish!: (response: Response) => void;
  let posts = 0;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posts++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  expect(screen.getByLabelText("Имя")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Email")).toHaveProperty("disabled", true);
  expect(screen.getByText("Отправляем запись…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Записаться" }).getAttribute("aria-busy")).toBe("true");
  for (const name of [/17 ноября/, "09:00–09:15", "Обновить календарь", "Записаться"])
    expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  await userEvent.click(screen.getByRole("link", { name: "Для владельца" }));
  expect(window.location.pathname).toBe("/meeting-types/intro");
  expect(posts).toBe(1);
  finish(
    respond(
      {
        code: "validation_error",
        message: "Проверьте поля формы",
        fields: { email: "Ошибка email" },
      },
      422,
    ),
  );
  await screen.findByText("Ошибка email");
  expect(screen.queryByText("Отправляем запись…")).toBeNull();
});

test("имя и email переживают возврат к каталогу и смену типа, но перезагрузка очищает ввод", async () => {
  const other = { ...type, id: "other", name: "Другой" };
  vi.stubGlobal("fetch", async (request: Request) => {
    const path = new URL(request.url).pathname;
    return respond(
      path.endsWith("/availability")
        ? snapshot
        : path === "/api/meeting-types"
          ? [type, other]
          : path.endsWith("/other")
            ? other
            : type,
    );
  });
  const view = render(<App />);
  await userEvent.type(await screen.findByLabelText("Имя"), "Алексей");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  await userEvent.click(await screen.findByRole("link", { name: "Выбрать Другой" }));
  expect(await screen.findByLabelText("Имя")).toHaveProperty("value", "Алексей");
  expect(screen.getByLabelText("Email")).toHaveProperty("value", "a@example.com");
  expect(screen.getByRole("button", { name: "Записаться" })).toHaveProperty("disabled", true);
  view.unmount();
  render(<App />);
  expect(await screen.findByLabelText("Имя")).toHaveProperty("value", "");
});

test.each([
  ["😀".repeat(100), "a".repeat(242) + "@example.com", true],
  ["😀".repeat(101), "a@example.com", false],
  ["Я", "a".repeat(243) + "@example.com", false],
  ["Я", "a b@example.com", false],
  ["Я", "я@example.com", false],
  ["\u0085Я\u0085", " A+tag@Example.com ", true],
])("границы полей имени и email %#", async (name, email, valid) => {
  let posted: Record<string, string> | null = null;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posted = await request.json();
      return respond(
        {
          code: "validation_error",
          message: "Проверьте поля формы",
          fields: { name: "Серверная проверка" },
        },
        422,
      );
    }
    return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  // Paste-length input uses the DOM input seam, avoiding thousands of keyboard events.
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Имя"));
  await user.paste(name);
  await user.click(screen.getByLabelText("Email"));
  await user.paste(email);
  await user.click(screen.getByRole("button", { name: "Записаться" }));
  expect(posted !== null).toBe(valid);
  if (name === "\u0085Я\u0085")
    expect(posted).toMatchObject({ name: "Я", email: "A+tag@Example.com" });
});

test("предупреждение о возможной записи сохраняется при выборе другого типа", async () => {
  const other = { ...type, id: "other", name: "Другой" };
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") throw Error("lost");
    const path = new URL(request.url).pathname;
    return respond(
      path.endsWith("/availability")
        ? snapshot
        : path === "/api/meeting-types"
          ? [type, other]
          : path.endsWith("/other")
            ? other
            : type,
    );
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  await screen.findByText(/Запись могла создаться/);
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  await userEvent.click(await screen.findByRole("link", { name: "Выбрать Другой" }));
  expect(await screen.findByText(/Запись могла создаться/)).toBeTruthy();
});

test("формально полный ответ с чужим слотом считается неизвестным результатом", async () => {
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST")
      return respond(
        {
          id: "booking",
          meetingTypeId: "other",
          meetingTypeName: "Чужой",
          durationMinutes: 15,
          ...slot,
          name: "Я",
          email: "a@example.com",
        },
        201,
      );
    return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  expect(await screen.findByText(/Запись могла создаться/)).toBeTruthy();
  expect(screen.queryByText("Вы записаны")).toBeNull();
});

test("после успеха переход истории к другому типу открывает пустую новую запись", async () => {
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST")
      return respond(
        {
          id: "booking",
          meetingTypeId: type.id,
          meetingTypeName: type.name,
          durationMinutes: 15,
          ...slot,
          name: "Я",
          email: "a@example.com",
        },
        201,
      );
    return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  await screen.findByText("Вы записаны");
  window.history.replaceState(null, "", "/meeting-types/other");
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(await screen.findByLabelText("Имя")).toHaveProperty("value", "");
});

test.each([{ fields: ["ошибка"] }, { fields: { name: "" } }])(
  "непонятные ошибки полей %j не считаются известным отказом записи",
  async ({ fields }) => {
    vi.stubGlobal("fetch", async (request: Request) => {
      if (request.method === "POST")
        return respond({ code: "validation_error", message: "Ошибка", fields }, 422);
      return respond(new URL(request.url).pathname.endsWith("/availability") ? snapshot : type);
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
    await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
    await userEvent.type(screen.getByLabelText("Имя"), "Я");
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
    expect(await screen.findByText(/Запись могла создаться/)).toBeTruthy();
  },
);

test("подтверждение новой записи сохраняет предупреждение о предыдущем неизвестном результате до возврата", async () => {
  let posts = 0;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posts++;
      if (posts === 1) throw Error("lost response");
      return respond(
        {
          id: "booking",
          meetingTypeId: type.id,
          meetingTypeName: type.name,
          durationMinutes: 15,
          ...slot,
          name: "Я",
          email: "a@example.com",
        },
        201,
      );
    }
    const path = new URL(request.url).pathname;
    return respond(
      path.endsWith("/availability") ? snapshot : path === "/api/meeting-types" ? [type] : type,
    );
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /17 ноября/ }));
  await userEvent.click(screen.getByRole("button", { name: "09:00–09:15" }));
  await userEvent.type(screen.getByLabelText("Имя"), "Я");
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  await screen.findByText(/Запись могла создаться/);
  await userEvent.click(screen.getByRole("button", { name: "Обновить календарь" }));
  await userEvent.click(await screen.findByRole("button", { name: "09:00–09:15" }));
  await userEvent.click(screen.getByRole("button", { name: "Записаться" }));
  await screen.findByText("Вы записаны");
  expect(screen.getByText(/Запись могла создаться/)).toBeTruthy();
  expect(posts).toBe(2);
  await userEvent.click(screen.getByRole("link", { name: "Вернуться к типам встреч" }));
  await userEvent.click(await screen.findByRole("link", { name: "Выбрать Знакомство" }));
  expect(await screen.findByLabelText("Имя")).toHaveProperty("value", "");
  expect(screen.queryByText(/Запись могла создаться/)).toBeNull();
});

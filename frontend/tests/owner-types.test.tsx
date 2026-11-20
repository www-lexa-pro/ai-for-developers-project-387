import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.history.replaceState(null, "", "/owner");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
const created = { id: "new", name: "Разбор", description: "Описание", durationMinutes: 45 };
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
async function fill() {
  await userEvent.type(screen.getByLabelText("Название"), "Разбор");
  await userEvent.type(screen.getByLabelText("Описание"), "Описание");
  await userEvent.type(screen.getByLabelText("Длительность, минут"), "45");
}
test("владелец создаёт тип, видит его в списке и очищенную форму", async () => {
  vi.stubGlobal("fetch", async (request: Request) =>
    request.method === "POST" ? response(created, 201) : response([]),
  );
  render(<App />);
  expect(await screen.findByText("Нет типов встреч")).toBeTruthy();
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(await screen.findByText("Тип встречи создан")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Разбор" })).toBeTruthy();
  expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("");
});
test("ошибка списка не мешает форме; неизвестный результат не повторяет создание", async () => {
  let posts = 0;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posts++;
      throw new TypeError("network");
    }
    return response({}, 500);
  });
  render(<App />);
  expect(await screen.findByText("Не удалось загрузить типы встреч")).toBeTruthy();
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(await screen.findByText(/Тип мог быть создан/)).toBeTruthy();
  expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("Разбор");
  await userEvent.click(screen.getByRole("button", { name: "Проверить список типов" }));
  await waitFor(() => expect(posts).toBe(1));
});

test("все ошибки полей показаны вместе и ввод сохранён без запроса создания", async () => {
  const fetch = vi.fn(async (_request: Request) => response([]));
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  await screen.findByText("Нет типов встреч");
  await userEvent.type(screen.getByLabelText("Название"), " ");
  // Pasting avoids thousands of keyboard events while exercising the public form.
  await userEvent.click(screen.getByLabelText("Описание"));
  await userEvent.paste("Я".repeat(1001));
  await userEvent.type(screen.getByLabelText("Длительность, минут"), "1.5");
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(screen.getByText("Введите название от 1 до 100 символов")).toBeTruthy();
  expect(screen.getByText("Описание должно содержать не больше 1000 символов")).toBeTruthy();
  expect(screen.getByText("Введите целое число от 1 до 540")).toBeTruthy();
  expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe(" ");
  expect(
    fetch.mock.calls.filter(([request]) => (request as unknown as Request).method === "POST")
      .length,
  ).toBe(0);
});

test("форма заблокирована до ответа, серверные ошибки сохраняют поля", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", (request: Request) =>
    request.method === "POST"
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(response([])),
  );
  render(<App />);
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.getByText("Создаём тип встречи…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Создать тип" }).getAttribute("aria-busy")).toBe(
    "true",
  );
  for (const label of ["Название", "Описание", "Длительность, минут"])
    expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Создать тип" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  finish(
    response(
      {
        code: "validation_error",
        message: "Проверьте поля",
        fields: {
          name: "Ошибка названия",
          description: "Ошибка описания",
          durationMinutes: "Ошибка длительности",
        },
      },
      422,
    ),
  );
  expect(await screen.findByText("Ошибка названия")).toBeTruthy();
  expect(screen.getByText("Ошибка описания")).toBeTruthy();
  expect(screen.getByText("Ошибка длительности")).toBeTruthy();
  expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("Разбор");
  expect((screen.getByLabelText("Название") as HTMLInputElement).disabled).toBe(false);
  expect(screen.queryByText("Создаём тип встречи…")).toBeNull();
});

test.each([500, 201])(
  "неизвестный ответ %s сохраняет ввод и предупреждение после проверки списка",
  async (status) => {
    let posts = 0;
    vi.stubGlobal("fetch", async (request: Request) => {
      if (request.method === "POST") {
        posts++;
        return response({}, status);
      }
      return response([]);
    });
    render(<App />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
    expect(await screen.findByText(/Тип мог быть создан/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Проверить список типов" }));
    expect(await screen.findByText("Нет типов встреч")).toBeTruthy();
    expect(screen.getByText(/Тип мог быть создан/)).toBeTruthy();
    expect(posts).toBe(1);
  },
);

test("ссылка владельца работает из каталога, ошибка списка имеет ручной повтор", async () => {
  window.history.replaceState(null, "", "/");
  let fail = false;
  vi.stubGlobal("fetch", async () => (fail ? response({}, 500) : response([])));
  render(<App />);
  await screen.findByText("Нет типов встреч");
  fail = true;
  await userEvent.click(screen.getByRole("link", { name: "Для владельца" }));
  expect(window.location.pathname).toBe("/owner");
  expect(await screen.findByText("Не удалось загрузить типы встреч")).toBeTruthy();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Повторить загрузку типов" }));
  expect(await screen.findByText("Нет типов встреч")).toBeTruthy();
});

test("клиент считает Unicode символы и отправляет нормализованный текст с внутренним форматированием", async () => {
  let payload: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      payload = await request.json();
      return response({ ...created, ...payload }, 201);
    }
    return response([]);
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByLabelText("Название"));
  await user.paste(`  ${"😀".repeat(100)}  `);
  await user.click(screen.getByLabelText("Описание"));
  await user.paste(` \n${"Я".repeat(998)}\n Я \n `);
  await user.type(screen.getByLabelText("Длительность, минут"), "540");
  await user.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(screen.getByText("Описание должно содержать не больше 1000 символов")).toBeTruthy();
  await user.clear(screen.getByLabelText("Описание"));
  await user.click(screen.getByLabelText("Описание"));
  await user.paste("  Строка 1\n Строка 2  ");
  await user.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(await screen.findByText("Тип встречи создан")).toBeTruthy();
  expect(payload).toEqual({
    name: "😀".repeat(100),
    description: "Строка 1\n Строка 2",
    durationMinutes: 540,
  });
  await user.click(screen.getByLabelText("Название"));
  await user.paste("😀".repeat(101));
  await user.type(screen.getByLabelText("Длительность, минут"), "1");
  await user.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(screen.getByText("Введите название от 1 до 100 символов")).toBeTruthy();
});

test("Unicode пробелы по краям нормализуются так же, как на сервере", async () => {
  vi.stubGlobal("fetch", async () => response([]));
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByLabelText("Название"));
  await user.paste("\u0085");
  await user.type(screen.getByLabelText("Длительность, минут"), "1");
  await user.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(screen.getByText("Введите название от 1 до 100 символов")).toBeTruthy();
});

test("неполная ошибка 422 считается неизвестным результатом", async () => {
  vi.stubGlobal("fetch", async (request: Request) =>
    request.method === "POST" ? response({ code: "validation_error" }, 422) : response([]),
  );
  render(<App />);
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  expect(await screen.findByText(/Тип мог быть создан/)).toBeTruthy();
});

test("свежий список заменяет созданные до запроса типы после сброса сервера", async () => {
  let posts = 0;
  vi.stubGlobal("fetch", async (request: Request) => {
    if (request.method === "POST") {
      posts++;
      return posts === 1 ? response(created, 201) : response({}, 500);
    }
    return response([]);
  });
  render(<App />);
  await screen.findByText("Нет типов встреч");
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  await screen.findByRole("heading", { name: "Разбор" });
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  await screen.findByText(/Тип мог быть создан/);
  await userEvent.click(screen.getByRole("button", { name: "Проверить список типов" }));
  await screen.findByText("Нет типов встреч");
  expect(screen.queryByRole("heading", { name: "Разбор" })).toBeNull();
});

test("запоздавший список сохраняет тип, созданный после начала чтения", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", (request: Request) => {
    if (request.method === "POST") return Promise.resolve(response(created, 201));
    if (request.url.endsWith("/api/bookings")) return Promise.resolve(response([]));
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  render(<App />);
  await fill();
  await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
  await screen.findByRole("heading", { name: "Разбор" });
  finish(response([]));
  await waitFor(() => expect(screen.queryByText("Загрузка типов встреч…")).toBeNull());
  expect(screen.getByRole("heading", { name: "Разбор" })).toBeTruthy();
});

test.each([{ unexpected: "Ошибка" }, { name: "" }, ["Ошибка"]])(
  "непонятные ошибки полей %j сохраняют ввод и требуют проверки результата",
  async (fields) => {
    let posts = 0;
    vi.stubGlobal("fetch", async (request: Request) => {
      if (request.method === "POST") {
        posts++;
        return response({ code: "validation_error", fields }, 422);
      }
      return response([]);
    });
    render(<App />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Создать тип" }));
    expect(await screen.findByText(/Тип мог быть создан/)).toBeTruthy();
    expect((screen.getByLabelText("Название") as HTMLInputElement).value).toBe("Разбор");
    expect((screen.getByLabelText("Описание") as HTMLTextAreaElement).value).toBe("Описание");
    expect((screen.getByLabelText("Длительность, минут") as HTMLInputElement).value).toBe("45");
    await userEvent.click(screen.getByRole("button", { name: "Проверить список типов" }));
    await screen.findByText("Нет типов встреч");
    expect(screen.getByText(/Тип мог быть создан/)).toBeTruthy();
    expect(posts).toBe(1);
  },
);

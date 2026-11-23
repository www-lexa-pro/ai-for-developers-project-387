import { expect, test } from "@playwright/test";
import type { Availability } from "../src/api/types.gen";

for (const withTopic of [true, false]) {
  test(withTopic ? "Бронирование с темой" : "Бронирование без темы", async ({ page }) => {
    const typeName = `Проверка полного пути ${Date.now()}`;
    await page.goto("/");
    for (const name of ["Знакомство", "Консультация", "Подробный разбор"])
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    expect(await page.getByRole("article").count()).toBeGreaterThanOrEqual(3);
    await page.getByRole("link", { name: "Для владельца" }).click();
    await page.reload();
    await page.getByLabel("Название", { exact: true }).fill(typeName);
    await page.getByLabel("Описание", { exact: true }).fill("Встреча из настоящего браузера");
    await page.getByLabel("Длительность, минут").fill("45");
    await page.getByRole("button", { name: "Создать тип", exact: true }).click();
    await expect(page.getByText("Тип встречи создан", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Запись на звонок — главная" }).click();
    const type = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: typeName, exact: true }) });
    const availabilityResponse = page.waitForResponse(
      (response) => response.url().endsWith("/availability") && response.status() === 200,
    );
    await type.getByRole("link").click();
    const availability: Availability = await (await availabilityResponse).json();
    await page.reload();
    expect(availability.days).toHaveLength(14);
    const day = availability.days.find((day) => day.slots.length > 0)!;
    expect(day).toBeTruthy();
    const slot = day.slots[0];
    const dayLabel = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "Europe/Moscow",
    }).format(new Date(slot.start));
    const time = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    });
    const interval = `${time.format(new Date(slot.start))}–${time.format(new Date(slot.end))}`;
    await page.getByRole("button", { name: dayLabel, exact: true }).click();
    await page.getByRole("button", { name: interval, exact: true }).click();
    await page.getByLabel("Имя", { exact: true }).fill("Алексей");
    await page.getByLabel("Email", { exact: true }).fill("A+browser@Example.com");
    const topic = "Планирование проекта";
    const topicField = page.getByLabel("Тема звонка", { exact: true });
    await expect(topicField).toHaveValue("");
    if (withTopic) await topicField.fill(topic);
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/bookings") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Записаться", exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const payload = response.request().postDataJSON();
    if (withTopic) expect(payload.topic).toBe(topic);
    else expect(payload).not.toHaveProperty("topic");
    await expect(page.getByRole("heading", { name: "Вы записаны" })).toBeVisible();
    await expect(page.getByText(typeName, { exact: true })).toHaveCount(2);
    const fullDate = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Moscow",
    }).format(new Date(slot.start));
    await expect(
      page.getByText(`${fullDate}, ${interval} (Москва)`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Алексей", { exact: true })).toBeVisible();
    await expect(page.getByText("A+browser@Example.com", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Для владельца" }).click();
    const meetings = page.getByRole("region", { name: "Предстоящие встречи" });
    const card = meetings.getByRole("article").filter({
      has: page.getByRole("heading", { name: typeName, exact: true }),
    });
    await expect(card.getByRole("heading", { name: typeName })).toBeVisible();
    if (withTopic) await expect(card.getByText(topic, { exact: true })).toBeVisible();
    else await expect(card.getByText(topic, { exact: true })).toHaveCount(0);
    for (const value of [
      "Алексей",
      "A+browser@Example.com",
      `${interval} (Москва)`,
      "45 мин",
      new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(new Date(slot.start)),
    ])
      await expect(card.getByText(value, { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("owner-booking.png"), fullPage: true });
  });
}

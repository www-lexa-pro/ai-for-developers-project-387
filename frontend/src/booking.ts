import type { Booking } from "./api/types.gen";

export function isBooking(value: unknown): value is Booking {
  if (!value || typeof value !== "object") return false;
  const item = value as Booking;
  return (
    [item.id, item.meetingTypeId, item.meetingTypeName, item.name, item.email].every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    Number.isInteger(item.durationMinutes) &&
    item.durationMinutes >= 1 &&
    item.durationMinutes <= 540 &&
    typeof item.start === "string" &&
    typeof item.end === "string" &&
    Number.isFinite(Date.parse(item.start)) &&
    Number.isFinite(Date.parse(item.end))
  );
}

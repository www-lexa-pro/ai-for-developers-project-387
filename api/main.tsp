import "@typespec/http";
import "@typespec/openapi";
using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Call Calendar" })
namespace CallCalendar;

model Health {
  status: "ok";
}

@route("/api/health")
@get
@operationId("getHealth")
op getHealth(): Health;

model MeetingType {
  id: string;
  name: string;
  description: string;
  durationMinutes: int32;
}

model MeetingTypeNotFound {
  code: "meeting_type_not_found";
  message: string;
}

@route("/api/meeting-types")
@get
@operationId("listMeetingTypes")
op listMeetingTypes(): MeetingType[];

@route("/api/meeting-types/{id}")
@get
@operationId("getMeetingType")
op getMeetingType(@path id: string): MeetingType | {
  @statusCode statusCode: 404;
  @body body: MeetingTypeNotFound;
};

model AvailableSlot {
  start: utcDateTime;
  end: utcDateTime;
}

model AvailabilityDay {
  date: plainDate;
  unavailableReason?: "weekend" | "fully_booked";
  slots: AvailableSlot[];
}

model Availability {
  timeZone: "Europe/Moscow";
  windowStart: plainDate;
  windowEnd: plainDate;
  days: AvailabilityDay[];
}

@route("/api/meeting-types/{id}/availability")
@get
@operationId("getAvailability")
op getAvailability(@path id: string): Availability | {
  @statusCode statusCode: 404;
  @body body: MeetingTypeNotFound;
};

model CreateMeetingTypeInput {
  name: string;
  description?: string;
  durationMinutes: float64;
}

model InvalidRequest {
  code: "invalid_request";
  message: string;
}

model ValidationError {
  code: "validation_error";
  message: string;
  fields: Record<string>;
}

@route("/api/meeting-types")
@post
@operationId("createMeetingType")
op createMeetingType(@body input: CreateMeetingTypeInput): {
  @statusCode statusCode: 201;
  @body body: MeetingType;
} | {
  @statusCode statusCode: 400;
  @body body: InvalidRequest;
} | {
  @statusCode statusCode: 422;
  @body body: ValidationError;
};

model Booking {
  id: string;
  meetingTypeId: string;
  meetingTypeName: string;
  durationMinutes: int32;
  start: utcDateTime;
  end: utcDateTime;
  name: string;
  email: string;
  topic?: string;
}

model CreateBookingInput {
  meetingTypeId: string;
  start: string;
  name: string;
  email: string;
  topic?: string;
}

model BookingConflict {
  code: "time_busy" | "invalid_time";
  message: string;
}

model InternalError {
  code: "internal_error";
  message: string;
}

@route("/api/bookings")
@post
@operationId("createBooking")
op createBooking(@body input: CreateBookingInput): {
  @statusCode statusCode: 201;
  @body body: Booking;
} | {
  @statusCode statusCode: 400;
  @body body: InvalidRequest;
} | {
  @statusCode statusCode: 422;
  @body body: ValidationError;
} | {
  @statusCode statusCode: 404;
  @body body: MeetingTypeNotFound;
} | {
  @statusCode statusCode: 409;
  @body body: BookingConflict;
} | {
  @statusCode statusCode: 500;
  @body body: InternalError;
};

@route("/api/bookings")
@get
@operationId("listBookings")
op listBookings(): Booking[];

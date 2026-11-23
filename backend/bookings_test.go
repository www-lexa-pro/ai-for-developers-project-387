package main

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func bookingApp(now func() time.Time, middleware ...gin.HandlerFunc) *httptest.Server {
	return httptest.NewServer(newRouterWithServer(newServerWithClock(now), middleware...))
}
func bookingPost(t *testing.T, app *httptest.Server, body any) (int, map[string]any) {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r, err := http.Post(app.URL+"/api/bookings", "application/json", strings.NewReader(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Body.Close() }()
	var result map[string]any
	_ = json.NewDecoder(r.Body).Decode(&result)
	return r.StatusCode, result
}
func bookingType(t *testing.T, app *httptest.Server) string {
	t.Helper()
	var types []api.MeetingType
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	return types[0].Id
}
func TestBookingConfirmationAndAvailability(t *testing.T) {
	app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
	defer app.Close()
	id := bookingType(t, app)
	status, body := bookingPost(t, app, map[string]any{"meetingTypeId": id, "start": "2026-11-16T09:00:00+03:00", "name": "  Алексей  ", "email": " A+tag@Example.com "})
	if status != 201 || body["id"] == nil || body["id"] == "" || body["durationMinutes"] != float64(15) || body["meetingTypeId"] != id || body["meetingTypeName"] != "Знакомство" || body["name"] != "Алексей" || body["email"] != "A+tag@Example.com" || body["start"] != "2026-11-16T09:00:00+03:00" || body["end"] != "2026-11-16T09:15:00+03:00" {
		t.Fatalf("confirmation: %d %+v", status, body)
	}
	var availability api.Availability
	getJSON(t, app.URL+"/api/meeting-types/"+id+"/availability", 200, &availability)
	if availability.Days[0].Slots[0].Start.Format("15:04") != "09:30" {
		t.Fatalf("booked slot remains available: %+v", availability.Days[0])
	}
}

func TestBookingRejectsOverlapAcrossTypesAndAllowsTouch(t *testing.T) {
	app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
	defer app.Close()
	var types []api.MeetingType
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	// A 60 minute reservation contains 09:30 of every shorter type.
	for _, tc := range []struct {
		typeIndex int
		start     string
		status    int
	}{
		{2, "09:00", 201}, {0, "09:00", 409}, {0, "09:30", 409}, {1, "09:30", 409}, {2, "09:30", 409}, {1, "10:00", 201}, {0, "10:30", 201},
	} {
		status, body := bookingPost(t, app, map[string]any{"meetingTypeId": types[tc.typeIndex].Id, "start": "2026-11-16T" + tc.start + ":00+03:00", "name": "Гость", "email": "a@example.com"})
		if status != tc.status || (status == 409 && body["code"] != "time_busy") {
			t.Fatalf("overlap %s type %d: %d %+v, want %d", tc.start, tc.typeIndex, status, body, tc.status)
		}
	}
	// Availability of every type reflects the same reservations.
	var availability api.Availability
	getJSON(t, app.URL+"/api/meeting-types/"+types[2].Id+"/availability", 200, &availability)
	if availability.Days[0].Slots[0].Start.Format("15:04") != "11:00" {
		t.Fatalf("cross-type availability: %+v", availability.Days[0])
	}
}

func TestBookingValidationAndSchedule(t *testing.T) {
	app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 20, 59, 59, 0, time.UTC) })
	defer app.Close()
	id := bookingType(t, app)
	for _, tc := range []struct {
		name, email, start string
		status             int
		code               string
	}{
		{" \u0085 ", "bad", "not-a-date", 422, "validation_error"},
		{strings.Repeat("😀", 101), "a@localhost", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", "я@example.com", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", "a b@example.com", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", "a@@example.com", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", "a@.com", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", strings.Repeat("a", 243) + "@example.com", "2026-11-16T09:00:00+03:00", 422, "validation_error"},
		{"Я", "a@example.com", "2026-11-15T09:00:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-30T09:00:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-21T09:00:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T08:30:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T18:00:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T09:15:00+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T09:00:01+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T09:00:00.000000001+03:00", 409, "invalid_time"},
		{"Я", "a@example.com", "2026-11-16T09:00:00.0000000001+03:00", 409, "invalid_time"},
		{"Я", strings.Repeat("a", 242) + "@example.com", "2026-11-16T09:00:00+03:00", 201, ""},
		{strings.Repeat("😀", 100), " A+Tag@Example.COM ", "2026-11-16T17:30:00+03:00", 201, ""},
		{"Я", "a@example.com", "2026-11-27T09:00:00+03:00", 201, ""},
	} {
		status, result := bookingPost(t, app, map[string]any{"meetingTypeId": id, "name": tc.name, "email": tc.email, "start": tc.start})
		if status != tc.status || (tc.code != "" && result["code"] != tc.code) {
			t.Fatalf("%q %q %s: %d %+v want %d %s", tc.name, tc.email, tc.start, status, result, tc.status, tc.code)
		}
		if tc.start == "not-a-date" {
			fields, ok := result["fields"].(map[string]any)
			if !ok || len(fields) != 3 || fields["name"] == nil || fields["email"] == nil || fields["start"] == nil {
				t.Fatalf("all field errors: %+v", result)
			}
		}
	}
	status, body := bookingPost(t, app, map[string]any{"meetingTypeId": "missing", "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:00:00+03:00"})
	if status != 404 || body["code"] != "meeting_type_not_found" {
		t.Fatalf("missing: %d %+v", status, body)
	}
}

func TestBookingConcurrentRequests(t *testing.T) {
	for _, intersect := range []bool{true, false} {
		t.Run(map[bool]string{true: "intersecting", false: "separate"}[intersect], func(t *testing.T) {
			app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
			defer app.Close()
			id := bookingType(t, app)
			ready := make(chan struct{})
			results := make(chan int, 8)
			for i := range 8 {
				go func() {
					<-ready
					minute := i * 30
					if intersect {
						minute = 0
					}
					start := time.Date(2026, 11, 16, 9, minute, 0, 0, moscow)
					data, _ := json.Marshal(map[string]any{"meetingTypeId": id, "name": "Я", "email": "a@example.com", "start": start.Format(time.RFC3339)})
					r, err := http.Post(app.URL+"/api/bookings", "application/json", strings.NewReader(string(data)))
					if err != nil {
						results <- 0
						return
					}
					_ = r.Body.Close()
					results <- r.StatusCode
				}()
			}
			close(ready)
			successes, conflicts := 0, 0
			for range 8 {
				switch <-results {
				case 201:
					successes++
				case 409:
					conflicts++
				}
			}
			want := 8
			if intersect {
				want = 1
			}
			if successes != want || conflicts != 8-want {
				t.Fatalf("successes %d conflicts %d want %d/%d", successes, conflicts, want, 8-want)
			}
			var availability api.Availability
			getJSON(t, app.URL+"/api/meeting-types/"+id+"/availability", 200, &availability)
			var saved []api.Booking
			getJSON(t, app.URL+"/api/bookings", 200, &saved)
			if len(saved) != want {
				t.Fatalf("owner list: %d bookings for %d successful requests", len(saved), want)
			}
			if len(availability.Days[0].Slots) != 18-want {
				t.Fatalf("saved reservations disagree: %d free, %d successes", len(availability.Days[0].Slots), successes)
			}
		})
	}
}

func TestBookingChecksDateAfterWaitingForCalendar(t *testing.T) {
	entered, release, arrived, earlyClock := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{}, 1)
	var calls atomic.Int32
	var midnight atomic.Bool
	app := bookingApp(func() time.Time {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
			return time.Date(2026, 11, 15, 20, 59, 59, 0, time.UTC)
		}
		if !midnight.Load() {
			earlyClock <- struct{}{}
			return time.Date(2026, 11, 15, 20, 59, 59, 0, time.UTC)
		}
		return time.Date(2026, 11, 15, 21, 0, 0, 0, time.UTC)
	}, func(c *gin.Context) {
		if c.Request.Method == "POST" && c.Request.URL.Path == "/api/bookings" {
			close(arrived)
		}
	})
	defer app.Close()
	id := bookingType(t, app)
	// Availability holds the calendar at its clock seam; the booking reaches HTTP
	// before midnight, but must read its own time only after the calendar is released.
	done := make(chan struct{})
	go func() {
		r, err := http.Get(app.URL + "/api/meeting-types/" + id + "/availability")
		if err == nil {
			_ = r.Body.Close()
		}
		close(done)
	}()
	<-entered
	result := make(chan int, 1)
	go func() {
		data := `{"meetingTypeId":"` + id + `","name":"Я","email":"a@example.com","start":"2026-11-16T09:00:00+03:00"}`
		r, err := http.Post(app.URL+"/api/bookings", "application/json", strings.NewReader(data))
		if err != nil {
			result <- 0
			return
		}
		_ = r.Body.Close()
		result <- r.StatusCode
	}()
	<-arrived
	early := false
	select {
	case <-earlyClock:
		early = true
	case <-time.After(50 * time.Millisecond):
	}
	midnight.Store(true)
	close(release)
	<-done
	status := <-result
	if early || status != 409 {
		t.Fatalf("clock read before calendar was available: early=%v status=%d", early, status)
	}
}

func TestBookingRestartAndInvalidJSON(t *testing.T) {
	clock := func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) }
	app := bookingApp(clock)
	defer app.Close()
	id := bookingType(t, app)
	status, _ := bookingPost(t, app, map[string]any{"meetingTypeId": id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:00:00+03:00"})
	if status != 201 {
		t.Fatal(status)
	}
	r, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(`{"name":"Дополнительный","durationMinutes":45}`))
	if err != nil {
		t.Fatal(err)
	}
	var additional api.MeetingType
	_ = json.NewDecoder(r.Body).Decode(&additional)
	_ = r.Body.Close()
	if r.StatusCode != 201 {
		t.Fatal(r.StatusCode)
	}
	restarted := bookingApp(clock)
	defer restarted.Close()
	newID := bookingType(t, restarted)
	var resetTypes []api.MeetingType
	getJSON(t, restarted.URL+"/api/meeting-types", 200, &resetTypes)
	if len(resetTypes) != 3 {
		t.Fatalf("additional type survived: %+v", resetTypes)
	}
	var missing map[string]any
	getJSON(t, restarted.URL+"/api/meeting-types/"+additional.Id, 404, &missing)
	var resetBookings []api.Booking
	getJSON(t, restarted.URL+"/api/bookings", 200, &resetBookings)
	if resetBookings == nil || len(resetBookings) != 0 {
		t.Fatalf("bookings survived: %+v", resetBookings)
	}
	var availability api.Availability
	getJSON(t, restarted.URL+"/api/meeting-types/"+newID+"/availability", 200, &availability)
	if len(availability.Days[0].Slots) != 18 {
		t.Fatal("bookings survived restart")
	}
	status, _ = bookingPost(t, restarted, map[string]any{"meetingTypeId": id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:00:00+03:00"})
	if status != 404 {
		t.Fatal("old type valid after restart", status)
	}
	for _, body := range []string{`null`, `{`, `{} {}`, `{"name":42}`, `{"start":null}`} {
		r, err := http.Post(app.URL+"/api/bookings", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var failure map[string]any
		_ = json.NewDecoder(r.Body).Decode(&failure)
		_ = r.Body.Close()
		if r.StatusCode != 400 || failure["code"] != "invalid_request" {
			t.Fatalf("invalid JSON %s: %d %+v", body, r.StatusCode, failure)
		}
	}
}

func TestBookingInternalErrorIsJSON(t *testing.T) {
	app := bookingApp(func() time.Time { panic("clock unavailable") })
	defer app.Close()
	id := bookingType(t, app)
	status, result := bookingPost(t, app, map[string]any{"meetingTypeId": id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:00:00+03:00"})
	if status != 500 || result["code"] != "internal_error" || result["message"] == "" {
		t.Fatalf("internal error: %d %+v", status, result)
	}
}

func TestBookingDurationsEndAtClosingAndEnclosingIntervals(t *testing.T) {
	for _, duration := range []int{1, 15, 30, 45, 540} {
		t.Run(fmt.Sprint(duration), func(t *testing.T) {
			app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
			defer app.Close()
			data := fmt.Sprintf(`{"name":"Разбор","durationMinutes":%d}`, duration)
			r, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(data))
			if err != nil {
				t.Fatal(err)
			}
			var meeting api.MeetingType
			_ = json.NewDecoder(r.Body).Decode(&meeting)
			_ = r.Body.Close()
			start := "17:30"
			if duration == 45 {
				start = "17:00"
			}
			if duration == 540 {
				start = "09:00"
			}
			status, body := bookingPost(t, app, map[string]any{"meetingTypeId": meeting.Id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T" + start + ":00+03:00"})
			if status != 201 {
				t.Fatalf("duration %d: %d %+v", duration, status, body)
			}
			if duration == 30 || duration == 540 {
				if body["end"] != "2026-11-16T18:00:00+03:00" {
					t.Fatalf("closing: %+v", body)
				}
			}
			if duration == 45 || duration == 540 {
				status, body = bookingPost(t, app, map[string]any{"meetingTypeId": meeting.Id, "name": "Я", "email": "a@example.com", "start": "2026-11-17T17:30:00+03:00"})
				if status != 409 || body["code"] != "invalid_time" {
					t.Fatalf("past closing: %d %+v", status, body)
				}
			}
		})
	}
	app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
	defer app.Close()
	var types []api.MeetingType
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	status, _ := bookingPost(t, app, map[string]any{"meetingTypeId": types[0].Id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:30:00+03:00"})
	if status != 201 {
		t.Fatal(status)
	}
	status, result := bookingPost(t, app, map[string]any{"meetingTypeId": types[2].Id, "name": "Я", "email": "a@example.com", "start": "2026-11-16T09:00:00+03:00"})
	if status != 409 || result["code"] != "time_busy" {
		t.Fatalf("enclosing overlap: %d %+v", status, result)
	}
}

func TestBookingMoscowWindowBoundary(t *testing.T) {
	app := bookingApp(func() time.Time { return time.Date(2026, 11, 15, 21, 0, 0, 0, time.UTC) })
	defer app.Close()
	id := bookingType(t, app)
	for _, tc := range []struct {
		date   string
		status int
	}{{"2026-11-16", 409}, {"2026-11-17", 201}, {"2026-11-30", 201}, {"2026-12-01", 409}} {
		status, body := bookingPost(t, app, map[string]any{"meetingTypeId": id, "name": "Я", "email": "a@example.com", "start": tc.date + "T09:00:00+03:00"})
		if status != tc.status {
			t.Fatalf("Moscow window %s: %d %+v", tc.date, status, body)
		}
	}
}

func TestOwnerBookingsAreFutureSortedAcrossTypes(t *testing.T) {
	var current atomic.Int64
	current.Store(time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC).Unix())
	app := bookingApp(func() time.Time { return time.Unix(current.Load(), 0) })
	defer app.Close()
	var empty []api.Booking
	getJSON(t, app.URL+"/api/bookings", 200, &empty)
	if empty == nil || len(empty) != 0 {
		t.Fatalf("empty list: %+v", empty)
	}
	var types []api.MeetingType
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	for i, start := range []string{"2026-11-27T09:00:00+03:00", "2026-11-16T10:00:00+03:00", "2026-11-16T09:00:00+03:00"} {
		status, body := bookingPost(t, app, map[string]any{"meetingTypeId": types[i].Id, "start": start, "name": "Гость", "email": "a@example.com"})
		if status != 201 {
			t.Fatalf("create: %d %+v", status, body)
		}
	}
	var bookings []api.Booking
	getJSON(t, app.URL+"/api/bookings", 200, &bookings)
	if len(bookings) != 3 || bookings[0].MeetingTypeId != types[2].Id || bookings[1].MeetingTypeId != types[1].Id || bookings[2].MeetingTypeId != types[0].Id || bookings[0].Name != "Гость" || bookings[0].Email != "a@example.com" {
		t.Fatalf("ordered confirmations: %+v", bookings)
	}
	current.Store(time.Date(2026, 11, 16, 9, 0, 0, 0, moscow).Unix())
	getJSON(t, app.URL+"/api/bookings", 200, &bookings)
	if len(bookings) != 2 || bookings[0].Start.Hour() != 10 {
		t.Fatalf("exact start must be excluded: %+v", bookings)
	}
	// The owner sees all future reservations even when the clock moves so a saved
	// reservation is now outside the guest's current fourteen-date window.
	current.Store(time.Date(2026, 10, 1, 0, 0, 0, 0, moscow).Unix())
	getJSON(t, app.URL+"/api/bookings", 200, &bookings)
	if len(bookings) != 3 {
		t.Fatalf("owner list was restricted by booking window: %+v", bookings)
	}
	current.Store(time.Date(2026, 11, 28, 0, 0, 0, 0, moscow).Unix())
	getJSON(t, app.URL+"/api/bookings", 200, &bookings)
	if bookings == nil || len(bookings) != 0 {
		t.Fatalf("past bookings: %+v", bookings)
	}
}

func TestBookingTopic(t *testing.T) {
	app := bookingApp(func() time.Time {
		return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	})
	defer app.Close()
	id := bookingType(t, app)

	for _, tc := range []struct {
		time   string
		input  map[string]any
		want   any
		status int
	}{
		{"09:00", map[string]any{"topic": "  Обсуждение проекта  "}, "Обсуждение проекта", 201},
		{"09:30", nil, nil, 201},
		{"10:00", map[string]any{"topic": ""}, nil, 201},
		{"10:30", map[string]any{"topic": "   "}, nil, 201},
		{"11:00", map[string]any{"topic": nil}, nil, 400},
		{"11:00", map[string]any{"topic": 123}, nil, 400},
		{"09:00", map[string]any{"topic": "Другой звонок"}, nil, 409},
	} {
		input := map[string]any{
			"meetingTypeId": id, "start": "2026-11-16T" + tc.time + ":00+03:00",
			"name": "Гость", "email": "a@example.com",
		}
		for key, value := range tc.input {
			input[key] = value
		}
		status, body := bookingPost(t, app, input)
		if status != tc.status {
			t.Fatalf("input %v: got %d %v, want status %d", input, status, body, tc.status)
		}
		if status == 201 {
			assertBookingTopic(t, body, tc.want)
		}
		if status == 409 && body["code"] != "time_busy" {
			t.Fatalf("expected time_busy, got %v", body)
		}
	}

	var bookings []map[string]any
	getJSON(t, app.URL+"/api/bookings", 200, &bookings)
	if len(bookings) != 4 {
		t.Fatalf("expected four bookings, got %v", bookings)
	}
	assertBookingTopic(t, bookings[0], "Обсуждение проекта")
	for _, booking := range bookings[1:] {
		assertBookingTopic(t, booking, nil)
	}
}

func assertBookingTopic(t *testing.T, booking map[string]any, want any) {
	t.Helper()
	topic, exists := booking["topic"]
	if topic != want || exists != (want != nil) {
		t.Fatalf("expected topic %v, got booking %v", want, booking)
	}
}

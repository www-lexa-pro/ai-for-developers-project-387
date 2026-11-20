package main

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
)

func TestAvailabilityUsesMoscowTomorrowAndFourteenDates(t *testing.T) {
	s := newServer()
	s.now = func() time.Time { return time.Date(2026, 11, 15, 21, 0, 0, 0, time.UTC) }
	router := gin.New()
	api.RegisterHandlers(router, api.NewStrictHandler(s, nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/"+s.meetingTypes[0].Id+"/availability", nil))
	if response.Code != 200 {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		TimeZone string `json:"timeZone"`
		Days     []struct {
			Date  string `json:"date"`
			Slots []struct {
				Start time.Time `json:"start"`
				End   time.Time `json:"end"`
			} `json:"slots"`
		} `json:"days"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.TimeZone != "Europe/Moscow" || len(body.Days) != 14 || body.Days[0].Date != "2026-11-17" || body.Days[13].Date != "2026-11-30" {
		t.Fatalf("unexpected window: %+v", body)
	}
	if len(body.Days[0].Slots) != 18 || body.Days[0].Slots[0].Start.Format(time.RFC3339) != "2026-11-17T09:00:00+03:00" || body.Days[0].Slots[17].End.Format(time.RFC3339) != "2026-11-17T17:45:00+03:00" {
		t.Fatalf("unexpected slots: %+v", body.Days[0])
	}
	if len(body.Days[4].Slots) != 0 || len(body.Days[5].Slots) != 0 {
		t.Fatal("weekend available")
	}
}

func TestAvailabilityDurationsAndOverlap(t *testing.T) {
	for _, example := range []struct {
		duration, count int
		last            string
	}{
		{1, 18, "17:31"}, {15, 18, "17:45"}, {30, 18, "18:00"}, {45, 17, "17:45"}, {540, 1, "18:00"},
	} {
		t.Run(time.Duration(example.duration).String(), func(t *testing.T) {
			s := newServer()
			s.now = func() time.Time { return time.Date(2026, 11, 15, 20, 59, 59, 0, time.UTC) }
			s.meetingTypes = []api.MeetingType{{Id: "fixture", DurationMinutes: int32(example.duration)}}
			router := gin.New()
			api.RegisterHandlers(router, api.NewStrictHandler(s, nil))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/fixture/availability", nil))
			var body api.Availability
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != 200 || body.WindowStart.String() != "2026-11-16" || body.WindowEnd.String() != "2026-11-29" {
				t.Fatalf("window %d %+v", response.Code, body)
			}
			slots := body.Days[0].Slots
			if len(slots) != example.count || slots[len(slots)-1].End.Format("15:04") != example.last {
				t.Fatalf("duration %d: %+v", example.duration, slots)
			}
		})
	}
	s := newServer()
	s.now = func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) }
	at := func(hour, minute int) time.Time { return time.Date(2026, 11, 16, hour, minute, 0, 0, moscow) }
	// Store fixture represents reservations of other types, before POST /bookings exists.
	s.bookings = []bookingInterval{{start: at(9, 0), end: at(9, 45)}, {start: at(10, 30), end: at(11, 30)}, {start: at(12, 0), end: at(12, 30)}}
	s.meetingTypes = []api.MeetingType{{Id: "fixture", DurationMinutes: 45}}
	router := gin.New()
	api.RegisterHandlers(router, api.NewStrictHandler(s, nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/fixture/availability", nil))
	var body api.Availability
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	starts := []string{}
	for _, slot := range body.Days[0].Slots {
		starts = append(starts, slot.Start.Format("15:04"))
	}
	// 10:00 overlaps the 10:30 booking; 11:30 overlaps the 12:00 booking.
	want := []string{"12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"}
	if !reflect.DeepEqual(starts, want) {
		t.Fatalf("overlap: got %v want %v", starts, want)
	}
	s.bookings = []bookingInterval{{start: at(9, 0), end: at(9, 45)}}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/fixture/availability", nil))
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Days[0].Slots[0].Start.Format("15:04") != "10:00" {
		t.Fatal("45 minute meeting should allow 10:00")
	}
}

func TestAvailabilityUnavailableReasonsAndMissingType(t *testing.T) {
	s := newServer()
	s.now = func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) }
	s.bookings = []bookingInterval{{start: time.Date(2026, 11, 16, 9, 0, 0, 0, moscow), end: time.Date(2026, 11, 16, 18, 0, 0, 0, moscow)}}
	router := gin.New()
	api.RegisterHandlers(router, api.NewStrictHandler(s, nil))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/"+s.meetingTypes[0].Id+"/availability", nil))
	var body api.Availability
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Days[0].Slots) != 0 || body.Days[0].UnavailableReason == nil || *body.Days[0].UnavailableReason != api.FullyBooked || body.Days[5].UnavailableReason == nil || *body.Days[5].UnavailableReason != api.Weekend {
		t.Fatalf("reasons: %+v", body.Days)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/meeting-types/missing/availability", nil))
	if response.Code != 404 || !strings.Contains(response.Body.String(), "meeting_type_not_found") {
		t.Fatalf("missing: %d %s", response.Code, response.Body.String())
	}
}

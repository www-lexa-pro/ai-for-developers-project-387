package main

import (
	"context"
	"crypto/rand"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
)

var emailPattern = regexp.MustCompile("^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$")
var timestampFraction = regexp.MustCompile(`[.,]([0-9]+)`)

func (s *server) CreateBooking(_ context.Context, request api.CreateBookingRequestObject) (api.CreateBookingResponseObject, error) {
	input := request.Body
	if input == nil {
		return api.CreateBooking400JSONResponse{Code: api.InvalidRequestCodeInvalidRequest, Message: "Не удалось разобрать запрос"}, nil
	}
	fields := map[string]string{}
	name, valid := normalizedText(input.Name, 1, 100)
	if !valid {
		fields["name"] = "Введите имя от 1 до 100 символов"
	}
	email := strings.TrimSpace(input.Email)
	if len(email) > 254 || !emailPattern.MatchString(email) {
		fields["email"] = "Введите email до 254 символов, например name@example.com"
	}
	start, err := time.Parse(time.RFC3339Nano, input.Start)
	if err != nil {
		fields["start"] = "Выберите корректное время встречи"
	}
	if len(fields) > 0 {
		return api.CreateBooking422JSONResponse{Code: api.ValidationErrorCodeValidationError, Message: "Проверьте поля формы", Fields: fields}, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, meetingType := range s.meetingTypes {
		if meetingType.Id != input.MeetingTypeId {
			continue
		}
		// Read the clock only after waiting for the common calendar lock and
		// finding the type; availability and booking share the exact schedule rules.
		days := availableDays(s.now(), int(meetingType.DurationMinutes), nil)
		allowed := false
		for _, day := range days {
			for _, slot := range day.slots {
				if start.Equal(slot.start) {
					allowed = true
					break
				}
			}
		}
		// time.Parse truncates fractions beyond nanoseconds. Never silently accept
		// a nonzero sub-nanosecond offset as an exact grid start.
		fraction := timestampFraction.FindStringSubmatch(input.Start)
		if len(fraction) > 1 && strings.Trim(fraction[1], "0") != "" {
			allowed = false
		}
		if !allowed {
			return api.CreateBooking409JSONResponse{Code: api.InvalidTime, Message: "Выберите новое время: прежнее время больше не входит в расписание или окно записи"}, nil
		}
		confirmation := api.Booking{Id: rand.Text(), MeetingTypeId: meetingType.Id, MeetingTypeName: meetingType.Name, DurationMinutes: meetingType.DurationMinutes, Start: start.In(moscow), End: start.Add(time.Duration(meetingType.DurationMinutes) * time.Minute).In(moscow), Name: name, Email: email}
		for _, booking := range s.bookings {
			if overlaps(confirmation.Start, confirmation.End, booking) {
				return api.CreateBooking409JSONResponse{Code: api.TimeBusy, Message: "Это время уже занято"}, nil
			}
		}
		s.bookings = append(s.bookings, bookingInterval{start: confirmation.Start, end: confirmation.End, confirmation: confirmation})
		return api.CreateBooking201JSONResponse(confirmation), nil
	}
	return api.CreateBooking404JSONResponse{Code: api.MeetingTypeNotFoundCodeMeetingTypeNotFound, Message: "Этот тип встречи больше недоступен"}, nil
}

func (s *server) ListBookings(_ context.Context, _ api.ListBookingsRequestObject) (api.ListBookingsResponseObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	result := api.ListBookings200JSONResponse{}
	for _, booking := range s.bookings {
		if booking.start.After(now) {
			result = append(result, booking.confirmation)
		}
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].Start.Before(result[j].Start) })
	return result, nil
}

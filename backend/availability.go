package main

import (
	"context"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
)

func (s *server) GetAvailability(_ context.Context, request api.GetAvailabilityRequestObject) (api.GetAvailabilityResponseObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, meetingType := range s.meetingTypes {
		if meetingType.Id != request.Id {
			continue
		}
		days := availableDays(s.now(), int(meetingType.DurationMinutes), s.bookings)
		response := api.GetAvailability200JSONResponse{
			TimeZone:    api.EuropeMoscow,
			WindowStart: openapi_types.Date{Time: days[0].date},
			WindowEnd:   openapi_types.Date{Time: days[13].date},
			Days:        make([]api.AvailabilityDay, 0, 14),
		}
		for _, day := range days {
			item := api.AvailabilityDay{Date: openapi_types.Date{Time: day.date}, Slots: []api.AvailableSlot{}}
			if day.reason != "" {
				reason := api.AvailabilityDayUnavailableReason(day.reason)
				item.UnavailableReason = &reason
			}
			for _, slot := range day.slots {
				item.Slots = append(item.Slots, api.AvailableSlot{Start: slot.start, End: slot.end})
			}
			response.Days = append(response.Days, item)
		}
		return response, nil
	}
	return api.GetAvailability404JSONResponse{Code: api.MeetingTypeNotFoundCodeMeetingTypeNotFound, Message: "Этот тип встречи больше недоступен"}, nil
}

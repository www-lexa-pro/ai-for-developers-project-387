package main

import (
	"context"
	"crypto/rand"
	"math"

	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
)

func (s *server) CreateMeetingType(_ context.Context, request api.CreateMeetingTypeRequestObject) (api.CreateMeetingTypeResponseObject, error) {
	input := request.Body
	if input == nil {
		return api.CreateMeetingType400JSONResponse{Code: api.InvalidRequestCodeInvalidRequest, Message: "Не удалось разобрать запрос"}, nil
	}
	fields := map[string]string{}
	name, valid := normalizedText(input.Name, 1, 100)
	if !valid {
		fields["name"] = "Введите название от 1 до 100 символов"
	}
	description := ""
	if input.Description != nil {
		description = *input.Description
	}
	description, valid = normalizedText(description, 0, 1000)
	if !valid {
		fields["description"] = "Описание должно содержать не больше 1000 символов"
	}
	duration := input.DurationMinutes
	if math.IsNaN(duration) || math.IsInf(duration, 0) || duration < 1 || duration > 540 || duration != math.Trunc(duration) {
		fields["durationMinutes"] = "Введите целое число от 1 до 540"
	}
	if len(fields) > 0 {
		return api.CreateMeetingType422JSONResponse{Code: api.ValidationErrorCodeValidationError, Message: "Проверьте поля формы", Fields: fields}, nil
	}
	meetingType := api.MeetingType{Id: rand.Text(), Name: name, Description: description, DurationMinutes: int32(duration)}
	s.mu.Lock()
	s.meetingTypes = append(s.meetingTypes, meetingType)
	s.mu.Unlock()
	return api.CreateMeetingType201JSONResponse(meetingType), nil
}

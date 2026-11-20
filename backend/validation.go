package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"unicode/utf8"
)

// normalizedText trims only the edges; internal spacing and line breaks survive.
func normalizedText(value string, minLength, maxLength int) (string, bool) {
	value = strings.TrimSpace(value)
	length := utf8.RuneCountInString(value)
	return value, length >= minLength && length <= maxLength
}

// validateJSONBody rejects trailing JSON and null before the generated decoder.
func validateJSONBody(c *gin.Context) {
	if c.Request.Method != http.MethodPost || !strings.HasPrefix(c.Request.URL.Path, "/api/") {
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	trimmed := bytes.TrimSpace(body)
	if err != nil || len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "message": "Не удалось разобрать запрос"})
		return
	}
	var nonNullFields []string
	switch c.Request.URL.Path {
	case "/api/bookings":
		nonNullFields = []string{"meetingTypeId", "start", "name", "email"}
	case "/api/meeting-types":
		nonNullFields = []string{"name", "description", "durationMinutes"}
	}
	if len(nonNullFields) > 0 {
		// Go's JSON decoder accepts null as a scalar's zero value.
		// Preserve the contract distinction: wrong JSON types are 400,
		// while empty strings receive the normal field validation response.
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &fields); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "message": "Не удалось разобрать запрос"})
			return
		}
		for _, key := range nonNullFields {
			if bytes.Equal(bytes.TrimSpace(fields[key]), []byte("null")) {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "message": "Не удалось разобрать запрос"})
				return
			}
		}
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
}

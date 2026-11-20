package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateMeetingTypeHTTP(t *testing.T) {
	app := httptest.NewServer(newRouter())
	defer app.Close()
	r, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(`{"name":"  Разбор  ","description":"  Строка 1\n Строка 2  ","durationMinutes":45}`))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Body.Close() }()
	var created map[string]any
	_ = json.NewDecoder(r.Body).Decode(&created)
	if r.StatusCode != 201 || created["name"] != "Разбор" || created["description"] != "Строка 1\n Строка 2" || created["durationMinutes"] != float64(45) || created["id"] == "" {
		t.Fatalf("create: %d %+v", r.StatusCode, created)
	}
	var list []map[string]any
	getJSON(t, app.URL+"/api/meeting-types", 200, &list)
	if len(list) != 4 || list[3]["id"] != created["id"] {
		t.Fatalf("list: %+v", list)
	}
}

func TestCreateMeetingTypeRejectsInvalidJSON(t *testing.T) {
	app := httptest.NewServer(newRouter())
	defer app.Close()
	for _, body := range []string{`{`, `null`, `{"name":123,"durationMinutes":15}`, `{"name":"Разбор","durationMinutes":15} {}`} {
		r, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var failure map[string]any
		_ = json.NewDecoder(r.Body).Decode(&failure)
		_ = r.Body.Close()
		if r.StatusCode != 400 || failure["code"] != "invalid_request" || failure["message"] == "" {
			t.Fatalf("body %s: %d %+v", body, r.StatusCode, failure)
		}
	}
	var types []map[string]any
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	if len(types) != 3 {
		t.Fatalf("invalid request created type: %+v", types)
	}
}

func TestCreateMeetingTypeValidationAndBounds(t *testing.T) {
	app := httptest.NewServer(newRouter())
	defer app.Close()
	for _, tc := range []struct {
		name, description string
		duration          float64
		status            int
	}{
		{"Я", "", 1, 201},
		{strings.Repeat("😀", 100), strings.Repeat("Я", 1000), 540, 201},
		{"Я", "", 45, 201},
		{"Я", "", 45, 201},
		{" \n ", strings.Repeat("Я", 1001), 0, 422},
		{strings.Repeat("😀", 101), "", 541, 422},
		{"Я", "", 1.5, 422},
	} {
		data, err := json.Marshal(map[string]any{"name": tc.name, "description": tc.description, "durationMinutes": tc.duration})
		if err != nil {
			t.Fatal(err)
		}
		r, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(string(data)))
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		_ = json.NewDecoder(r.Body).Decode(&result)
		_ = r.Body.Close()
		if r.StatusCode != tc.status {
			t.Fatalf("status %d want %d: %+v", r.StatusCode, tc.status, result)
		}
		if tc.status == 422 {
			if result["code"] != "validation_error" {
				t.Fatalf("error: %+v", result)
			}
			fields, ok := result["fields"].(map[string]any)
			if !ok {
				t.Fatalf("fields: %+v", result)
			}
			if tc.name == " \n " && (len(fields) != 3 || fields["name"] == nil || fields["description"] == nil || fields["durationMinutes"] == nil) {
				t.Fatalf("all errors: %+v", fields)
			}
		}
	}
	var types []map[string]any
	getJSON(t, app.URL+"/api/meeting-types", 200, &types)
	if len(types) != 7 || types[5]["name"] != "Я" || types[6]["name"] != "Я" || types[5]["id"] == types[6]["id"] {
		t.Fatalf("duplicate names and order: %+v", types)
	}
}

func TestCreateMeetingTypeRejectsNullFields(t *testing.T) {
	app := httptest.NewServer(newRouter())
	defer app.Close()
	for _, example := range []struct{ field, body string }{
		{"name", `{"name":null,"durationMinutes":15}`},
		{"durationMinutes", `{"name":"Тест","durationMinutes":null}`},
		{"description", `{"name":"Тест","description":null,"durationMinutes":15}`},
	} {
		t.Run(example.field, func(t *testing.T) {
			response, err := http.Post(app.URL+"/api/meeting-types", "application/json", strings.NewReader(example.body))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			var failure map[string]any
			if err := json.NewDecoder(response.Body).Decode(&failure); err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != http.StatusBadRequest || failure["code"] != "invalid_request" {
				t.Fatalf("null %s: %d %+v, want 400 invalid_request", example.field, response.StatusCode, failure)
			}
		})
	}
	var types []map[string]any
	getJSON(t, app.URL+"/api/meeting-types", http.StatusOK, &types)
	if len(types) != 3 {
		t.Fatalf("null input created a type: %+v", types)
	}
}

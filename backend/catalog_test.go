package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCatalogHTTP(t *testing.T) {
	app := httptest.NewServer(newRouter())
	defer app.Close()
	r, err := http.Get(app.URL + "/api/meeting-types")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Body.Close() }()
	var types []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Duration    int    `json:"durationMinutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&types); err != nil {
		t.Fatal(err)
	}
	if r.StatusCode != 200 || len(types) != 3 {
		t.Fatalf("catalog: %d %+v", r.StatusCode, types)
	}
	for i, name := range []string{"Знакомство", "Консультация", "Подробный разбор"} {
		if types[i].Name != name || types[i].ID == "" || types[i].Description == "" || types[i].Duration != []int{15, 30, 60}[i] {
			t.Fatalf("type: %+v", types[i])
		}
	}
}

func TestReadMeetingTypeAndRestart(t *testing.T) {
	first := httptest.NewServer(newRouter())
	defer first.Close()
	var types []map[string]any
	getJSON(t, first.URL+"/api/meeting-types", 200, &types)
	var selected map[string]any
	getJSON(t, first.URL+"/api/meeting-types/"+types[0]["id"].(string), 200, &selected)
	if selected["name"] != "Знакомство" || selected["durationMinutes"] != float64(15) || selected["id"] != types[0]["id"] || selected["description"] != types[0]["description"] {
		t.Fatalf("selected: %+v", selected)
	}
	second := httptest.NewServer(newRouter())
	defer second.Close()
	var replacement []map[string]any
	getJSON(t, second.URL+"/api/meeting-types", 200, &replacement)
	for _, old := range types {
		for _, current := range replacement {
			if old["id"] == current["id"] {
				t.Fatal("identifier survived restart")
			}
		}
	}
	for _, id := range []string{types[0]["id"].(string), "unknown"} {
		var failure map[string]any
		getJSON(t, second.URL+"/api/meeting-types/"+id, 404, &failure)
		if failure["code"] != "meeting_type_not_found" || failure["message"] != "Этот тип встречи больше недоступен" {
			t.Fatalf("not found: %+v", failure)
		}
	}
}

func getJSON(t *testing.T, url string, status int, target any) {
	t.Helper()
	r, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = r.Body.Close() }()
	if r.StatusCode != status {
		t.Fatalf("GET %s: %d, want %d", url, r.StatusCode, status)
	}
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

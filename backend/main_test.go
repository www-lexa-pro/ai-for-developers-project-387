package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestApplicationStarts(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	binary := filepath.Join(t.TempDir(), "calendar")
	if output, err := exec.CommandContext(ctx, "go", "build", "-o", binary, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, output)
	}
	cmd := exec.CommandContext(ctx, binary)
	cmd.Env = append(os.Environ(), "APP_ADDR=127.0.0.1:0")
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	urls := make(chan string, 1)
	go func() {
		defer close(urls)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			if _, url, ok := strings.Cut(scanner.Text(), "Listening "); ok {
				urls <- url
				return
			}
		}
	}()
	select {
	case url := <-urls:
		if url == "" {
			t.Fatal("server exited before readiness")
		}
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Get(url + "/api/health")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = response.Body.Close() }()
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK || body.Status != "ok" {
			t.Fatalf("unexpected response: %d %+v", response.StatusCode, body)
		}
	case <-ctx.Done():
		t.Fatal("server readiness timeout")
	}
}

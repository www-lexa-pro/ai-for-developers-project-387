package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/www-lexa-pro/ai-for-developers-project-386/backend/internal/api"
)

type server struct {
	mu           sync.Mutex
	meetingTypes []api.MeetingType
	now          func() time.Time
	bookings     []bookingInterval
}

func newServer() *server { return newServerWithClock(time.Now) }

func newServerWithClock(now func() time.Time) *server {
	return &server{now: now, meetingTypes: []api.MeetingType{
		{Id: rand.Text(), Name: "Знакомство", Description: "Познакомимся и обсудим ваш вопрос.", DurationMinutes: 15},
		{Id: rand.Text(), Name: "Консультация", Description: "Разберём задачу и наметим следующие шаги.", DurationMinutes: 30},
		{Id: rand.Text(), Name: "Подробный разбор", Description: "Погрузимся в детали и составим план действий.", DurationMinutes: 60},
	}}
}

func (s *server) ListMeetingTypes(context.Context, api.ListMeetingTypesRequestObject) (api.ListMeetingTypesResponseObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return api.ListMeetingTypes200JSONResponse(append([]api.MeetingType{}, s.meetingTypes...)), nil
}

func (s *server) GetMeetingType(_ context.Context, request api.GetMeetingTypeRequestObject) (api.GetMeetingTypeResponseObject, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, meetingType := range s.meetingTypes {
		if meetingType.Id == request.Id {
			return api.GetMeetingType200JSONResponse(meetingType), nil
		}
	}
	return api.GetMeetingType404JSONResponse{Code: api.MeetingTypeNotFoundCodeMeetingTypeNotFound, Message: "Этот тип встречи больше недоступен"}, nil
}

func (*server) GetHealth(context.Context, api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	return api.GetHealth200JSONResponse{Status: api.Ok}, nil
}

func newRouter() *gin.Engine { return newRouterWithServer(newServer()) }

func newRouterWithServer(s *server, middleware ...gin.HandlerFunc) *gin.Engine {
	router := gin.New()
	router.Use(gin.Logger(), gin.CustomRecovery(func(c *gin.Context, _ any) {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "message": "Не удалось выполнить запрос"})
	}), validateJSONBody)
	router.Use(middleware...)
	api.RegisterHandlers(router, api.NewStrictHandlerWithOptions(s, nil, api.StrictGinServerOptions{
		ResponseErrorHandlerFunc: func(c *gin.Context, _ error) {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "internal_error", "message": "Не удалось выполнить запрос"})
		},
		RequestErrorHandlerFunc: func(c *gin.Context, _ error) {
			c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_request", "message": "Не удалось разобрать запрос"})
		},
	}))
	return router
}

func main() {
	gin.SetMode(gin.ReleaseMode)
	router := newRouter()
	if directory := os.Getenv("STATIC_DIR"); directory != "" {
		router.NoRoute(func(c *gin.Context) {
			if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
				c.Status(http.StatusNotFound)
				return
			}
			path := c.Request.URL.Path
			if path == "/api" || strings.HasPrefix(path, "/api/") {
				c.Status(http.StatusNotFound)
				return
			}
			if path == "/" || path == "/owner" || strings.HasPrefix(path, "/meeting-types/") {
				c.File(filepath.Join(directory, "index.html"))
				return
			}
			http.FileServer(http.Dir(directory)).ServeHTTP(c.Writer, c.Request)
		})
	}
	address := os.Getenv("APP_ADDR")
	if port := os.Getenv("PORT"); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			log.Fatal("PORT must be an integer between 1 and 65535")
		}
		address = net.JoinHostPort("", port)
	}
	if address == "" {
		address = "127.0.0.1:8080"
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Listening http://%s", listener.Addr())
	srv := &http.Server{Handler: router, ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			log.Print(err)
		}
	}()
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

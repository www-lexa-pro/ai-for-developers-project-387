FROM node:24.22.3 AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend ./frontend
COPY vite.config.ts ./
RUN npm exec vite -- build

FROM golang:1.27.4 AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 go build -o /calendar .

FROM scratch
COPY --from=backend /calendar /app/calendar
COPY --from=frontend /src/frontend/dist /app/public
ENV PORT=8080 STATIC_DIR=/app/public
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/calendar"]

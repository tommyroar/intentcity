#!/bin/bash

# intentcity dev server management script

PID_FILE="/tmp/intentcity-dev.pid"
WEB_DIR="web"

get_urls() {
    IP_LOCAL=$(ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
    HOSTNAME_LOCAL="Tommys-Mac-mini.local"
    HOSTNAME_TAILSCALE="tommys-mac-mini.tail59a169.ts.net"
    PORT=5173

    echo "Development server URLs:"
    echo "  Local:     http://localhost:$PORT"
    echo "  Network:   http://$HOSTNAME_LOCAL:$PORT"
    echo "  Tailscale: http://$HOSTNAME_TAILSCALE:$PORT"
}

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null; then
            echo "Dev server is already running (PID: $PID)"
            get_urls
            return
        fi
    fi

    echo "Starting dev server..."
    cd "$WEB_DIR" || exit
    npm run dev -- --host > /tmp/intentcity-dev.log 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    cd ..

    echo "Waiting for server to start..."
    for i in {1..10}; do
        if curl -s -o /dev/null http://localhost:5173; then
            echo "Server is up!"
            get_urls
            return
        fi
        sleep 1
    done
    echo "Server failed to start or is taking too long. Check /tmp/intentcity-dev.log"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        echo "Stopping dev server (PID: $PID)..."
        kill "$PID" 2>/dev/null
        rm "$PID_FILE"
        # Also kill any child vite processes
        pkill -f "vite"
        echo "Stopped."
    else
        echo "No PID file found. Checking for vite processes..."
        pkill -f "vite"
        echo "Done."
    fi
}

status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null; then
            echo "Dev server is running (PID: $PID)"
            get_urls
        else
            echo "PID file exists but process is not running."
        fi
    else
        echo "Dev server is not running."
    fi
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        stop
        sleep 2
        start
        ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        exit 1
esac

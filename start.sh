#!/bin/bash

# Start the multiplayer burr game
# This script starts both the game server and the client

echo "Starting burrs.io Multiplayer Game..."
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing client dependencies..."
    npm install
fi

if [ ! -d "server/node_modules" ]; then
    echo "Installing server dependencies..."
    cd server && npm install && cd ..
fi

echo ""
echo "Starting game server on port 5174..."
cd server && npm start &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo "Starting client on port 5173..."
cd ..
npm run dev &
CLIENT_PID=$!

echo ""
echo "=========================================="
echo "burrs.io is running!"
echo "=========================================="
echo "Game Server: http://localhost:5174"
echo "Client: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"
echo "=========================================="

# Wait for Ctrl+C
trap "kill $SERVER_PID $CLIENT_PID; exit" INT
wait


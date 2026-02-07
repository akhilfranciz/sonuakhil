const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  allowUpgrades: true,
  cookie: false
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoomId = null;
  let currentUserId = null;

  socket.on('join-room', (roomId, userId) => {
    currentRoomId = roomId;
    currentUserId = userId;
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(userId);

    // Notify others in the room
    socket.to(roomId).emit('user-connected', userId);
    console.log(`User ${userId} joined room ${roomId}`);

    // Send list of existing users
    const existingUsers = Array.from(rooms.get(roomId)).filter(id => id !== userId);
    socket.emit('existing-users', existingUsers);
  });

  socket.on('signal', (data) => {
    console.log(`Signal from ${socket.id} to ${data.to}:`, data.signal.sdp ? data.signal.sdp.type : 'ICE candidate');
    io.to(data.to).emit('signal', {
      from: currentUserId,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && currentUserId) {
      socket.to(currentRoomId).emit('user-disconnected', currentUserId);
      if (rooms.has(currentRoomId)) {
        rooms.get(currentRoomId).delete(currentUserId);
        if (rooms.get(currentRoomId).size === 0) {
          rooms.delete(currentRoomId);
        }
      }
      console.log(`User ${currentUserId} disconnected from room ${currentRoomId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Network access: Use your local IP address on port ${PORT}`);
  console.log(`Example: http://192.168.1.x:${PORT}`);
});

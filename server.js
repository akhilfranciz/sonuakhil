const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Store rooms: { roomId: { socketId: true } }
const rooms = {};

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('join-room', (roomId) => {
    // Create room if it doesn't exist
    if (!rooms[roomId]) rooms[roomId] = {};

    // Send list of existing users to the new user
    const usersInRoom = Object.keys(rooms[roomId]);
    socket.emit('all-users', usersInRoom);

    // Add user to room
    rooms[roomId][socket.id] = true;
    socket.join(roomId);
    socket.roomId = roomId;

    console.log(`${socket.id} joined room ${roomId} (${usersInRoom.length + 1} users)`);
  });

  // Relay WebRTC signaling messages
  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', { from: socket.id, sdp: data.sdp });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', { from: socket.id, sdp: data.sdp });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.to).emit('ice-candidate', { from: socket.id, candidate: data.candidate });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId][socket.id];
      socket.to(roomId).emit('user-left', socket.id);
      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
      }
    }
    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId, userId) => {
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

    socket.on('signal', (data) => {
      io.to(data.to).emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    });

    socket.on('disconnect', () => {
      socket.to(roomId).emit('user-disconnected', userId);
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(userId);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        }
      }
      console.log(`User ${userId} disconnected from room ${roomId}`);
    });
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;

const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Kết nối tới MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'dacs4'
});
db.connect(err => {
  if (err) console.error('Kết nối MySQL thất bại:', err);
  else console.log('Kết nối MySQL thành công');
});

// Đăng ký user mới
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Thiếu thông tin' });
  const hash = await bcrypt.hash(password, 12);
  db.query(
    'INSERT INTO users (email, password) VALUES (?, ?)',
    [email, hash],
    (err, results) => {
      if (err) return res.status(500).json({ error: 'Email đã tồn tại hoặc lỗi hệ thống' });
      res.json({ success: true, id: results.insertId });
    }
  );
});

// Đăng nhập user
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  db.query(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, results) => {
      if (err || results.length === 0) return res.status(400).json({ error: 'Email không tồn tại' });
      const user = results[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(400).json({ error: 'Sai mật khẩu' });
      // Sinh JWT token xác thực phiên đăng nhập
      const token = jwt.sign({ userId: user.id, email: user.email }, 'YOUR_SECRET_KEY', { expiresIn: '2h' });
      res.json({ success: true, token });
    }
  );
});

// API test: Lấy dữ liệu user đã đăng nhập
app.get('/api/profile', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Thiếu token' });
  try {
    const decoded = jwt.verify(auth.replace('Bearer ', ''), 'YOUR_SECRET_KEY');
    db.query(
      'SELECT id, email FROM users WHERE id = ?',
      [decoded.userId],
      (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Không tìm thấy user' });
        res.json(results[0]);
      }
    );
  } catch {
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
});

// WebRTC Signaling với Socket.IO
const rooms = new Map(); // mã phòng -> map user

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Vào phòng
  socket.on('join-room', ({ roomCode, userEmail }) => {
    socket.join(roomCode);
    
    // Thêm phòng vào rooms map nếu chưa có
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, new Map());
    }
    rooms.get(roomCode).set(socket.id, { email: userEmail, socketId: socket.id });

    // Lấy danh sách user trong phòng
    const usersInRoom = Array.from(rooms.get(roomCode).values());
    
    console.log(`${userEmail} joined room ${roomCode}`);
    
    // Thông báo cho các user khác trong phòng
    socket.to(roomCode).emit('user-joined', {
      socketId: socket.id,
      email: userEmail
    });

    // Gửi danh sách user trong phòng cho client mới
    socket.emit('room-users', usersInRoom);
  });

  // WebRTC signaling
  socket.on('offer', ({ offer, to }) => {
    socket.to(to).emit('offer', {
      offer,
      from: socket.id
    });
  });

  socket.on('answer', ({ answer, to }) => {
    socket.to(to).emit('answer', {
      answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    socket.to(to).emit('ice-candidate', {
      candidate,
      from: socket.id
    });
  });

  // Chat message
  socket.on('chat-message', ({ roomCode, message, sender }) => {
    io.to(roomCode).emit('chat-message', {
      message,
      sender,
      timestamp: new Date().toISOString()
    });
  });

  // Media status change (mic/cam on/off)
  socket.on('media-status-change', ({ roomCode, isMicOn, isCamOn }) => {
    console.log(`Media status changed in room ${roomCode}: mic=${isMicOn}, cam=${isCamOn}`);
    // Broadcast to others in room
    socket.to(roomCode).emit('media-status-changed', {
      socketId: socket.id,
      isMicOn,
      isCamOn
    });
  });

  // Screen share started
  socket.on('screen-share-started', ({ roomCode }) => {
    console.log(`Screen share started in room ${roomCode} by ${socket.id}`);
    socket.to(roomCode).emit('screen-share-started', {
      socketId: socket.id
    });
  });

  // Screen share stopped
  socket.on('screen-share-stopped', ({ roomCode }) => {
    console.log(`Screen share stopped in room ${roomCode} by ${socket.id}`);
    socket.to(roomCode).emit('screen-share-stopped', {
      socketId: socket.id
    });
  });

  // Private message
  socket.on('private-message', ({ to, message, sender }) => {
    console.log(`Private message from ${socket.id} (${sender}) to ${to}`);
    console.log(`   Message: "${message}"`);
    
    // Send to specific socket
    io.to(to).emit('private-message', {
      from: socket.id,
      message,
      sender
    });
    
    console.log(`Private message sent to ${to}`);
  });

  // File message
  socket.on('file-message', ({ roomCode, fileName, fileSize, fileData, fileType, sender }) => {
    console.log(`File message in room ${roomCode}: ${fileName} (${fileSize} bytes) from ${sender}`);
    
    // Broadcast to others in room (not sender)
    socket.to(roomCode).emit('file-message', {
      fileName,
      fileSize,
      fileData,
      fileType,
      sender
    });
    
    console.log(`File broadcasted to room ${roomCode}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from all rooms
    rooms.forEach((users, roomCode) => {
      if (users.has(socket.id)) {
        const user = users.get(socket.id);
        users.delete(socket.id);
        
        // Notify others
        socket.to(roomCode).emit('user-left', {
          socketId: socket.id,
          email: user.email
        });
        
        // Clean up empty rooms
        if (users.size === 0) {
          rooms.delete(roomCode);
        }
      }
    });
  });
});

server.listen(5000, () => console.log('Server backend + Socket.IO chạy tại port 5000'));



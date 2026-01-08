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

  // Content Moderation - Server-side validation
  const toxicWords = [
    // Vietnamese toxic words
    'ngu', 'đồ ngu', 'ngu ngốc', 'khốn nạn', 'khốn', 'đần', 'ngốc',
    'chết tiệt', 'đồ khốn', 'thằng ngu', 'con ngu', 'đồ ngốc',
    'ngu si', 'đần độn', 'khốn kiếp', 'đồ đần',
    
    // English toxic words
    'stupid', 'idiot', 'fool', 'dumb', 'moron', 'hate', 'damn',
    
    // Leetspeak variations
    'n9u', 'ng0c', 'kh0n', 'd4n'
  ];

  const toxicPatterns = [
    /\bn[u3]g[u0]\b/gi,           // ngu, n3g0, nugu, n3gu
    /\bkh[o0]n\b/gi,              // khon, kh0n
    /\bd[a4]n\b/gi,               // dan, d4n
    /\bng[o0]c\b/gi,              // ngoc, ng0c
    /\bst[u3]p[i1]d\b/gi,         // stupid, st3p1d
    /\b[i1]d[i1][o0]t\b/gi        // idiot, 1d10t
  ];

  function isToxicMessage(message) {
    const lowerMessage = message.toLowerCase();
    
    // Check exact word matches
    const hasExactMatch = toxicWords.some(word => lowerMessage.includes(word));
    if (hasExactMatch) return true;
    
    // Check pattern matches
    const hasPatternMatch = toxicPatterns.some(pattern => pattern.test(message));
    return hasPatternMatch;
  }

  // Chat message with content moderation
  socket.on('chat-message', ({ roomCode, message, sender }) => {
    // Server-side content moderation
    if (isToxicMessage(message)) {
      console.log(`🚫 Toxic message blocked from ${sender}: "${message}"`);
      
      // Send warning back to sender only
      socket.emit('moderation-warning', {
        message: 'Tin nhắn của bạn chứa từ ngữ không phù hợp và đã bị chặn. Vui lòng sử dụng ngôn từ lịch sự trong meeting.',
        timestamp: new Date().toISOString()
      });
      
      // Log for moderation purposes
      console.log(`📊 Moderation stats - Room: ${roomCode}, User: ${sender}, Time: ${new Date().toISOString()}`);
      
      return; // Don't broadcast the toxic message
    }

    // Message is clean, broadcast to room
    io.to(roomCode).emit('chat-message', {
      message,
      sender,
      timestamp: new Date().toISOString()
    });
    
    console.log(`💬 Clean message sent in room ${roomCode} by ${sender}`);
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

  // Private message with content moderation
  socket.on('private-message', ({ to, message, sender }) => {
    console.log(`Private message from ${socket.id} (${sender}) to ${to}`);
    console.log(`   Message: "${message}"`);
    
    // Server-side content moderation for private messages
    if (isToxicMessage(message)) {
      console.log(`🚫 Toxic private message blocked from ${sender}: "${message}"`);
      
      // Send warning back to sender only
      socket.emit('moderation-warning', {
        message: 'Tin nhắn riêng của bạn chứa từ ngữ không phù hợp và đã bị chặn. Vui lòng sử dụng ngôn từ lịch sự trong meeting.',
        timestamp: new Date().toISOString()
      });
      
      // Log for moderation purposes
      console.log(`📊 Private message moderation - From: ${sender}, To: ${to}, Time: ${new Date().toISOString()}`);
      
      return; // Don't send the toxic private message
    }
    
    // Message is clean, send to specific socket
    io.to(to).emit('private-message', {
      from: socket.id,
      message,
      sender
    });
    
    console.log(`💬 Clean private message sent from ${sender} to ${to}`);
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



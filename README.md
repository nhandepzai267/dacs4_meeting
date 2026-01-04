# Vờ Ku Mít - Hướng dẫn sử dụng

## Cài đặt

1. Cài đặt dependencies:
```bash
npm install
```

2. Tạo database MySQL:
```sql
CREATE DATABASE dacs4;
USE dacs4;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

3. Cấu hình MySQL trong `server/server.js`:
- host: 'localhost'
- user: 'root'
- password: '' (hoặc password MySQL của bạn)
- database: 'dacs4'

## Chạy ứng dụng

1. Khởi động server backend:
```bash
npm start
```
Server sẽ chạy tại: http://localhost:5000

2. Mở file `index.html` bằng trình duyệt hoặc dùng Live Server

## Tính năng đã hoàn thành

✅ Đăng ký tài khoản mới
✅ Đăng nhập với email/password
✅ Mã hóa mật khẩu với bcrypt
✅ Xác thực JWT token
✅ Auto redirect khi chưa đăng nhập
✅ Logout
✅ Hiển thị thông tin user đã đăng nhập

## Cấu trúc project

```
├── index.html              # Trang chính (meeting room)
├── scr/
│   └── auth/
│       ├── login.html      # Trang đăng nhập
│       ├── register.html   # Trang đăng ký
│       └── login.css       # CSS cho auth pages
├── server/
│   └── server.js           # Backend API
└── package.json
```

## API Endpoints

- POST `/api/register` - Đăng ký user mới
- POST `/api/login` - Đăng nhập
- GET `/api/profile` - Lấy thông tin user (cần token)

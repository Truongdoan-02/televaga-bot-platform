-- Database Schema for Demo_TeleVaga
CREATE DATABASE IF NOT EXISTS televaga_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE televaga_demo;

-- Table: Users
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  telegram_id VARCHAR(64) UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  username VARCHAR(100),
  phone_number VARCHAR(30),
  avatar_url TEXT,
  bio TEXT,
  is_bot BOOLEAN DEFAULT FALSE,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: Chats
CREATE TABLE IF NOT EXISTS chats (
  id VARCHAR(64) PRIMARY KEY,
  telegram_chat_id VARCHAR(64) UNIQUE,
  type ENUM('direct', 'group', 'channel') DEFAULT 'direct',
  title VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  category ENUM('all', 'support', 'sales', 'vip', 'unread') DEFAULT 'all',
  is_pinned BOOLEAN DEFAULT FALSE,
  is_muted BOOLEAN DEFAULT FALSE,
  unread_count INT DEFAULT 0,
  participant_ids JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: Messages
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  chat_id VARCHAR(64) NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  sender_name VARCHAR(150),
  text TEXT,
  type ENUM('text', 'image', 'document', 'audio', 'system') DEFAULT 'text',
  media_url TEXT,
  file_name VARCHAR(255),
  file_size VARCHAR(50),
  is_outgoing BOOLEAN DEFAULT FALSE,
  status ENUM('sending', 'sent', 'delivered', 'read') DEFAULT 'sent',
  reply_to_id VARCHAR(64),
  reactions JSON,
  is_pinned BOOLEAN DEFAULT FALSE,
  forwarded_from VARCHAR(150),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

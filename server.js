const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game Constants
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const PLAYER_RADIUS = 25;
const PLAYER_SPEED = 6;
const FRICTION = 0.92;
const BOUNCE_FORCE = 3.5;
const LASER_SPEED = 3;

// Store rooms and their game states
const rooms = {};
const roomIntervals = {};

// Generate random neon color
function getRandomColor() {
  const neonColors = ['#FF00FF', '#00FFFF', '#39FF14', '#FF073A', '#FFFF00', '#BF00FF', '#FF5F1F'];
  return neonColors[Math.floor(Math.random() * neonColors.length)];
}

// Check circle collision
function checkCircleCollision(c1, c2) {
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < (c1.radius + c2.radius);
}

// Resolve bumper car physics
function resolveCollision(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Normal vector
  const nx = dx / distance;
  const ny = dy / distance;
  
  // Relative velocity
  const dvx = p2.vx - p1.vx;
  const dvy = p2.vy - p1.vy;
  
  // Velocity along normal
  const velAlongNormal = dvx * nx + dvy * ny;
  
  // Don't resolve if velocities are separating
  if (velAlongNormal > 0) return;
  
  // Bounce
  const j = -(1 + 0.8) * velAlongNormal; // 0.8 restitution
  const impulse = j / 2;
  
  p1.vx -= impulse * nx * BOUNCE_FORCE;
  p1.vy -= impulse * ny * BOUNCE_FORCE;
  p2.vx += impulse * nx * BOUNCE_FORCE;
  p2.vy += impulse * ny * BOUNCE_FORCE;
  
  // Separate overlapping circles
  const overlap = (PLAYER_RADIUS * 2) - distance;
  const separationX = nx * overlap * 0.5;
  const separationY = ny * overlap * 0.5;
  
  p1.x -= separationX;
  p1.y -= separationY;
  p2.x += separationX;
  p2.y += separationY;
}

// Initialize laser
function createLaser() {
  const isHorizontal = Math.random() > 0.5;
  return {
    x: isHorizontal ? 0 : Math.random() * CANVAS_WIDTH,
    y: isHorizontal ? Math.random() * CANVAS_HEIGHT : 0,
    width: isHorizontal ? CANVAS_WIDTH : 60,
    height: isHorizontal ? 60 : CANVAS_HEIGHT,
    vx: isHorizontal ? 0 : (Math.random() > 0.5 ? LASER_SPEED : -LASER_SPEED),
    vy: isHorizontal ? (Math.random() > 0.5 ? LASER_SPEED : -LASER_SPEED) : 0,
    isHorizontal: isHorizontal,
    active: true,
    warning: true,
    warningTime: 2000, // 2 seconds warning
    spawnTime: Date.now()
  };
}

// Initialize room
function initRoom(roomName) {
  if (!rooms[roomName]) {
    rooms[roomName] = {
      players: {},
      lasers: [],
      scores: {},
      gameRunning: true,
      lastLaserSpawn: 0
    };
    
    // Start game loop for this room
    startGameLoop(roomName);
  }
  return rooms[roomName];
}

// Game loop per room
function startGameLoop(roomName) {
  const tickRate = 1000 / 60; // 60 FPS
  
  roomIntervals[roomName] = setInterval(() => {
    const room = rooms[roomName];
    if (!room || !room.gameRunning) return;
    
    const now = Date.now();
    
    // Spawn lasers periodically
    if (now - room.lastLaserSpawn > 4000 && room.lasers.length < 3) {
      room.lasers.push(createLaser());
      room.lastLaserSpawn = now;
    }
    
    // Update lasers
    room.lasers = room.lasers.filter(laser => {
      // Warning phase
      if (laser.warning) {
        if (now - laser.spawnTime > laser.warningTime) {
          laser.warning = false;
        }
        return true;
      }
      
      // Move laser
      laser.x += laser.vx;
      laser.y += laser.vy;
      
      // Bounce off walls
      if (laser.isHorizontal) {
        if (laser.y <= 0 || laser.y >= CANVAS_HEIGHT - laser.height) {
          laser.vy *= -1;
        }
      } else {
        if (laser.x <= 0 || laser.x >= CANVAS_WIDTH - laser.width) {
          laser.vx *= -1;
        }
      }
      
      return true;
    });
    
    // Update players
    Object.values(room.players).forEach(player => {
      // Apply friction
      player.vx *= FRICTION;
      player.vy *= FRICTION;
      
      // Update position
      player.x += player.vx;
      player.y += player.vy;
      
      // Boundary collision
      if (player.x < PLAYER_RADIUS) {
        player.x = PLAYER_RADIUS;
        player.vx *= -0.5;
      }
      if (player.x > CANVAS_WIDTH - PLAYER_RADIUS) {
        player.x = CANVAS_WIDTH - PLAYER_RADIUS;
        player.vx *= -0.5;
      }
      if (player.y < PLAYER_RADIUS) {
        player.y = PLAYER_RADIUS;
        player.vy *= -0.5;
      }
      if (player.y > CANVAS_HEIGHT - PLAYER_RADIUS) {
        player.y = CANVAS_HEIGHT - PLAYER_RADIUS;
        player.vy *= -0.5;
      }
    });
    
    // Player-Player collisions
    const playerList = Object.values(room.players);
    for (let i = 0; i < playerList.length; i++) {
      for (let j = i + 1; j < playerList.length; j++) {
        if (checkCircleCollision(playerList[i], playerList[j])) {
          resolveCollision(playerList[i], playerList[j]);
          
          // Track who hit whom for scoring
          const speed1 = Math.sqrt(playerList[i].vx**2 + playerList[i].vy**2);
          const speed2 = Math.sqrt(playerList[j].vx**2 + playerList[j].vy**2);
          
          if (speed1 > speed2) {
            playerList[i].lastHit = playerList[j].id;
          } else {
            playerList[j].lastHit = playerList[i].id;
          }
        }
      }
    }
    
    // Laser collisions
    room.lasers.forEach(laser => {
      if (laser.warning) return;
      
      playerList.forEach(player => {
        // Simple AABB + circle check for lasers
        let closestX = Math.max(laser.x, Math.min(player.x, laser.x + laser.width));
        let closestY = Math.max(laser.y, Math.min(player.y, laser.y + laser.height));
        let dx = player.x - closestX;
        let dy = player.y - closestY;
        let distSq = dx * dx + dy * dy;
        
        if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
          // Player hit by laser!
          const hitterId = player.lastHit;
          
          // Award point to hitter if valid
          if (hitterId && room.players[hitterId] && hitterId !== player.id) {
            room.scores[hitterId] = (room.scores[hitterId] || 0) + 1;
            io.to(roomName).emit('scoreUpdate', { scorer: hitterId, victim: player.id });
          }
          
          // Respawn player
          player.x = Math.random() * (CANVAS_WIDTH - 100) + 50;
          player.y = Math.random() * (CANVAS_HEIGHT - 100) + 50;
          player.vx = 0;
          player.vy = 0;
          player.lastHit = null;
          
          io.to(roomName).emit('playerRespawn', { id: player.id, x: player.x, y: player.y });
        }
      });
    });
    
    // Broadcast game state
    io.to(roomName).emit('gameState', {
      players: room.players,
      lasers: room.lasers,
      scores: room.scores,
      timestamp: now
    });
    
  }, tickRate);
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  let currentRoom = null;
  
  // Join room
  socket.on('join', (roomName) => {
    if (!roomName || typeof roomName !== 'string') return;
    
    currentRoom = roomName;
    socket.join(roomName);
    
    const room = initRoom(roomName);
    
    // Create player
    const spawnX = Math.random() * (CANVAS_WIDTH - 100) + 50;
    const spawnY = Math.random() * (CANVAS_HEIGHT - 100) + 50;
    
    room.players[socket.id] = {
      id: socket.id,
      x: spawnX,
      y: spawnY,
      vx: 0,
      vy: 0,
      radius: PLAYER_RADIUS,
      color: getRandomColor(),
      name: `Player ${Object.keys(room.players).length + 1}`,
      lastHit: null,
      input: { w: false, a: false, s: false, d: false }
    };
    
    room.scores[socket.id] = 0;
    
    // Send initial state to new player
    socket.emit('init', {
      id: socket.id,
      players: room.players,
      lasers: room.lasers,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT
    });
    
    // Notify others
    socket.to(roomName).emit('playerJoined', room.players[socket.id]);
    
    console.log(`Player ${socket.id} joined room ${roomName}`);
  });
  
  // Handle movement input
  socket.on('move', (input) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    
    const player = rooms[currentRoom].players[socket.id];
    if (!player) return;
    
    // Update input state
    player.input = input;
    
    // Calculate acceleration based on input
    const accel = 0.8;
    if (input.w) player.vy -= accel;
    if (input.s) player.vy += accel;
    if (input.a) player.vx -= accel;
    if (input.d) player.vx += accel;
    
    // Cap max speed
    const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    if (speed > PLAYER_SPEED) {
      player.vx = (player.vx / speed) * PLAYER_SPEED;
      player.vy = (player.vy / speed) * PLAYER_SPEED;
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].players[socket.id];
      delete rooms[currentRoom].scores[socket.id];
      
      io.to(currentRoom).emit('playerLeft', socket.id);
      
      // Clean up empty rooms
      if (Object.keys(rooms[currentRoom].players).length === 0) {
        clearInterval(roomIntervals[currentRoom]);
        delete roomIntervals[currentRoom];
        delete rooms[currentRoom];
        console.log(`Room ${currentRoom} deleted`);
      }
    }
  });
});

// Serve static files (client)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Bumper-Car Battle Server running on port ${PORT}`);
});

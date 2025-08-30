# NEXUS-FUTURISTIC VIRTUAL WORLD

A real-time virtual collaboration space set in the year 2070, where users can navigate a futuristic neural network interface, interact with others in proximity, and communicate through various channels.

![Nexus Virtual World](https://res.cloudinary.com/dlzkqms1c/image/upload/v1756550405/Screenshot_2025-08-30_at_4.07.57_PM_e1ddq3.png)

## Overview

Nexus is a virtual world platform that simulates a futuristic digital space where users can:

- Navigate through an interactive sci-fi map
- See other users' avatars in real-time
- Chat with users who are within proximity
- Experience smooth avatar movement animations

The platform uses proximity-based networking, meaning you can only communicate with others who are within a certain radius of your avatar.

## Tech Stack

### MERN Stack

- **MongoDB**: Database for user profiles and persistent data (to be implemented)
- **Express**: Backend API server
- **React**: Frontend user interface
- **Node.js**: Runtime environment for the server

### Real-time Technologies

- **WebSockets**: Used for real-time position updates and chat messaging
- **WebRTC**: For audio and video conferencing (planned for future implementation)

## Features

### Current Implementations

- **Interactive Map**: Navigate through a futuristic virtual space
- **Real-time Avatar Movement**: See other users move in real-time
- **Animated Movement**: Smooth transitions when moving between locations
- **Proximity Detection**: System detects when users are near each other
- **Proximity Chat**: Text messaging with users in your proximity radius
- **Visual Feedback**: Connection lines between nearby users
- **Reconnection Logic**: Automatic reconnection if connection is lost

### Planned Features

- **Audio Chat**: Voice communication with nearby users via WebRTC
- **Video Conferencing**: Face-to-face interaction within proximity zones
- **Customizable Avatars**: Personalize your virtual presence
- **Persistent World**: Save map positions and user settings
- **Virtual Objects**: Interactive elements in the environment

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager

### Installation

1. Clone the repository

```bash
git clone https://github.com/inspiredrishabh/VibeCoding.git
cd VibeCoding
```

2. Install dependencies for both frontend and backend

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Start the development servers

```bash
# Start backend server (from backend directory)
npm run dev

# Start frontend development server (from frontend directory)
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## How to Use

1. Enter your callsign (username) on the login screen
2. Navigate the neural map by clicking anywhere on the map
3. Your avatar will smoothly move to the clicked location
4. When you get close to other users (within 200px), a chat panel will appear
5. Exchange messages with nearby users through the chat interface
6. Disconnect using the disconnect button when finished

## Architecture

### Client-Server Communication

- WebSocket protocol for real-time updates
- Proximity calculations to determine which users can communicate
- Heartbeat system to maintain connection status

### Animation System

- Interpolated movement between positions
- Easing functions for natural motion
- Visual feedback for user interactions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by virtual worlds and collaborative spaces
- Built for the modern web using cutting-edge technologies

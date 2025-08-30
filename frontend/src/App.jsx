import React, { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = "wss://vibecoding-4v23.onrender.com";
const PROXIMITY_RADIUS = 200;
const HEARTBEAT_INTERVAL = 15000; // Match server's HEARTBEAT_INTERVAL_MS
const MAX_RECONNECT_ATTEMPTS = 5;

export default function App() {
  // UI State
  const [gameState, setGameState] = useState("login"); // "login" | "main"
  const [callsign, setCallsign] = useState("");

  // Connection State
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [room, setRoom] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Game State
  const [participantsMap, setParticipantsMap] = useState(() => new Map());
  const [nearby, setNearby] = useState([]);

  // Debug State
  const [debugInfo, setDebugInfo] = useState({
    lastMousePos: null,
    lastSentMove: null,
    messagesSent: 0,
    messagesReceived: 0,
    wsState: "CLOSED",
  });

  // Animation State
  const [targetPosition, setTargetPosition] = useState(null);
  const [isMoving, setIsMoving] = useState(false);

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);

  // Refs
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastMoveRef = useRef(0);
  const participantsRef = useRef(participantsMap);
  const nearbyRef = useRef(nearby);
  const selfIdRef = useRef(selfId);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const callsignRef = useRef(callsign);
  const targetPositionRef = useRef(null);
  const isMovingRef = useRef(false);
  const animationStartTimeRef = useRef(0);
  const startPositionRef = useRef(null);
  const chatMessagesRef = useRef([]);
  const chatInputRef = useRef(null);

  // Keep refs in sync with state for animation loop
  useEffect(() => {
    participantsRef.current = participantsMap;
  }, [participantsMap]);

  useEffect(() => {
    nearbyRef.current = nearby;
  }, [nearby]);

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  useEffect(() => {
    callsignRef.current = callsign;
  }, [callsign]);

  useEffect(() => {
    targetPositionRef.current = targetPosition;
  }, [targetPosition]);

  useEffect(() => {
    isMovingRef.current = isMoving;
  }, [isMoving]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  // Auto-show/hide chat based on proximity
  useEffect(() => {
    if (nearby.length > 0 && !showChat) {
      setShowChat(true);
    } else if (nearby.length === 0 && showChat) {
      // Delay hiding chat to allow reading messages
      const hideTimeout = setTimeout(() => {
        if (nearby.length === 0) {
          setShowChat(false);
        }
      }, 3000);
      return () => clearTimeout(hideTimeout);
    }
  }, [nearby.length, showChat]);

  // Clean old chat messages (keep last 50)
  useEffect(() => {
    if (chatMessages.length > 50) {
      setChatMessages((prev) => prev.slice(-50));
    }
  }, [chatMessages.length]);

  // Rate-limited move function
  const sendMove = useCallback(
    (x, y, isAnimationFrame = false) => {
      const now = Date.now();
      if (!isAnimationFrame && now - lastMoveRef.current < 12) {
        return;
      }
      lastMoveRef.current = now;

      const ws = wsRef.current;
      console.log(`WebSocket reference:`, ws, `ReadyState:`, ws?.readyState);

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log(`WebSocket not ready. State: ${ws?.readyState || "null"}`);
        return;
      }

      const moveData = {
        type: "move",
        payload: { x: Math.round(x), y: Math.round(y) },
      };

      ws.send(JSON.stringify(moveData));

      // Update local position immediately
      if (selfId) {
        setParticipantsMap((prev) => {
          const copy = new Map(prev);
          const self = copy.get(selfId);
          if (self) {
            copy.set(selfId, { ...self, x: Math.round(x), y: Math.round(y) });
          }
          return copy;
        });
      }

      // Update debug info
      setDebugInfo((prev) => ({
        ...prev,
        lastSentMove: { x: Math.round(x), y: Math.round(y), time: now },
        messagesSent: prev.messagesSent + 1,
      }));
    },
    [selfId]
  ); // Add selfId to dependencies

  // Handle canvas click for movement
  const handleCanvasClick = useCallback(
    (e) => {
      const roomData = room || { width: 1600, height: 900 };
      const canvas = canvasRef.current;

      if (!canvas || !selfId) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = roomData.width / rect.width;
      const scaleY = roomData.height / rect.height;

      const targetX = (e.clientX - rect.left) * scaleX;
      const targetY = (e.clientY - rect.top) * scaleY;

      console.log(`Click target: ${targetX}, ${targetY}`);

      // Get current position
      const currentParticipant = participantsMap.get(selfId);
      if (!currentParticipant) return;

      const startPos = { x: currentParticipant.x, y: currentParticipant.y };
      const targetPos = { x: Math.round(targetX), y: Math.round(targetY) };

      // Don't move if clicking very close to current position
      const distance = Math.sqrt(
        Math.pow(targetPos.x - startPos.x, 2) + Math.pow(targetPos.y - startPos.y, 2)
      );

      if (distance < 10) return;

      // Set animation state
      setTargetPosition(targetPos);
      setIsMoving(true);
      startPositionRef.current = startPos;
      animationStartTimeRef.current = performance.now();

      // Update debug info
      setDebugInfo((prev) => ({
        ...prev,
        lastMousePos: { x: targetPos.x, y: targetPos.y, time: Date.now() },
      }));
    },
    [room, selfId, participantsMap]
  );

  // Animation configuration
  const ANIMATION_DURATION = 800; // ms
  const EASING_POWER = 2; // quadratic easing

  // Easing function for smooth animation
  const easeInOutQuad = (t) => {
    return t < 0.5 ? EASING_POWER * t * t : 1 - Math.pow(-2 * t + 2, EASING_POWER) / 2;
  };

  // Calculate distance for dynamic animation duration
  const calculateAnimationDuration = (startPos, targetPos) => {
    const distance = Math.sqrt(
      Math.pow(targetPos.x - startPos.x, 2) + Math.pow(targetPos.y - startPos.y, 2)
    );
    // Base duration + distance factor (min 300ms, max 1200ms)
    return Math.max(300, Math.min(1200, distance * 0.8));
  };

  // Animation loop for smooth movement
  useEffect(() => {
    if (!isMoving || !targetPosition || !startPositionRef.current) return;

    const animate = (currentTime) => {
      const elapsed = currentTime - animationStartTimeRef.current;
      const duration = calculateAnimationDuration(startPositionRef.current, targetPosition);
      const progress = Math.min(elapsed / duration, 1);

      if (progress >= 1) {
        // Animation complete
        sendMove(targetPosition.x, targetPosition.y, true);
        setIsMoving(false);
        setTargetPosition(null);
        startPositionRef.current = null;
        return;
      }

      // Calculate eased position
      const easedProgress = easeInOutQuad(progress);
      const currentX = startPositionRef.current.x +
        (targetPosition.x - startPositionRef.current.x) * easedProgress;
      const currentY = startPositionRef.current.y +
        (targetPosition.y - startPositionRef.current.y) * easedProgress;

      // Send position update
      sendMove(currentX, currentY, true);

      // Continue animation
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [isMoving, targetPosition, sendMove]);

  // WebSocket connection management with heartbeat and auto-reconnection
  const connect = useCallback((name) => {
    console.log(`Connecting with name: ${name}`);

    // Clear any existing reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear existing heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Don't create new connection if already connecting or open
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      console.log(`WebSocket already connecting/connected, skipping`);
      return;
    }

    // Properly close existing connection
    if (wsRef.current) {
      console.log(`Closing existing WebSocket`);
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      try {
        wsRef.current.close();
      } catch (e) {
        console.error('Error closing WebSocket:', e);
      }
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setDebugInfo((prev) => ({ ...prev, wsState: "CONNECTING" }));

    ws.onopen = () => {
      console.log(`WebSocket connected`);
      setConnected(true);
      setReconnectAttempts(0);
      setDebugInfo((prev) => ({ ...prev, wsState: "OPEN" }));

      const joinMessage = {
        type: "join",
        payload: { name: name || `Guest-${Math.floor(Math.random() * 1000)}` },
      };
      console.log(`Sending join message:`, joinMessage);
      try {
        ws.send(JSON.stringify(joinMessage));
      } catch (e) {
        console.error('Error sending join message:', e);
      }

      // Start heartbeat - send ping every 15 seconds
      heartbeatIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping", payload: {} }));
            console.log("Sent ping");
          } catch (err) {
            console.error("Failed to send ping:", err);
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
          }
        } else {
          console.log("WebSocket not open, clearing heartbeat");
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (ev) => {
      setDebugInfo((prev) => ({
        ...prev,
        messagesReceived: prev.messagesReceived + 1,
      }));

      try {
        const data = JSON.parse(ev.data);
        console.log(`Received:`, data.type, data.payload);

        switch (data.type) {
          case "welcome":
            setSelfId(data.payload?.selfId || null);
            setRoom(data.payload?.room || { width: 1600, height: 900 });
            break;

          case "pong":
            // Heartbeat response received
            console.log("Received pong - connection alive");
            break;

          case "state":
            if (Array.isArray(data.payload?.participants)) {
              const map = new Map();
              for (const p of data.payload.participants) {
                map.set(p.id, p);
              }
              setParticipantsMap(map);
            }
            break;

          case "joined":
            { const joinedParticipant = data.payload.participant;
            if (joinedParticipant) {
              setParticipantsMap((prev) => {
                const copy = new Map(prev);
                copy.set(joinedParticipant.id, joinedParticipant);
                return copy;
              });
            }
            break; }

          case "moved":
            { const { id, x, y } = data.payload;
            setParticipantsMap((prev) => {
              const copy = new Map(prev);
              const existing = copy.get(id);
              if (existing) {
                copy.set(id, { ...existing, x, y });
              }
              return copy;
            });
            break; }

          case "renamed":
            { const { id: renameId, name: newName } = data.payload;
            setParticipantsMap((prev) => {
              if (!prev.has(renameId)) return prev;
              const copy = new Map(prev);
              const existing = copy.get(renameId);
              copy.set(renameId, { ...existing, name: newName });
              return copy;
            });
            break; }

          case "left":
            setParticipantsMap((prev) => {
              if (!prev.has(data.payload.id)) return prev;
              const copy = new Map(prev);
              copy.delete(data.payload.id);
              return copy;
            });
            break;

          case "proximity":
            if (data.payload.selfId === selfIdRef.current) {
              setNearby(data.payload.nearby || []);
            }
            break;

          case "chat":
            { const { senderId, senderName, message, timestamp } = data.payload;
            const newMessage = {
              id: `${senderId}-${timestamp}`,
              senderId,
              senderName,
              message,
              timestamp,
              isOwn: senderId === selfIdRef.current
            };

            setChatMessages(prev => [...prev, newMessage]);
            console.log("Received chat message:", newMessage);
            break; }

          case "chat_error":
            console.log("Chat error:", data.payload.message);
            // Optionally show error to user
            break;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed:`, event.code, event.reason);
      setConnected(false);

      // Clear heartbeat on close
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Only attempt reconnection if we're still in main state and this is the current WebSocket
      if (gameState === "main" && wsRef.current === ws && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`Attempting reconnection in ${backoffDelay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

        setReconnectAttempts(prev => prev + 1);
        setDebugInfo((prev) => ({ ...prev, wsState: "RECONNECTING" }));

        reconnectTimeoutRef.current = setTimeout(() => {
          // Double-check we're still in main state and this is still the current WebSocket
          if (gameState === "main" && wsRef.current === ws) {
            connect(callsignRef.current);
          }
        }, backoffDelay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log("Max reconnection attempts reached");
        setDebugInfo((prev) => ({ ...prev, wsState: "FAILED" }));
      } else {
        setDebugInfo((prev) => ({ ...prev, wsState: "CLOSED" }));
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      setDebugInfo((prev) => ({ ...prev, wsState: "ERROR" }));
    };
  }, [gameState, reconnectAttempts]);

  // Canvas rendering effect - only depends on gameState
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || gameState !== "main") {
      return;
    }

    console.log(`Setting up canvas rendering`);
    const ctx = canvas.getContext("2d");
    let mounted = true;

    // Set canvas to actual room size
    const roomData = { width: 1600, height: 900 };
    canvas.width = roomData.width;
    canvas.height = roomData.height;
    canvas.style.width = `800px`; // Fixed display size
    canvas.style.height = `450px`; // Fixed display size

    function draw() {
      if (!mounted) return;

      // Clear canvas with dark background
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, roomData.width, roomData.height);

      const participants = participantsRef.current;
      const selfId = selfIdRef.current;
      const nearby = nearbyRef.current;
      const targetPos = targetPositionRef.current;
      const moving = isMovingRef.current;
      const selfParticipant = selfId ? participants.get(selfId) : null;

      // Draw target indicator if moving
      if (moving && targetPos && selfParticipant) {
        // Animated target circle
        const time = performance.now() * 0.003;
        const pulseSize = 8 + Math.sin(time) * 3;

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.arc(targetPos.x, targetPos.y, pulseSize, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Target crosshair
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(targetPos.x - 10, targetPos.y);
        ctx.lineTo(targetPos.x + 10, targetPos.y);
        ctx.moveTo(targetPos.x, targetPos.y - 10);
        ctx.lineTo(targetPos.x, targetPos.y + 10);
        ctx.stroke();

        // Movement trail line
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.moveTo(selfParticipant.x, selfParticipant.y);
        ctx.lineTo(targetPos.x, targetPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw proximity radius for self
      if (selfParticipant) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(34, 193, 255, 0.2)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.arc(
          selfParticipant.x,
          selfParticipant.y,
          PROXIMITY_RADIUS,
          0,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw proximity lines
      if (selfParticipant && nearby.length > 0) {
        ctx.strokeStyle = "rgba(34, 193, 255, 0.4)";
        ctx.lineWidth = 2;

        for (const nearbyId of nearby) {
          const nearbyParticipant = participants.get(nearbyId);
          if (nearbyParticipant) {
            ctx.beginPath();
            ctx.moveTo(selfParticipant.x, selfParticipant.y);
            ctx.lineTo(nearbyParticipant.x, nearbyParticipant.y);
            ctx.stroke();
          }
        }
      }

      // Draw all participants with enhanced animation
      for (const [id, participant] of participants) {
        const isSelf = id === selfId;
        const isCurrentlyMoving = isSelf && moving;

        // Enhanced glow effect for moving avatar
        ctx.beginPath();
        if (isCurrentlyMoving) {
          const glowIntensity = 0.15 + Math.sin(performance.now() * 0.005) * 0.05;
          ctx.fillStyle = `rgba(255, 255, 255, ${glowIntensity})`;
          ctx.arc(participant.x, participant.y, 30, 0, Math.PI * 2);
        } else {
          ctx.fillStyle = isSelf
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(34, 193, 255, 0.1)";
          ctx.arc(participant.x, participant.y, 25, 0, Math.PI * 2);
        }
        ctx.fill();

        // Main avatar circle
        ctx.beginPath();
        ctx.fillStyle = participant.color || "#22c1ff";
        const avatarSize = isSelf ? (isCurrentlyMoving ? 16 : 15) : 12;
        ctx.arc(participant.x, participant.y, avatarSize, 0, Math.PI * 2);
        ctx.fill();

        // Enhanced border for self
        if (isSelf) {
          ctx.beginPath();
          ctx.strokeStyle = isCurrentlyMoving ? "#ffffff" : "#ffffff";
          ctx.lineWidth = isCurrentlyMoving ? 4 : 3;
          const borderSize = isCurrentlyMoving ? 20 : 18;
          ctx.arc(participant.x, participant.y, borderSize, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Name label with movement indicator
        ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
        ctx.fillStyle = isSelf ? "#ffffff" : "#22c1ff";
        ctx.textAlign = "left";

        const nameX = participant.x + 25;
        const nameY = participant.y + 5;
        const displayName = isCurrentlyMoving
          ? `${participant.name || "Guest"} →`
          : participant.name || "Guest";

        // Text shadow for better readability
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillText(displayName, nameX + 1, nameY + 1);

        ctx.fillStyle = isSelf ? "#ffffff" : "#22c1ff";
        ctx.fillText(displayName, nameX, nameY);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      mounted = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [gameState]);

  // Join nexus handler
  const handleJoinNexus = () => {
    if (!callsign.trim()) return;
    setGameState("main");
    connect(callsign.trim());
  };

  // Disconnect handler
  const handleDisconnect = () => {
    // Clear reconnection attempts and timeouts
    setReconnectAttempts(0);
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (wsRef.current) {
      // Clean up event handlers before closing
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setGameState("login");
    setCallsign("");
    setSelfId(null);
    setRoom(null);
    setParticipantsMap(new Map());
    setNearby([]);
    setConnected(false);
  };

  // Test move button for debugging
  const handleTestMove = () => {
    console.log(`Test move button clicked`);
    const targetX = Math.random() * 1600;
    const targetY = Math.random() * 900;

    // Simulate click behavior
    if (!selfId) return;

    const currentParticipant = participantsMap.get(selfId);
    if (!currentParticipant) return;

    const startPos = { x: currentParticipant.x, y: currentParticipant.y };
    const targetPos = { x: Math.round(targetX), y: Math.round(targetY) };

    setTargetPosition(targetPos);
    setIsMoving(true);
    startPositionRef.current = startPos;
    animationStartTimeRef.current = performance.now();
  };

  // Send chat message
  const sendChatMessage = useCallback(() => {
    const message = sanitizeInput(chatInput);
    if (!message || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const chatData = {
      type: "chat",
      payload: { message }
    };

    console.log("Sending chat message:", message);
    wsRef.current.send(JSON.stringify(chatData));
    setChatInput("");
  }, [chatInput]);

  // Chat message sanitization
  const sanitizeInput = (input) => {
    return input
      .replace(/[<>]/g, '') // Remove potential HTML
      .slice(0, 200) // Limit length
      .trim();
  };

  // Handle chat input key press
  const handleChatKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  }, [sendChatMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, []);

  // Login Screen
  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 flex items-center justify-center p-6">
        <div className="bg-slate-800/50 backdrop-blur-lg border border-cyan-500/30 rounded-2xl p-12 max-w-md w-full shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-cyan-300 mb-2 font-mono">
              FUTURISTIC NEXUS
            </h1>
            <p className="text-slate-400 text-sm font-mono">
              // YEAR 2070 // NEURAL NETWORK INTERFACE
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-cyan-300 text-sm font-mono mb-2">
                CALLSIGN_IDENTIFIER
              </label>
              <input
                type="text"
                value={callsign}
                onChange={(e) => setCallsign(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinNexus()}
                placeholder="Enter your callsign..."
                className="w-full bg-slate-700/50 border border-cyan-500/50 rounded-lg px-4 py-3 text-white font-mono placeholder-slate-400 focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                maxLength={32}
              />
            </div>

            <button
              onClick={handleJoinNexus}
              disabled={!callsign.trim()}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-black disabled:text-slate-400 font-bold py-3 px-6 rounded-lg transition-all duration-200 font-mono"
            >
              [ ENTER NEXUS ]
            </button>
          </div>

          <div className="mt-8 text-xs text-slate-500 font-mono text-center">
            Move your mouse to navigate the neural space
            <br />
            Connect with others within proximity radius
          </div>
        </div>
      </div>
    );
  }

  // Main Game View
  return (
    <div className="min-h-screen bg-slate-900 text-white font-mono">
      {/* Header */}
      <div className="bg-slate-800 border-b border-cyan-500/30 p-4">
        <div className="flex justify-between items-center max-w-7xl mx-auto">
          <div className="flex items-center space-x-6">
            <h1 className="text-xl font-bold text-cyan-300">
              FUTURISTIC NEXUS
            </h1>
            <div className="flex space-x-4 text-sm">
              <span className="text-slate-400">
                STATUS:{" "}
                <span className={connected ? "text-green-400" : "text-red-400"}>
                  {connected ? "CONNECTED" : "DISCONNECTED"}
                </span>
              </span>
              <span className="text-slate-400">
                PARTICIPANTS:{" "}
                <span className="text-cyan-300">{participantsMap.size}</span>
              </span>
              <span className="text-slate-400">
                NEARBY: <span className="text-cyan-300">{nearby.length}</span>
              </span>
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleTestMove}
              className="bg-yellow-600 hover:bg-yellow-500 text-black px-3 py-1 rounded text-sm transition-colors duration-200"
            >
              TEST MOVE
            </button>
            <button
              onClick={handleDisconnect}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition-colors duration-200"
            >
              DISCONNECT
            </button>
          </div>
        </div>
      </div>

      {/* Debug Panel */}
      <div className="bg-slate-800/30 border-b border-cyan-500/20 p-2">
        <div className="max-w-7xl mx-auto">
          <div className="text-xs text-cyan-300 font-mono grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              WS: <span className="text-white">{debugInfo.wsState}</span>
            </div>
            <div>
              Sent: <span className="text-white">{debugInfo.messagesSent}</span>
            </div>
            <div>
              Received:{" "}
              <span className="text-white">{debugInfo.messagesReceived}</span>
            </div>
            <div>
              Self ID:{" "}
              <span className="text-white">
                {selfId?.slice(0, 8) || "none"}
              </span>
            </div>
            <div>
              Room:{" "}
              <span className="text-white">
                {room ? `${room.width}x${room.height}` : "default"}
              </span>
            </div>
            {debugInfo.lastMousePos && (
              <div className="col-span-2">
                Last Mouse:{" "}
                <span className="text-white">
                  ({debugInfo.lastMousePos.x}, {debugInfo.lastMousePos.y})
                </span>
              </div>
            )}
            {debugInfo.lastSentMove && (
              <div className="col-span-2">
                Last Move:{" "}
                <span className="text-white">
                  ({debugInfo.lastSentMove.x}, {debugInfo.lastSentMove.y})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="flex items-center justify-center p-6">
        <div className="relative">
          <div className="border-2 border-cyan-500/30 rounded-lg overflow-hidden shadow-2xl">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="cursor-pointer transition-all duration-200 hover:border-cyan-400/50"
            />
          </div>

          {/* Overlay Info */}
          <div className="absolute top-4 left-4 bg-slate-800/80 backdrop-blur-sm border border-cyan-500/30 rounded-lg p-3 text-xs">
            <div className="text-cyan-300 font-bold mb-1">NEURAL MAP</div>
            <div className="text-slate-300">1600 × 900</div>
            {selfId && (
              <div className="text-slate-400 mt-1">
                ID: {selfId.slice(0, 8)}...
              </div>
            )}
            {isMoving && (
              <div className="text-yellow-400 mt-1 animate-pulse">
                ⟶ MOVING
              </div>
            )}
          </div>

          {/* Chat Panel */}
          {showChat && nearby.length > 0 && (
            <div className="absolute bottom-4 left-4 bg-slate-800/95 backdrop-blur-sm border border-cyan-500/30 rounded-lg w-80 shadow-2xl">
              {/* Chat Header */}
              <div className="p-3 border-b border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <div className="text-cyan-300 font-bold text-sm">
                    PROXIMITY CHAT
                  </div>
                  <div className="text-xs text-slate-400">
                    {nearby.length} nearby
                  </div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="h-48 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-cyan-500/30">
                {chatMessages.slice(-20).map((msg) => (
                  <div
                    key={msg.id}
                    className={`text-xs ${
                      msg.isOwn
                        ? 'text-right'
                        : 'text-left'
                    }`}
                  >
                    <div className={`inline-block max-w-[90%] p-2 rounded ${
                      msg.isOwn
                        ? 'bg-cyan-600/20 text-cyan-100'
                        : 'bg-slate-700/50 text-slate-200'
                    }`}>
                      {!msg.isOwn && (
                        <div className="text-cyan-300 font-bold mb-1">
                          {msg.senderName}
                        </div>
                      )}
                      <div>{msg.message}</div>
                      <div className="text-xs opacity-50 mt-1">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))}
                {chatMessages.length === 0 && (
                  <div className="text-center text-slate-400 text-xs py-4">
                    Move closer to other participants to start chatting
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 border-t border-cyan-500/20">
                <div className="flex space-x-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={handleChatKeyPress}
                    placeholder="Type your message..."
                    className="flex-1 bg-slate-700/50 border border-cyan-500/30 rounded px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
                    maxLength={200}
                    disabled={nearby.length === 0}
                  />
                  <button
                    onClick={sendChatMessage}
                    disabled={!chatInput.trim() || nearby.length === 0}
                    className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-3 py-2 rounded text-sm transition-colors duration-200"
                  >
                    Send
                  </button>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Messages visible to participants within {PROXIMITY_RADIUS}px
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="max-w-4xl mx-auto px-6 pb-6">
        <div className="bg-slate-800/50 border border-cyan-500/20 rounded-lg p-4 text-sm">
          <div className="text-cyan-300 font-bold mb-2">
            NEURAL INTERFACE INSTRUCTIONS
          </div>
          <div className="text-slate-400 space-y-1">
            <div>• <span className="text-cyan-300">Click anywhere</span> on the neural map to move your avatar</div>
            <div>• Your avatar will <span className="text-cyan-300">smoothly animate</span> to the target location</div>
            <div>• <span className="text-cyan-300">Chat panel appears</span> when other participants are within {PROXIMITY_RADIUS}px</div>
            <div>• Messages are <span className="text-cyan-300">only visible</span> to participants in proximity range</div>
            <div>• Use <span className="text-cyan-300">Enter</span> to send messages quickly</div>
            <div>• Blue lines connect you to nearby participants within proximity</div>
          </div>
        </div>
      </div>
    </div>
  );
}

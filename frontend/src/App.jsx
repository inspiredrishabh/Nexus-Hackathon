import React, { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = "ws://localhost:5000";
const PROXIMITY_RADIUS = 200;

export default function App() {
  // UI State
  const [gameState, setGameState] = useState("login"); // "login" | "main"
  const [callsign, setCallsign] = useState("");

  // Connection State
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [room, setRoom] = useState(null);

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

  // Refs
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastMoveRef = useRef(0);
  const participantsRef = useRef(participantsMap);
  const nearbyRef = useRef(nearby);
  const selfIdRef = useRef(selfId);

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

  // Rate-limited move function
  const sendMove = useCallback(
    (x, y) => {
      const now = Date.now();
      if (now - lastMoveRef.current < 12) {
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

      console.log(`Sending move:`, moveData);
      ws.send(JSON.stringify(moveData));

      // Add this code to update your own position locally
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

  // Handle canvas mouse movement
  const handleCanvasMouseMove = useCallback(
    (e) => {
      const roomData = room || { width: 1600, height: 900 };

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();

      const scaleX = roomData.width / rect.width;
      const scaleY = roomData.height / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      console.log(`Mouse coords: ${x}, ${y}`);

      // Update debug info
      setDebugInfo((prev) => ({
        ...prev,
        lastMousePos: { x: Math.round(x), y: Math.round(y), time: Date.now() },
      }));

      sendMove(x, y);
    },
    [room, sendMove]
  );

  // WebSocket connection management
  const connect = useCallback((name) => {
    console.log(`Connecting with name: ${name}`);

    // Don't close existing connection if it's the same one
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`Already connected, skipping`);
      return;
    }

    if (wsRef.current) {
      console.log(`Closing existing WebSocket`);
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    setDebugInfo((prev) => ({ ...prev, wsState: "CONNECTING" }));

    ws.addEventListener("open", () => {
      console.log(`WebSocket connected`);
      setConnected(true);
      setDebugInfo((prev) => ({ ...prev, wsState: "OPEN" }));

      const joinMessage = {
        type: "join",
        payload: { name: name || `Guest-${Math.floor(Math.random() * 1000)}` },
      };
      console.log(`Sending join message:`, joinMessage);
      ws.send(JSON.stringify(joinMessage));
    });

    ws.addEventListener("message", (ev) => {
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
            const joinedParticipant = data.payload.participant;
            if (joinedParticipant) {
              setParticipantsMap((prev) => {
                const copy = new Map(prev);
                copy.set(joinedParticipant.id, joinedParticipant);
                return copy;
              });
            }
            break;

          case "moved":
            const { id, x, y } = data.payload;
            setParticipantsMap((prev) => {
              const copy = new Map(prev);
              const existing = copy.get(id);
              if (existing) {
                copy.set(id, { ...existing, x, y });
              }
              return copy;
            });
            break;

          case "renamed":
            const { id: renameId, name: newName } = data.payload;
            setParticipantsMap((prev) => {
              if (!prev.has(renameId)) return prev;
              const copy = new Map(prev);
              const existing = copy.get(renameId);
              copy.set(renameId, { ...existing, name: newName });
              return copy;
            });
            break;

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
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    });

    ws.addEventListener("close", () => {
      console.log(`WebSocket closed`);
      setConnected(false);
      setDebugInfo((prev) => ({ ...prev, wsState: "CLOSED" }));
      // Don't reset data immediately to avoid flashing
    });

    ws.addEventListener("error", (err) => {
      console.error("WebSocket error:", err);
      setDebugInfo((prev) => ({ ...prev, wsState: "ERROR" }));
    });
  }, []); // Remove selfId dependency to prevent reconnections

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
      const selfParticipant = selfId ? participants.get(selfId) : null;

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

      // Draw all participants
      for (const [id, participant] of participants) {
        const isSelf = id === selfId;

        // Glow effect
        ctx.beginPath();
        ctx.fillStyle = isSelf
          ? "rgba(255, 255, 255, 0.1)"
          : "rgba(34, 193, 255, 0.1)";
        ctx.arc(participant.x, participant.y, 25, 0, Math.PI * 2);
        ctx.fill();

        // Main avatar circle
        ctx.beginPath();
        ctx.fillStyle = participant.color || "#22c1ff";
        ctx.arc(participant.x, participant.y, isSelf ? 15 : 12, 0, Math.PI * 2);
        ctx.fill();

        // Border for self
        if (isSelf) {
          ctx.beginPath();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.arc(participant.x, participant.y, 18, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Name label
        ctx.font =
          "14px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
        ctx.fillStyle = isSelf ? "#ffffff" : "#22c1ff";
        ctx.textAlign = "left";

        const nameX = participant.x + 25;
        const nameY = participant.y + 5;

        // Text shadow for better readability
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillText(participant.name || "Guest", nameX + 1, nameY + 1);

        ctx.fillStyle = isSelf ? "#ffffff" : "#22c1ff";
        ctx.fillText(participant.name || "Guest", nameX, nameY);
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
  }, [gameState]); // Only depend on gameState

  // Join nexus handler
  const handleJoinNexus = () => {
    if (!callsign.trim()) return;
    setGameState("main");
    connect(callsign.trim());
  };

  // Disconnect handler
  const handleDisconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setGameState("login");
    setCallsign("");
    setSelfId(null);
    setRoom(null);
    setParticipantsMap(new Map());
    setNearby([]);
  };

  // Test move button for debugging
  const handleTestMove = () => {
    console.log(`Test move button clicked`);
    sendMove(Math.random() * 1600, Math.random() * 900);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
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
              onMouseMove={handleCanvasMouseMove}
              className="cursor-crosshair"
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
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="max-w-4xl mx-auto px-6 pb-6">
        <div className="bg-slate-800/50 border border-cyan-500/20 rounded-lg p-4 text-sm">
          <div className="text-cyan-300 font-bold mb-2">
            NEURAL INTERFACE INSTRUCTIONS
          </div>
          <div className="text-slate-400 space-y-1">
            <div>• Move your mouse cursor over the neural map to navigate</div>
            <div>
              • Your avatar appears with a white border and proximity radius
            </div>
            <div>
              • Blue lines connect you to nearby participants within{" "}
              {PROXIMITY_RADIUS}px
            </div>
            <div>
              • Use "TEST MOVE" button to verify WebSocket communication
            </div>
            <div>
              • Check browser console for detailed debugging information
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

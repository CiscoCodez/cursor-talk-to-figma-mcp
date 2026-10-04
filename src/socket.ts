#!/usr/bin/env bun

import { ServerWebSocket } from "bun";

type ClientType = "mcp" | "figma" | "unknown";
type ClientState = { channel: string | null; clientType: ClientType; joinedAt: number };

const channels = new Map<string, Set<ServerWebSocket<unknown>>>();
const clientStates = new Map<ServerWebSocket<unknown>, ClientState>();

function normalizeChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeClientType(value: unknown): ClientType {
  return value === "mcp" || value === "figma" ? value : "unknown";
}

function removeFromChannel(ws: ServerWebSocket<unknown>) {
  const state = clientStates.get(ws);
  if (!state?.channel) return;
  const clients = channels.get(state.channel);
  clients?.delete(ws);
  if (clients?.size === 0) channels.delete(state.channel);
  state.channel = null;
}

function peerCounts(channelName: string, exclude?: ServerWebSocket<unknown>) {
  const counts = { figma: 0, mcp: 0, unknown: 0 };
  for (const client of channels.get(channelName) || []) {
    if (client === exclude || client.readyState !== WebSocket.OPEN) continue;
    counts[clientStates.get(client)?.clientType || "unknown"]++;
  }
  return counts;
}

function recipientsFor(ws: ServerWebSocket<unknown>, channelName: string) {
  const senderType = clientStates.get(ws)?.clientType || "unknown";
  const candidates = [...(channels.get(channelName) || [])].filter((client) => {
    if (client === ws || client.readyState !== WebSocket.OPEN) return false;
    const recipientType = clientStates.get(client)?.clientType || "unknown";
    if (senderType === "mcp") return recipientType === "figma" || recipientType === "unknown";
    if (senderType === "figma") return recipientType === "mcp" || recipientType === "unknown";
    return true;
  });

  if (senderType !== "mcp" || candidates.length <= 1) return candidates;

  // Only one Figma document may execute a mutation. Prefer the newest explicit
  // Figma client; legacy untyped clients remain a fallback.
  const figmaClients = candidates.filter((client) => clientStates.get(client)?.clientType === "figma");
  const eligible = figmaClients.length > 0 ? figmaClients : candidates;
  eligible.sort((a, b) => (clientStates.get(b)?.joinedAt || 0) - (clientStates.get(a)?.joinedAt || 0));
  return eligible.slice(0, 1);
}

function sendError(ws: ServerWebSocket<unknown>, message: string, id?: string) {
  ws.send(JSON.stringify({
    type: id ? "broadcast" : "error",
    message: id ? { id, error: message } : message,
  }));
}

const server = Bun.serve({
  port: Number(process.env.PORT || 3055),
  fetch(req, server) {
    if (server.upgrade(req, { data: {} })) return;
    return new Response("WebSocket server running", {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  },
  websocket: {
    // Headroom for large node exports. A 16 MiB/60 MiB payload survives the
    // Bun default in 1.3.x, so this is not the fix for the old export timeouts;
    // it just keeps multi-megabyte exports from getting close to the edge.
    maxPayloadLength: Number(process.env.MAX_PAYLOAD_LENGTH || 256 * 1024 * 1024),
    backpressureLimit: Number(process.env.MAX_PAYLOAD_LENGTH || 256 * 1024 * 1024),

    open(ws) {
      clientStates.set(ws, { channel: null, clientType: "unknown", joinedAt: 0 });
      ws.send(JSON.stringify({
        type: "system",
        message: "Please join a channel to start chatting",
      }));
    },

    message(ws, rawMessage) {
      try {
        const data = JSON.parse(String(rawMessage));

        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }

        if (data.type === "join") {
          const channelName = normalizeChannel(data.channel);
          if (!channelName) {
            sendError(ws, "Channel name is required");
            return;
          }

          removeFromChannel(ws);
          const state = clientStates.get(ws) || { channel: null, clientType: "unknown" as ClientType, joinedAt: 0 };
          state.channel = channelName;
          state.clientType = normalizeClientType(data.clientType);
          state.joinedAt = Date.now();
          clientStates.set(ws, state);

          if (!channels.has(channelName)) channels.set(channelName, new Set());
          channels.get(channelName)!.add(ws);

          ws.send(JSON.stringify({
            type: "system",
            channel: channelName,
            message: {
              id: data.id,
              result: {
                channel: channelName,
                clientType: state.clientType,
                peers: peerCounts(channelName, ws),
              },
            },
          }));
          console.log(`${state.clientType} client joined channel "${channelName}"`);
          return;
        }

        if (data.type !== "message" && data.type !== "progress_update") return;

        const channelName = normalizeChannel(data.channel);
        const state = clientStates.get(ws);
        if (!channelName || state?.channel !== channelName || !channels.get(channelName)?.has(ws)) {
          sendError(ws, "You must join the channel first", data.id);
          return;
        }

        const recipients = recipientsFor(ws, channelName);
        if (recipients.length === 0) {
          if (state.clientType === "mcp" && data.type === "message") {
            sendError(
              ws,
              `No Figma plugin is connected to channel "${channelName}". Reopen the Figma development plugin and let it reconnect.`,
              data.id || data.message?.id,
            );
          }
          return;
        }

        const forwarded = data.type === "progress_update"
          ? { ...data, channel: channelName }
          : { type: "broadcast", message: data.message, sender: state.clientType, channel: channelName };
        const serialized = JSON.stringify(forwarded);
        for (const recipient of recipients) recipient.send(serialized);
      } catch (error) {
        console.error("Error handling WebSocket message:", error);
        sendError(ws, "Invalid WebSocket message");
      }
    },

    close(ws) {
      removeFromChannel(ws);
      clientStates.delete(ws);
    },
  },
});

console.log(`WebSocket server running on port ${server.port}`);

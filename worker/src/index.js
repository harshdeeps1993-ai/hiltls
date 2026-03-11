import { buildSystemPrompt } from "./prompt.js";
import { callGemini } from "./gemini.js";

const ALLOWED_ORIGINS = [
  "https://harshdeeps1993-ai.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60; // seconds
const MAX_QUESTION_LENGTH = 500;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function checkRateLimit(ip, env) {
  const key = `rate:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  const stored = await env.RATE_LIMIT.get(key, "json");
  let record = stored || { count: 0, windowStart: now };

  if (now - record.windowStart >= RATE_LIMIT_WINDOW) {
    record = { count: 0, windowStart: now };
  }

  record.count++;

  await env.RATE_LIMIT.put(key, JSON.stringify(record), {
    expirationTtl: RATE_LIMIT_WINDOW * 2,
  });

  return record.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/chat") {
      return jsonResponse({ error: "Not found" }, 404, corsHeaders);
    }

    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const allowed = await checkRateLimit(ip, env);
    if (!allowed) {
      return jsonResponse(
        { error: "You're asking questions faster than I can think! Please wait a minute and try again." },
        429,
        corsHeaders
      );
    }

    // Parse and validate body
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_BODY_SIZE) {
      return jsonResponse({ error: "Request too large" }, 413, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, corsHeaders);
    }

    const { question, episodes, questions, history } = body;

    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return jsonResponse({ error: "Question is required" }, 400, corsHeaders);
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return jsonResponse({ error: `Question too long (max ${MAX_QUESTION_LENGTH} characters)` }, 400, corsHeaders);
    }

    if (!Array.isArray(episodes) || episodes.length === 0) {
      return jsonResponse({ error: "Episode context is required" }, 400, corsHeaders);
    }

    // Build prompt and call Gemini
    const systemPrompt = buildSystemPrompt(episodes, questions || []);

    const conversationHistory = [];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-4)) {
        if (msg.role && msg.content) {
          conversationHistory.push({ role: msg.role, content: msg.content });
        }
      }
    }
    conversationHistory.push({ role: "user", content: question.trim() });

    try {
      const answer = await callGemini(env.GEMINI_API_KEY, systemPrompt, conversationHistory);
      return jsonResponse({ answer }, 200, corsHeaders);
    } catch (err) {
      console.error("Gemini error:", err.message);
      return jsonResponse(
        { error: "Sorry, I had trouble generating a response. Please try again." },
        502,
        corsHeaders
      );
    }
  },
};

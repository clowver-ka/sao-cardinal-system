declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// ── SMOKE TEST: Does the extension even load? ────────────────

spindle.log.info("🔥 SMOKE TEST: Backend loaded successfully.");

// ── SMOKE TEST: Does the interceptor fire? ───────────────────

spindle.registerInterceptor(async (messages, ctx) => {
  spindle.log.info(`🔥 SMOKE TEST: Interceptor fired. Chat: ${ctx.chatId}. Messages: ${messages.length}`);

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg) {
    const content = typeof lastUserMsg.content === "string"
      ? lastUserMsg.content.slice(0, 100)
      : "[non-string content]";
    spindle.log.info(`🔥 SMOKE TEST: Last user message: "${content}"`);
  }

  // Always return messages unchanged
  return messages;
});

spindle.log.info("🔥 SMOKE TEST: Interceptor registered. Waiting for messages...");

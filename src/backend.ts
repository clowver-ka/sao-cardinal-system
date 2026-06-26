// ─────────────────────────────────────────────────────────────
// SAO Cardinal System — Backend v0.5
// Adds: variable parsing from LLM output via [SYS_VARS: ...] blocks
// ─────────────────────────────────────────────────────────────

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// ── Configuration ────────────────────────────────────────────

const CONFIG = {
  SAVE_POINT_COMMENT: "Save Point — Current",
  WORLD_BOOK_NAME: "SAO Save Points",
  ARCHIVE_COMMENT_PREFIX: "Save Point — ",
  LAST_SAVE_VARIABLE: "last_save_date",
  IN_GAME_DATE_VARIABLE: "in_game_date",
  CURRENT_FLOOR_VARIABLE: "current_floor",
};

// ── Variable Parsing ─────────────────────────────────────────

/**
 * Scans text for [SYS_VARS: key1=value1, key2=value2] blocks.
 * Returns the cleaned text (with blocks removed) and a map of extracted variables.
 */
function extractVariables(text: string): { cleanedText: string; variables: Record<string, string> } {
  const variables: Record<string, string> = {};
  const sysVarsRegex = /\[SYS_VARS:\s*([^\]]+)\]/gi;

  const cleanedText = text.replace(sysVarsRegex, (match, pairsStr) => {
    // Parse key=value pairs, separated by commas
    const pairs = pairsStr.split(",");
    for (const pair of pairs) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) continue;
      const key = pair.substring(0, eqIndex).trim();
      const value = pair.substring(eqIndex + 1).trim();
      if (key && value) {
        variables[key] = value;
      }
    }
    return ""; // Remove the block from visible output
  });

  // Clean up any double-newlines left by removing the blocks
  return {
    cleanedText: cleanedText.replace(/\n{3,}/g, "\n\n").trim(),
    variables,
  };
}

// ── Helper: Detect a new in-game day ─────────────────────────

function detectNewDay(text: string): boolean {
  const dayPatterns = [
    /\bthe next morning\b/i,
    /\bthe following morning\b/i,
    /\bthe following day\b/i,
    /\bthe next day\b/i,
    /\bwakes? up\b/i,
    /\bwoke up\b/i,
    /\bdawn broke\b/i,
    /\bat sunrise\b/i,
    /\bat dawn\b/i,
  ];
  return dayPatterns.some((pattern) => pattern.test(text));
}

function detectManualSave(userMessage: string): boolean {
  return /\bsave\b/i.test(userMessage) && userMessage.length < 20;
}

// ── Save Point Template ──────────────────────────────────────

async function buildSavePointTemplate(
  chatId: string,
  userId: string,
  inGameDate: string,
  currentFloor: string
): Promise<string> {
  const activeQuestsRaw = await spindle.variables.chat.get(chatId, "active_quests", userId);
  const activeQuests = activeQuestsRaw ? activeQuestsRaw.split(",").map((q) => q.trim()) : [];

  let recentEvents: string[] = [];
  let characterThoughts: string[] = [];
  try {
    const cortexResult = await spindle.memories.cortex.query({
      chatId, queryText: "recent events today", topK: 5, userId,
    });
    recentEvents = cortexResult.memories.map((m) => m.content);

    const entities = await spindle.memories.entities.list(chatId, { activeOnly: true, userId });
    for (const entity of entities.slice(0, 10)) {
      const facts = await spindle.memories.entities.getFacts(entity.id, userId);
      const thoughts = facts ? facts.slice(0, 1).join(" ") : "No recent data.";
      characterThoughts.push(
        `<div style="font-weight: 600; color: #1a1a1a;">${entity.name}</div>
         <div style="color: #4a4a4a; margin-top: 2px;">💭 <span style="font-style: italic;">${thoughts}</span></div>`
      );
    }
  } catch {
    recentEvents = ["Memory Cortex unavailable. Limited tracking active."];
    characterThoughts = ["Character data unavailable."];
  }

  const developmentsHTML = recentEvents.map((e) => `<div style="padding: 3px 0;">• ${e}</div>`).join("\n");
  const characterHTML = characterThoughts.map((t) =>
    `<div style="font-size: 0.82em; padding: 8px 10px; background: #f8f9fa; margin-bottom: 6px;">${t}</div>`
  ).join("\n");
  const questsHTML = activeQuests.length
    ? activeQuests.map((q) =>
        `<div style="padding: 4px 0; border-bottom: 1px dotted #e0e3e7;">
          <span style="font-weight: 600; color: #1a1a1a;">${q}</span>
          <span style="color: #6b7280;"> — Status: Active</span></div>`
      ).join("\n")
    : `<div style="padding: 4px 0; color: #8a8f94;">No active quests.</div>`;

  return `<details style='background: #ffffff; color: #2d2d2d; border: 1px solid #b0b4b8; max-width: 620px; font-family: "Segoe UI", "Roboto", "Noto Sans", system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.15); margin: 0 auto;'>
  <summary style='background: #ffffff; border-bottom: 1px solid #F1DC46; padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; list-style: none;'>
    <div><div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px;'>System — Save Point</div>
    <div style='font-size: 0.92em; font-weight: 600; color: #1a1a1a;'>${inGameDate} — Floor ${currentFloor}</div></div>
    <div style='font-size: 0.68em; color: #F1DC46; font-weight: 600; letter-spacing: 0.04em;'>▼ EXPAND</div>
  </summary>
  <div style='padding: 18px 20px;'>
    <div style='margin-bottom: 16px;'><div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📋 Active Quests</div><div style='font-size: 0.8em;'>${questsHTML}</div></div>
    <div style='margin-bottom: 16px;'><div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>👥 Character Status</div>${characterHTML}</div>
    <div style='margin-bottom: 16px;'><div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📊 Recent Developments</div><div style='font-size: 0.8em;'>${developmentsHTML}</div></div>
  </div></details>`;
}

// ── World Book Helpers ───────────────────────────────────────

async function getOrCreateSavePointBook(userId: string): Promise<string> {
  const { data: books } = await spindle.world_books.list({ limit: 50, userId });
  const existing = books.find((b) => b.name === CONFIG.WORLD_BOOK_NAME);
  if (existing) return existing.id;
  const newBook = await spindle.world_books.create({ name: CONFIG.WORLD_BOOK_NAME, description: "Automated Save Point entries.", userId });
  return newBook.id;
}

async function archivePreviousSavePoint(bookId: string, date: string, userId: string): Promise<void> {
  const { data: entries } = await spindle.world_books.entries.list(bookId, { limit: 100, userId });
  const currentEntry = entries.find((e) => e.comment === CONFIG.SAVE_POINT_COMMENT);
  if (currentEntry) {
    await spindle.world_books.entries.update(currentEntry.id, { constant: false, comment: `${CONFIG.ARCHIVE_COMMENT_PREFIX}${date}`, userId });
  }
}

async function writeSavePoint(bookId: string, content: string, userId: string): Promise<void> {
  await spindle.world_books.entries.create(bookId, { key: ["save_point", "daily_summary", "cardinal_system"], content, comment: CONFIG.SAVE_POINT_COMMENT, constant: true, position: 0, priority: 100, userId });
}

// ── Main Logic ───────────────────────────────────────────────

async function processSavePoint(chatId: string, userId: string, userMessage: string, generatedText: string): Promise<boolean> {
  const isNewDay = detectNewDay(generatedText);
  const isManualSave = detectManualSave(userMessage);
  if (!isNewDay && !isManualSave) return false;

  const inGameDate = (await spindle.variables.chat.get(chatId, CONFIG.IN_GAME_DATE_VARIABLE, userId)) || "Unknown Date";
  const currentFloor = (await spindle.variables.chat.get(chatId, CONFIG.CURRENT_FLOOR_VARIABLE, userId)) || "1";
  const template = await buildSavePointTemplate(chatId, userId, inGameDate, currentFloor);

  try {
    const bookId = await getOrCreateSavePointBook(userId);
    await archivePreviousSavePoint(bookId, inGameDate, userId);
    await writeSavePoint(bookId, template, userId);
    await spindle.variables.chat.set(chatId, CONFIG.LAST_SAVE_VARIABLE, inGameDate, userId);
    spindle.log.info(`Save Point written for ${inGameDate} (Floor ${currentFloor})`);
    return true;
  } catch (err) {
    spindle.log.error(`Failed to write Save Point: ${err}`);
    return false;
  }
}

// ── Interceptor ──────────────────────────────────────────────

spindle.registerInterceptor(async (messages, ctx) => {
  // Find the last assistant message (the LLM's just-generated response)
  const assistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  if (!assistantMsg) return messages;

  const rawContent = typeof assistantMsg.content === "string" ? assistantMsg.content : "";
  
  // Step 1: Extract [SYS_VARS: ...] blocks and update variables
  const { cleanedText, variables } = extractVariables(rawContent);
  
  if (Object.keys(variables).length > 0) {
    // Determine userId — use the install_scope: user manifest setting,
    // which means the extension runs in user context and we can try
    // spindle.chats.get to get the userId, or use a fallback
    let userId = "";
    try {
      const chat = await spindle.chats.get(ctx.chatId);
      userId = (chat as any).userId || (chat as any).ownerId || "";
    } catch {
      // If chats.get also needs userId, we'll catch it below
    }

    if (userId) {
      for (const [key, value] of Object.entries(variables)) {
        await spindle.variables.chat.set(ctx.chatId, key, value, userId);
        spindle.log.info(`Variable set: ${key} = ${value}`);
      }

      // Step 2: Check if a Save Point should fire
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const userText = lastUserMsg && typeof lastUserMsg.content === "string" ? lastUserMsg.content : "";
      await processSavePoint(ctx.chatId, userId, userText, rawContent);

      // Step 3: Strip the [SYS_VARS] block from the visible message
      if (cleanedText !== rawContent) {
        assistantMsg.content = cleanedText;
      }
    } else {
      spindle.log.warn("Could not determine userId for variable update. Skipping.");
    }
  }

  return messages;
});

spindle.log.info("SAO Cardinal System: Backend v0.5 loaded — variable parsing active.");

// ─────────────────────────────────────────────────────────────
// SAO Cardinal System — Save Point Backend (v0.3)
// Fix: fetch userId from chat object instead of ctx.userId
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

// ── Cached userId (fetched once from chat object) ────────────

let cachedUserId: string | null = null;

/**
 * Gets the userId by querying the chat object.
 * The chat's owner is the user we need for all subsequent API calls.
 * Result is cached so we only make this query once per session.
 */
async function getUserId(chatId: string): Promise<string> {
  if (cachedUserId) return cachedUserId;

  try {
    // spindle.chats.get returns the chat object, which includes userId/ownerId
    const chat = await spindle.chats.get(chatId);
    if (chat && chat.userId) {
      cachedUserId = chat.userId;
      spindle.log.info(`UserId cached from chat: ${cachedUserId}`);
      return cachedUserId;
    }
    // Fallback: some API versions use ownerId
    if (chat && (chat as any).ownerId) {
      cachedUserId = (chat as any).ownerId;
      spindle.log.info(`UserId cached from chat (ownerId): ${cachedUserId}`);
      return cachedUserId;
    }
  } catch (err) {
    spindle.log.error(`Failed to fetch chat for userId: ${err}`);
  }

  spindle.log.warn("Could not determine userId from chat. Save Point will be skipped.");
  return "";
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

// ── Helper: Build the Save Point HTML template ────────────────

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
      chatId,
      queryText: "recent events today",
      topK: 5,
      userId,
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

  const developmentsHTML = recentEvents
    .map((event) => `<div style="padding: 3px 0;">• ${event}</div>`)
    .join("\n");

  const characterHTML = characterThoughts
    .map(
      (thought) =>
        `<div style="font-size: 0.82em; padding: 8px 10px; background: #f8f9fa; margin-bottom: 6px;">${thought}</div>`
    )
    .join("\n");

  const questsHTML = activeQuests.length
    ? activeQuests
        .map(
          (quest) =>
            `<div style="padding: 4px 0; border-bottom: 1px dotted #e0e3e7;">
              <span style="font-weight: 600; color: #1a1a1a;">${quest}</span>
              <span style="color: #6b7280;"> — Status: Active</span>
            </div>`
        )
        .join("\n")
    : `<div style="padding: 4px 0; color: #8a8f94;">No active quests.</div>`;

  return `
<details style='background: #ffffff; color: #2d2d2d; border: 1px solid #b0b4b8; max-width: 620px; font-family: "Segoe UI", "Roboto", "Noto Sans", system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.15); margin: 0 auto;'>
  <summary style='background: #ffffff; border-bottom: 1px solid #F1DC46; padding: 12px 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; list-style: none;'>
    <div>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px;'>System — Save Point</div>
      <div style='font-size: 0.92em; font-weight: 600; color: #1a1a1a;'>${inGameDate} — Floor ${currentFloor}</div>
    </div>
    <div style='font-size: 0.68em; color: #F1DC46; font-weight: 600; letter-spacing: 0.04em;'>▼ EXPAND</div>
  </summary>
  <div style='padding: 18px 20px;'>
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📋 Active Quests</div>
      <div style='font-size: 0.8em;'>${questsHTML}</div>
    </div>
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>👥 Character Status</div>
      ${characterHTML}
    </div>
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📊 Recent Developments</div>
      <div style='font-size: 0.8em;'>${developmentsHTML}</div>
    </div>
  </div>
</details>`;
}

// ── Helper: Find or create the Save Point World Book ──────────

async function getOrCreateSavePointBook(userId: string): Promise<string> {
  const { data: books } = await spindle.world_books.list({ limit: 50, userId });
  const existing = books.find((b) => b.name === CONFIG.WORLD_BOOK_NAME);
  if (existing) return existing.id;

  const newBook = await spindle.world_books.create({
    name: CONFIG.WORLD_BOOK_NAME,
    description: "Automated Save Point entries generated by the SAO Cardinal System extension.",
    userId,
  });
  return newBook.id;
}

// ── Helper: Archive the previous Save Point ──────────────────

async function archivePreviousSavePoint(bookId: string, date: string, userId: string): Promise<void> {
  const { data: entries } = await spindle.world_books.entries.list(bookId, { limit: 100, userId });
  const currentEntry = entries.find((e) => e.comment === CONFIG.SAVE_POINT_COMMENT);

  if (currentEntry) {
    await spindle.world_books.entries.update(currentEntry.id, {
      constant: false,
      comment: `${CONFIG.ARCHIVE_COMMENT_PREFIX}${date}`,
      userId,
    });
  }
}

// ── Helper: Write the new Save Point entry ───────────────────

async function writeSavePoint(bookId: string, content: string, userId: string): Promise<void> {
  await spindle.world_books.entries.create(bookId, {
    key: ["save_point", "daily_summary", "cardinal_system"],
    content,
    comment: CONFIG.SAVE_POINT_COMMENT,
    constant: true,
    position: 0,
    priority: 100,
    userId,
  });
}

// ── Main: Process a potential Save Point trigger ─────────────

async function processSavePoint(
  chatId: string,
  userId: string,
  userMessage: string,
  generatedText: string
): Promise<boolean> {
  const isNewDay = detectNewDay(generatedText);
  const isManualSave = detectManualSave(userMessage);

  if (!isNewDay && !isManualSave) return false;

  const inGameDate =
    (await spindle.variables.chat.get(chatId, CONFIG.IN_GAME_DATE_VARIABLE, userId)) || "Unknown Date";
  const currentFloor =
    (await spindle.variables.chat.get(chatId, CONFIG.CURRENT_FLOOR_VARIABLE, userId)) || "1";

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

// ── Register the Interceptor ─────────────────────────────────

spindle.registerInterceptor(async (messages, ctx) => {
  // Fetch userId from chat object (cached after first call)
  const userId = await getUserId(ctx.chatId);
  if (!userId) {
    spindle.log.warn("Save Point interceptor skipped: could not determine userId.");
    return messages;
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  if (lastUserMsg && lastAssistantMsg) {
    const chatId = ctx.chatId;
    const userText = typeof lastUserMsg.content === "string" ? lastUserMsg.content : "";
    const generatedText = typeof lastAssistantMsg.content === "string" ? lastAssistantMsg.content : "";

    await processSavePoint(chatId, userId, userText, generatedText);
  }

  return messages;
});

spindle.log.info("SAO Cardinal System: Save Point interceptor registered (v0.3 — userId from chat).");

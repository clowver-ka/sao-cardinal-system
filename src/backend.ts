// ─────────────────────────────────────────────────────────────
// SAO Cardinal System — Save Point Backend
// Handles: daily state snapshots, trigger detection, lorebook injection
// ─────────────────────────────────────────────────────────────

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// ── Configuration ────────────────────────────────────────────

const CONFIG = {
  // The comment used to identify the current Save Point entry
  SAVE_POINT_COMMENT: "Save Point — Current",
  // World Book name where Save Points are stored
  WORLD_BOOK_NAME: "SAO Save Points",
  // Template for archived Save Point comments
  ARCHIVE_COMMENT_PREFIX: "Save Point — ",
  // The variable key for tracking the last save date
  LAST_SAVE_VARIABLE: "last_save_date",
  // The variable key for tracking in-game date
  IN_GAME_DATE_VARIABLE: "in_game_date",
  // The variable key for tracking current floor
  CURRENT_FLOOR_VARIABLE: "current_floor",
};

// ── Helper: Detect a new in-game day ─────────────────────────

/**
 * Scans the generated message text for phrases indicating a new day has started.
 * Returns true if we find "next morning", "the following day", "the next day", etc.
 * 
 * This is intentionally simple for v0.1. We can expand the pattern list later.
 */
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

/**
 * Checks if the user sent a manual /save command.
 */
function detectManualSave(userMessage: string): boolean {
  return /\bsave\b/i.test(userMessage) && userMessage.length < 20;
}

// ── Helper: Build the Save Point HTML template ────────────────

/**
 * Assembles the full Save Point template from all available data sources.
 * This mirrors the behavior spec: queries Variables, World Books, and Memory Cortex,
 * then builds the collapsible <details> block.
 */
async function buildSavePointTemplate(
  chatId: string,
  inGameDate: string,
  currentFloor: string
): Promise<string> {
  // ── Fetch Variables ──────────────────────────────────────
  const activeQuestsRaw = await spindle.variables.chat.get(chatId, "active_quests");
  const activeQuests = activeQuestsRaw ? activeQuestsRaw.split(",").map((q) => q.trim()) : [];

  // ── Fetch Memory Cortex data (if available) ──────────────
  let recentEvents: string[] = [];
  let characterThoughts: string[] = [];
  try {
    // Try to get recent cortex memories
    const cortexResult = await spindle.memories.cortex.query({
      chatId,
      queryText: "recent events today",
      topK: 5,
    });
    recentEvents = cortexResult.memories.map((m) => m.content);

    // Get active entities for character status
    const entities = await spindle.memories.entities.list(chatId, { activeOnly: true });
    for (const entity of entities.slice(0, 10)) {
      const facts = await spindle.memories.entities.getFacts(entity.id);
      const thoughts = facts ? facts.slice(0, 1).join(" ") : "No recent data.";
      characterThoughts.push(
        `<div style="font-weight: 600; color: #1a1a1a;">${entity.name}</div>
         <div style="color: #4a4a4a; margin-top: 2px;">💭 <span style="font-style: italic;">${thoughts}</span></div>`
      );
    }
  } catch {
    // Memory Cortex might not be available—degrade gracefully
    recentEvents = ["Memory Cortex unavailable. Limited tracking active."];
    characterThoughts = ["Character data unavailable."];
  }

  // ── Build Recent Developments ────────────────────────────
  const developmentsHTML = recentEvents
    .map((event) => `<div style="padding: 3px 0;">• ${event}</div>`)
    .join("\n");

  // ── Build Character Status ───────────────────────────────
  const characterHTML = characterThoughts
    .map(
      (thought) =>
        `<div style="font-size: 0.82em; padding: 8px 10px; background: #f8f9fa; margin-bottom: 6px;">${thought}</div>`
    )
    .join("\n");

  // ── Build Active Quests ──────────────────────────────────
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

  // ── Assemble Full Template ───────────────────────────────
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

    <!-- Active Quests -->
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📋 Active Quests</div>
      <div style='font-size: 0.8em;'>
        ${questsHTML}
      </div>
    </div>

    <!-- Character Status -->
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>👥 Character Status</div>
      ${characterHTML}
    </div>

    <!-- Recent Developments -->
    <div style='margin-bottom: 16px;'>
      <div style='font-size: 0.7em; color: #6b7280; letter-spacing: 0.04em; text-transform: uppercase; padding-bottom: 4px; border-bottom: 1px solid #e0e3e7; margin-bottom: 8px;'>📊 Recent Developments</div>
      <div style='font-size: 0.8em;'>
        ${developmentsHTML}
      </div>
    </div>

  </div>
</details>`;
}

// ── Helper: Find or create the Save Point World Book ──────────

/**
 * Searches for an existing Save Point world book, or creates one if not found.
 * Returns the world book ID.
 */
async function getOrCreateSavePointBook(): Promise<string> {
  const { data: books } = await spindle.world_books.list({ limit: 50 });
  const existing = books.find((b) => b.name === CONFIG.WORLD_BOOK_NAME);
  if (existing) return existing.id;

  const newBook = await spindle.world_books.create({
    name: CONFIG.WORLD_BOOK_NAME,
    description: "Automated Save Point entries generated by the SAO Cardinal System extension.",
  });
  return newBook.id;
}

// ── Helper: Archive the previous Save Point ──────────────────

/**
 * Finds the current Save Point entry (constant: true) and archives it:
 * sets constant: false, updates the comment with the archive prefix + date.
 */
async function archivePreviousSavePoint(bookId: string, date: string): Promise<void> {
  const { data: entries } = await spindle.world_books.entries.list(bookId, { limit: 100 });
  const currentEntry = entries.find((e) => e.comment === CONFIG.SAVE_POINT_COMMENT);

  if (currentEntry) {
    await spindle.world_books.entries.update(currentEntry.id, {
      constant: false,
      comment: `${CONFIG.ARCHIVE_COMMENT_PREFIX}${date}`,
    });
  }
}

// ── Helper: Write the new Save Point entry ───────────────────

/**
 * Creates a new Save Point entry in the world book.
 * Sets constant: true so it's always injected into context.
 * Sets position: 0 (before chat history) and priority: 100 (highest).
 */
async function writeSavePoint(bookId: string, content: string): Promise<void> {
  await spindle.world_books.entries.create(bookId, {
    key: ["save_point", "daily_summary", "cardinal_system"],
    content,
    comment: CONFIG.SAVE_POINT_COMMENT,
    constant: true,
    position: 0,
    priority: 100,
  });
}

// ── Main: Process a potential Save Point trigger ─────────────

/**
 * The core logic. Checks if a Save Point should fire, and if so,
 * builds the template, archives the old entry, and writes the new one.
 */
async function processSavePoint(
  chatId: string,
  userMessage: string,
  generatedText: string
): Promise<boolean> {
  // ── Check trigger conditions ────────────────────────────
  const isNewDay = detectNewDay(generatedText);
  const isManualSave = detectManualSave(userMessage);
  
  if (!isNewDay && !isManualSave) return false;

  // ── Get current state from Variables ────────────────────
  const inGameDate = (await spindle.variables.chat.get(chatId, CONFIG.IN_GAME_DATE_VARIABLE)) || "Unknown Date";
  const currentFloor = (await spindle.variables.chat.get(chatId, CONFIG.CURRENT_FLOOR_VARIABLE)) || "1";

  // ── Build the template ──────────────────────────────────
  const template = await buildSavePointTemplate(chatId, inGameDate, currentFloor);

  // ── Write to World Book ─────────────────────────────────
  try {
    const bookId = await getOrCreateSavePointBook();
    await archivePreviousSavePoint(bookId, inGameDate);
    await writeSavePoint(bookId, template);

    // Update the last save date variable
    await spindle.variables.chat.set(chatId, CONFIG.LAST_SAVE_VARIABLE, inGameDate);

    spindle.log.info(`Save Point written for ${inGameDate} (Floor ${currentFloor})`);
    return true;
  } catch (err) {
    spindle.log.error(`Failed to write Save Point: ${err}`);
    return false;
  }
}

// ── Register the Interceptor ─────────────────────────────────

/**
 * Hooks into every message-sent event. After the LLM generates a response,
 * we check if a Save Point trigger condition was met and process accordingly.
 */
spindle.registerInterceptor(async (messages, ctx) => {
  // We only care about the last user message and the generated response
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  if (lastUserMsg && lastAssistantMsg) {
    const chatId = ctx.chatId;
    const userText = typeof lastUserMsg.content === "string" ? lastUserMsg.content : "";
    const generatedText = typeof lastAssistantMsg.content === "string" ? lastAssistantMsg.content : "";

    // Process Save Point (fire-and-forget—we don't modify the messages)
    await processSavePoint(chatId, userText, generatedText);
  }

  // Always return messages unchanged—we're observing, not modifying
  return messages;
});

spindle.log.info("SAO Cardinal System: Save Point interceptor registered.");

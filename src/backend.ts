// ─────────────────────────────────────────────────────────────
// SAO Cardinal System — Backend v2.0
// Interceptor-based architecture: detects narrative patterns and updates state
// No tool calling required. Works with every LLM provider.
// ─────────────────────────────────────────────────────────────

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// ── Configuration ────────────────────────────────────────────

const CONFIG = {
  SAVE_POINT_COMMENT: "Save Point — Current",
  WORLD_BOOK_NAME: "SAO Save Points",
  ARCHIVE_COMMENT_PREFIX: "Save Point — ",
  IN_GAME_DATE_VARIABLE: "in_game_date",
  CURRENT_FLOOR_VARIABLE: "current_floor",
  LAST_SAVE_VARIABLE: "last_save_date",
};

// ── Pattern Detection ────────────────────────────────────────

/**
 * Detects phrases indicating a new in-game day has started.
 * Returns the matched phrase if found, null otherwise.
 */
function detectNewDay(text: string): string | null {
  const patterns = [
    { regex: /\bthe next morning\b/i, group: "morning" },
    { regex: /\bthe following morning\b/i, group: "morning" },
    { regex: /\bat dawn\b/i, group: "dawn" },
    { regex: /\bat sunrise\b/i, group: "sunrise" },
    { regex: /\bdawn broke\b/i, group: "dawn" },
    { regex: /\bthe next day\b/i, group: "next_day" },
    { regex: /\bthe following day\b/i, group: "next_day" },
    { regex: /\bwakes? up\b/i, group: "wake" },
    { regex: /\bwoke up\b/i, group: "wake" },
  ];
  for (const p of patterns) {
    const match = text.match(p.regex);
    if (match) return p.group;
  }
  return null;
}

/**
 * Detects floor change patterns like "arrived on Floor 2" or "stepped onto the third floor".
 * Returns the floor number as a string if found, null otherwise.
 */
function detectFloorChange(text: string): string | null {
  // "Floor X" or "floor X" where X is a number or ordinal
  const match = text.match(/\bfloor\s+(\d+)/i);
  if (match) return match[1];

  // Ordinals: "first floor", "second floor", etc.
  const ordinals: Record<string, string> = {
    first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
    sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
  };
  const ordinalMatch = text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+floor\b/i);
  if (ordinalMatch) return ordinals[ordinalMatch[1].toLowerCase()];

  return null;
}

/**
 * Detects combat start/end patterns.
 */
function detectCombatStart(text: string): boolean {
  return /\bcombat begins\b/i.test(text) || /\bdrew (her|his|their) weapon\b/i.test(text) || /\bthe (?:monster|enemy|boss) (?:lunged|charged|attacked|struck)\b/i.test(text);
}

function detectCombatEnd(text: string): boolean {
  return /\bcombat (?:ended|concluded|resolved)\b/i.test(text) || /\bthe (?:monster|enemy|boss) (?:collapsed|fell|shattered|died|was defeated)\b/i.test(text);
}

/**
 * Attempts to extract a date from the generated text.
 * Looks for common date formats: "November 6, 2022" or "November 6 2022"
 */
function extractDate(text: string): string | null {
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (match) return `${match[1]} ${match[2]} ${match[3]}`;
  return null;
}

// ── Save Point Template Builder ──────────────────────────────

async function buildSavePointTemplate(
  chatId: string,
  inGameDate: string,
  currentFloor: string
): Promise<string> {
  const activeQuestsRaw = await spindle.variables.chat.get(chatId, "active_quests");
  const activeQuests = activeQuestsRaw ? activeQuestsRaw.split(",").map((q: string) => q.trim()) : [];

  let recentEvents: string[] = [];
  let characterThoughts: string[] = [];
  try {
    const cortexResult = await spindle.memories.cortex.query({
      chatId,
      queryText: "recent events today",
      topK: 5,
    });
    recentEvents = cortexResult.memories.map((m: any) => m.content);

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
    recentEvents = ["Memory Cortex unavailable. Limited tracking active."];
    characterThoughts = ["Character data unavailable."];
  }

  const developmentsHTML = recentEvents
    .map((e) => `<div style="padding: 3px 0;">• ${e}</div>`)
    .join("\n");
  const characterHTML = characterThoughts
    .map((t) =>
      `<div style="font-size: 0.82em; padding: 8px 10px; background: #f8f9fa; margin-bottom: 6px;">${t}</div>`
    )
    .join("\n");
  const questsHTML = activeQuests.length
    ? activeQuests
        .map(
          (q: string) =>
            `<div style="padding: 4px 0; border-bottom: 1px dotted #e0e3e7;">
              <span style="font-weight: 600; color: #1a1a1a;">${q}</span>
              <span style="color: #6b7280;"> — Status: Active</span></div>`
        )
        .join("\n")
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

// ── Main: Process state changes and trigger Save Point ───────

async function processStateChanges(chatId: string, generatedText: string): Promise<void> {
  let variablesUpdated = false;
  let shouldSavePoint = false;

  // ── Check for date change ──────────────────────────────
  const newDayType = detectNewDay(generatedText);
  if (newDayType) {
    spindle.log.info(`New day detected: ${newDayType}`);

    // Try to extract a date from the text
    const extractedDate = extractDate(generatedText);
    if (extractedDate) {
      await spindle.variables.chat.set(chatId, CONFIG.IN_GAME_DATE_VARIABLE, extractedDate);
      spindle.log.info(`Date set from text: ${extractedDate}`);
      variablesUpdated = true;
      shouldSavePoint = true;
    } else {
      // No explicit date in text — increment from last known date
      const lastDate = await spindle.variables.chat.get(chatId, CONFIG.IN_GAME_DATE_VARIABLE);
      if (lastDate && lastDate !== "") {
        // Try to increment the date by one day
        const incremented = incrementDate(lastDate);
        if (incremented) {
          await spindle.variables.chat.set(chatId, CONFIG.IN_GAME_DATE_VARIABLE, incremented);
          spindle.log.info(`Date incremented: ${lastDate} → ${incremented}`);
          variablesUpdated = true;
          shouldSavePoint = true;
        }
      } else {
        // No previous date — set a default starting date
        await spindle.variables.chat.set(chatId, CONFIG.IN_GAME_DATE_VARIABLE, "November 6 2022");
        spindle.log.info("Date defaulted to: November 6 2022");
        variablesUpdated = true;
        shouldSavePoint = true;
      }
    }
  }

  // ── Check for floor change ─────────────────────────────
  const newFloor = detectFloorChange(generatedText);
  if (newFloor) {
    await spindle.variables.chat.set(chatId, CONFIG.CURRENT_FLOOR_VARIABLE, newFloor);
    spindle.log.info(`Floor set: ${newFloor}`);
    variablesUpdated = true;
  }

  // ── Check for combat start/end ─────────────────────────
  if (detectCombatStart(generatedText)) {
    await spindle.variables.chat.set(chatId, "combat_active", "true");
    spindle.log.info("Combat started.");
    variablesUpdated = true;
  }
  if (detectCombatEnd(generatedText)) {
    await spindle.variables.chat.set(chatId, "combat_active", "false");
    spindle.log.info("Combat ended.");
    variablesUpdated = true;
  }

  // ── Trigger Save Point if date changed ─────────────────
  if (shouldSavePoint) {
    const inGameDate = (await spindle.variables.chat.get(chatId, CONFIG.IN_GAME_DATE_VARIABLE)) || "Unknown Date";
    const currentFloor = (await spindle.variables.chat.get(chatId, CONFIG.CURRENT_FLOOR_VARIABLE)) || "1";

    try {
      const bookId = await getOrCreateSavePointBook();
      await archivePreviousSavePoint(bookId, inGameDate);
      const template = await buildSavePointTemplate(chatId, inGameDate, currentFloor);
      await writeSavePoint(bookId, template);
      await spindle.variables.chat.set(chatId, CONFIG.LAST_SAVE_VARIABLE, inGameDate);
      spindle.log.info(`Save Point written for ${inGameDate} (Floor ${currentFloor})`);
    } catch (err) {
      spindle.log.error(`Save Point failed: ${err}`);
    }
  }

  if (!variablesUpdated) {
    spindle.log.info("No state changes detected.");
  }
}

// ── Date Increment Helper ────────────────────────────────────

/**
 * Attempts to increment a date string by one day.
 * Handles "Month Day Year" format (e.g., "November 6 2022").
 * This is a simple implementation — doesn't handle month boundaries perfectly,
 * but works well enough for SAO's month-long floor arcs.
 */
function incrementDate(dateStr: string): string | null {
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  const match = dateStr.match(/^(\w+)\s+(\d{1,2})\s+(\d{4})$/i);
  if (!match) return null;

  const month = match[1];
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  const monthNum = months[month.toLowerCase()];
  if (!monthNum) return null;

  // Simple increment — doesn't handle month-end boundaries
  // SAO floors take weeks/months, so minor date drift is acceptable
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDays = daysInMonth[monthNum - 1];

  let newDay = day + 1;
  let newMonth = month;
  let newYear = year;

  if (newDay > maxDays) {
    newDay = 1;
    const monthNames = Object.keys(months);
    const nextMonthIndex = monthNum; // 0-indexed next month
    if (nextMonthIndex < 12) {
      newMonth = monthNames[nextMonthIndex];
    } else {
      newMonth = "January";
      newYear = year + 1;
    }
  }

  // Capitalize month name
  const capitalized = newMonth.charAt(0).toUpperCase() + newMonth.slice(1).toLowerCase();
  return `${capitalized} ${newDay} ${newYear}`;
}

// ── Register the Interceptor ─────────────────────────────────

spindle.registerInterceptor(async (messages, ctx) => {
  const chatId = ctx.chatId;

  // Find the last assistant message (the LLM's just-generated response)
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistantMsg) return messages;

  const generatedText = typeof lastAssistantMsg.content === "string" ? lastAssistantMsg.content : "";

  // Process any state changes detected in the generated text
  try {
    await processStateChanges(chatId, generatedText);
  } catch (err) {
    spindle.log.error(`Interceptor processing failed: ${err}`);
  }

  // Always return messages unchanged — we're observing, not modifying
  return messages;
});

spindle.log.info("SAO Cardinal System: Backend v2.0 loaded — interceptor pattern detection active.");

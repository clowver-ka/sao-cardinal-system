// ─────────────────────────────────────────────────────────────
// SAO Cardinal System — Backend v1.0
// Tool-based variable management with automatic Save Point triggering
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

// ── Tool: update_variables ───────────────────────────────────

spindle.tools.register(
  {
    id: "update_variables",
    description:
      "Update chat variables that track story state—date, floor, combat status, party members, and active quests. The extension automatically triggers a Save Point when in_game_date changes. Call this whenever story-state changes: a new day begins, the party changes floors, combat starts/ends, quests are accepted/completed, or party membership changes.",
    parameters: {
      type: "object",
      properties: {
        in_game_date: {
          type: "string",
          description: 'Current in-game date, e.g. "November 6 2022". Update when a new day begins.',
        },
        current_floor: {
          type: "string",
          description: 'Current floor number as a string, e.g. "2". Update when the party changes floors.',
        },
        combat_active: {
          type: "string",
          description: '"true" or "false". Set when combat starts or ends.',
        },
        party_members: {
          type: "string",
          description: 'Comma-separated list of current party member names. Update when the party changes.',
        },
        active_quests: {
          type: "string",
          description: 'Comma-separated list of active quest names. Update when quests are accepted or completed.',
        },
      },
    },
  },
  async (args, userId) => {
    // ── Determine chatId ──────────────────────────────────
    // The tool context may include chatId. If not, we need an alternative.
    // For now, we log and attempt to infer from available context.
    const chatId = (args as any)._chatId || "";
    if (!chatId) {
      spindle.log.warn("update_variables called without chatId. Variables not updated.");
      return { success: false, error: "No chatId available." };
    }

    if (!userId) {
      spindle.log.warn("update_variables called without userId. Variables not updated.");
      return { success: false, error: "No userId available." };
    }

    // ── Filter out non-variable fields ────────────────────
    const validKeys = ["in_game_date", "current_floor", "combat_active", "party_members", "active_quests"];
    const updates: Record<string, string> = {};
    for (const key of validKeys) {
      if ((args as any)[key] !== undefined) {
        updates[key] = String((args as any)[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: true, message: "No variables to update." };
    }

    // ── Write all variables ───────────────────────────────
    for (const [key, value] of Object.entries(updates)) {
      await spindle.variables.chat.set(chatId, key, value, userId);
      spindle.log.info(`Variable set: ${key} = ${value}`);
    }

    // ── Auto-trigger Save Point if date changed ───────────
    if (updates[CONFIG.IN_GAME_DATE_VARIABLE]) {
      const newDate = updates[CONFIG.IN_GAME_DATE_VARIABLE];
      const currentFloor =
        updates[CONFIG.CURRENT_FLOOR_VARIABLE] ||
        (await spindle.variables.chat.get(chatId, CONFIG.CURRENT_FLOOR_VARIABLE, userId)) ||
        "1";

      try {
        const bookId = await getOrCreateSavePointBook(userId);
        await archivePreviousSavePoint(bookId, newDate, userId);

        const template = await buildSavePointTemplate(chatId, userId, newDate, currentFloor);
        await writeSavePoint(bookId, template, userId);
        await spindle.variables.chat.set(chatId, CONFIG.LAST_SAVE_VARIABLE, newDate, userId);

        spindle.log.info(`Save Point auto-triggered for ${newDate} (Floor ${currentFloor})`);
      } catch (err) {
        spindle.log.error(`Save Point auto-trigger failed: ${err}`);
      }
    }

    return { success: true, updated: Object.keys(updates) };
  }
);

spindle.log.info("SAO Cardinal System: Tool 'update_variables' registered.");

// ── Save Point Template Builder ──────────────────────────────

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
  const newBook = await spindle.world_books.create({
    name: CONFIG.WORLD_BOOK_NAME,
    description: "Automated Save Point entries generated by the SAO Cardinal System extension.",
    userId,
  });
  return newBook.id;
}

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

spindle.log.info("SAO Cardinal System: Backend v1.0 loaded — tool-based architecture active.");

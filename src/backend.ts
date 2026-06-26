// SAO Cardinal System — LumiScript v2.0
// Wire to: ls:startup (for tool registration) in the editor UI.
// @triggers ls:startup

const CONFIG = {
  SAVE_POINT_COMMENT: "Save Point — Current",
  WORLD_BOOK_NAME: "SAO Save Points",
  ARCHIVE_COMMENT_PREFIX: "Save Point — ",
  LAST_SAVE_VARIABLE: "last_save_date",
  IN_GAME_DATE_VARIABLE: "in_game_date",
  CURRENT_FLOOR_VARIABLE: "current_floor",
};

// ── Zod schema for extracting story vars from Council context ──

const storyVarSchema = z.object({
  in_game_date: z.string().nullable().describe('Current in-game date, e.g. "November 6 2022"'),
  current_floor: z.string().nullable().describe('Current floor number, e.g. "2"'),
  combat_active: z.string().nullable().describe('"true" or "false"'),
  party_members: z.string().nullable().describe('Comma-separated party member names'),
  active_quests: z.string().nullable().describe('Comma-separated active quest names'),
});

// ── Tool registration (runs once on cold boot, handler persists) ──

if (data.__event === "ls:startup") {

  api.tools.register("update_variables", {
    display_name: "Update Story Variables",
    description:
      "Update chat variables that track story state—date, floor, combat status, party members, and active quests. The extension automatically triggers a Save Point when in_game_date changes. Call this whenever story-state changes: a new day begins, the party changes floors, combat starts/ends, quests are accepted/completed, or party membership changes.",
    parameters: {
      type: "object",
      properties: {
        in_game_date: { type: "string", description: 'Current in-game date, e.g. "November 6 2022".' },
        current_floor: { type: "string", description: 'Current floor number, e.g. "2".' },
        combat_active: { type: "string", description: '"true" or "false".' },
        party_members: { type: "string", description: "Comma-separated party member names." },
        active_quests: { type: "string", description: "Comma-separated active quest names." },
      },
    },
    council_eligible: true,  // ← CHANGED: Council needs this to roll for the tool
  }, async (args, ctx) => {
    // ── Council path: args is {context, __deadlineMs}, NOT schema params ──
    // We need to extract variable values ourselves from the chat context.
    let updates = {};

    if (args.context) {
      console.log("[cardinal] Council invocation — extracting vars from context");
      const extracted = await api.llm.generateStructured([
        {
          role: "system",
          content:
            "Extract story variables from the following chat context. " +
            "Only include fields that are clearly stated or have recently changed. " +
            "Use null for any field you cannot determine.",
        },
        { role: "user", content: args.context },
      ], storyVarSchema);

      for (const [key, value] of Object.entries(extracted)) {
        if (value !== null && value !== undefined && value !== "") {
          updates[key] = String(value);
        }
      }
    } else {
      // ── Direct invoke path: schema params ARE filled (api.tools.invoke / generateWithTools) ──
      const validKeys = ["in_game_date", "current_floor", "combat_active", "party_members", "active_quests"];
      for (const key of validKeys) {
        if (args[key] !== undefined && args[key] !== null) {
          updates[key] = String(args[key]);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return "No variables to update.";
    }

    // ── Write variables (chat scope auto-resolves the active chat) ──
    for (const [key, value] of Object.entries(updates)) {
      await api.variables.chat.set(key, value);
      console.log(`[cardinal] ${key} = ${value}`);
    }

    // ── Auto-trigger Save Point if date changed ──
    if (updates[CONFIG.IN_GAME_DATE_VARIABLE]) {
      const newDate = updates[CONFIG.IN_GAME_DATE_VARIABLE];
      const currentFloor = updates[CONFIG.CURRENT_FLOOR_VARIABLE] || "1";

      try {
        const bookId = await getOrCreateSavePointBook();
        await archivePreviousSavePoint(bookId);
        const template = await buildSavePointTemplate(newDate, currentFloor);
        await writeSavePoint(bookId, template);
        await api.variables.chat.set(CONFIG.LAST_SAVE_VARIABLE, newDate);

        console.log(`[cardinal] Save Point generated for ${newDate} (Floor ${currentFloor})`);
        return `Variables updated: ${Object.keys(updates).join(", ")}. Save Point generated for ${newDate}.`;
      } catch (err) {
        console.error("[cardinal] Save Point failed:", err);
        return `Variables updated: ${Object.keys(updates).join(", ")}. Save Point failed: ${err}`;
      }
    }

    return `Variables updated: ${Object.keys(updates).join(", ")}.`;
  });

  console.log("[cardinal] Tool 'update_variables' registered.");
}

// ── Save Point Template Builder ──────────────────────────────

async function buildSavePointTemplate(inGameDate, currentFloor) {
  const chatId = api.chat.getChatId();
  if (!chatId) {
    throw new Error("No active chat — cannot build Save Point template.");
  }

  const activeQuestsRaw = await api.variables.chat.get("active_quests");
  const activeQuests = activeQuestsRaw ? activeQuestsRaw.split(",").map((q) => q.trim()) : [];

  let recentEvents = [];
  let characterThoughts = [];

  try {
    const cortexResult = await api.memories.cortex.query({
      chatId,
      queryText: "recent events today",
      topK: 5,
    });
    recentEvents = cortexResult.memories.map((m) => m.content);

    const entities = await api.memories.entities.list(chatId, { activeOnly: true });
    for (const entity of entities.slice(0, 10)) {
      const facts = await api.memories.entities.getFacts(entity.id);
      const thoughts = facts && facts.length ? facts.slice(0, 1).join(" ") : "No recent data.";
      characterThoughts.push(
        `<div style="font-weight: 600; color: #1a1a1a;">${entity.name}</div>` +
        `<div style="color: #4a4a4a; margin-top: 2px;">💭 <span style="font-style: italic;">${thoughts}</span></div>`
      );
    }
  } catch {
    recentEvents = ["Memory Cortex unavailable. Limited tracking active."];
    characterThoughts = ["Character data unavailable."];
  }

  const developmentsHTML = recentEvents.map((e) => `<div style="padding: 3px 0;">• ${e}</div>`).join("\n");
  const characterHTML = characterThoughts
    .map((t) => `<div style="font-size: 0.82em; padding: 8px 10px; background: #f8f9fa; margin-bottom: 6px;">${t}</div>`)
    .join("\n");
  const questsHTML = activeQuests.length
    ? activeQuests
        .map((q) => `<div style="padding: 4px 0; border-bottom: 1px dotted #e0e3e7;"><span style="font-weight: 600; color: #1a1a1a;">${q}</span><span style="color: #6b7280;"> — Status: Active</span></div>`)
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

async function getOrCreateSavePointBook() {
  const existing = await api.worldInfo.findByName(CONFIG.WORLD_BOOK_NAME);
  if (existing) return existing.id;

  const created = await api.worldInfo.create({
    name: CONFIG.WORLD_BOOK_NAME,
    description: "Automated Save Point entries generated by the SAO Cardinal System.",
  });
  return created.id;
}

async function archivePreviousSavePoint(bookId) {
  const { data: entries } = await api.worldInfo.entries.list(bookId, { limit: 100 });
  const currentEntry = entries.find((e) => e.comment === CONFIG.SAVE_POINT_COMMENT);
  if (currentEntry) {
    await api.worldInfo.entries.update(currentEntry.id, {
      disabled: true,            // ← FIX: was `constant: false` — that doesn't disable the entry,
      constant: false,            //   it just stops it being always-on. `disabled: true` actually
      comment: `${CONFIG.ARCHIVE_COMMENT_PREFIX}${new Date().toISOString()}`,
    });
  }
}

async function writeSavePoint(bookId, content) {
  await api.worldInfo.entries.create(bookId, {
    key: ["save_point", "daily_summary", "cardinal_system"],
    content,
    comment: CONFIG.SAVE_POINT_COMMENT,
    constant: true,
    position: 0,
    priority: 100,
  });
}

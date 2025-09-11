// /reporting-service.ts
import { getCurrentUser } from "@/features/auth-page/helpers";
import {
  CHAT_THREAD_ATTRIBUTE,
  ChatMessageModel,
  ChatThreadModel,
  MESSAGE_ATTRIBUTE,
} from "@/features/chat-page/chat-services/models";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { SqlQuerySpec } from "@azure/cosmos";

/**
 * Existing function — unchanged (paged query)
 */
export const FindAllChatThreadsForAdmin = async (
  limit: number,
  offset: number
): Promise<ServerActionResponse<Array<ChatThreadModel>>> => {
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    return {
      status: "ERROR",
      errors: [{ message: "You are not authorized to perform this action" }],
    };
  }

  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type ORDER BY r.createdAt DESC OFFSET @offset LIMIT @limit",
      parameters: [
        {
          name: "@type",
          value: CHAT_THREAD_ATTRIBUTE,
        },
        {
          name: "@offset",
          value: offset,
        },
        {
          name: "@limit",
          value: limit,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatThreadModel>(querySpec)
      .fetchAll();
    return {
      status: "OK",
      response: resources,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

/**
 * Existing function — unchanged (messages for a thread)
 */
export const FindAllChatMessagesForAdmin = async (
  chatThreadID: string
): Promise<ServerActionResponse<Array<ChatMessageModel>>> => {
  const user = await getCurrentUser();

  if (!user.isAdmin) {
    return {
      status: "ERROR",
      errors: [{ message: "You are not authorized to perform this action" }],
    };
  }

  try {
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT * FROM root r WHERE r.type=@type AND r.threadId = @threadId ORDER BY r.createdAt ASC",
      parameters: [
        {
          name: "@type",
          value: MESSAGE_ATTRIBUTE,
        },
        {
          name: "@threadId",
          value: chatThreadID,
        },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<ChatMessageModel>(querySpec)
      .fetchAll();

    return {
      status: "OK",
      response: resources,
    };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `${e}`,
        },
      ],
    };
  }
};

/**
 * New: weekly summary types + function
 */
export type WeeklySummary = {
  weekStartISO: string; // ISO string for Monday 00:00:00.000Z of the week
  weekEndISO: string; // ISO string for Sunday 23:59:59.999Z of the week
  uniqueUsers: number;
  conversations: number;
};

/**
 * Returns summaries for the last `weeksBack` weeks (including current week).
 * weeksBack default = 6 (changeable).
 *
 * Note: groups by UTC Monday→Sunday to keep week boundaries consistent across timezones.
 */
export const FindWeeklySummariesForAdmin = async (
  weeksBack = 6
): Promise<ServerActionResponse<Array<WeeklySummary>>> => {
  const user = await getCurrentUser();
  if (!user.isAdmin) {
    return {
      status: "ERROR",
      errors: [{ message: "You are not authorized to perform this action" }],
    };
  }

  try {
    // get current date in UTC, date-only (no time)
    const now = new Date();
    const utcNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // compute day-of-week with Monday=0, Sunday=6
    const dow = (utcNow.getUTCDay() + 6) % 7;
    const thisMonday = new Date(utcNow);
    thisMonday.setUTCDate(utcNow.getUTCDate() - dow);
    thisMonday.setUTCHours(0, 0, 0, 0);

    // earliestMonday for the requested window (weeksBack weeks including current)
    const earliestMonday = new Date(thisMonday);
    earliestMonday.setUTCDate(thisMonday.getUTCDate() - (weeksBack - 1) * 7);
    earliestMonday.setUTCHours(0, 0, 0, 0);

    // lastSunday (end of the current week)
    const lastSunday = new Date(thisMonday);
    lastSunday.setUTCDate(thisMonday.getUTCDate() + 6);
    lastSunday.setUTCHours(23, 59, 59, 999);

    const startISO = earliestMonday.toISOString();
    const endISO = lastSunday.toISOString();

    // Query threads in the window
    const querySpec: SqlQuerySpec = {
      query:
        "SELECT r.id, r.userId, r.userName, r.useName, r.user, r.createdAt FROM root r WHERE r.type=@type AND r.createdAt >= @start AND r.createdAt <= @end ORDER BY r.createdAt DESC",
      parameters: [
        { name: "@type", value: CHAT_THREAD_ATTRIBUTE },
        { name: "@start", value: startISO },
        { name: "@end", value: endISO },
      ],
    };

    const { resources } = await HistoryContainer()
      .items.query<any>(querySpec) // resources shape may vary; use any for flexible access
      .fetchAll();

    // group by monday (UTC) key
    const groups: Record<
      string,
      { users: Set<string>; conversations: number; weekStart: Date; weekEnd: Date }
    > = {};

    for (const r of resources) {
      if (!r || !r.createdAt) continue;
      const d = new Date(r.createdAt);
      // compute monday (UTC) for this date
      const dayIndex = (d.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      monday.setUTCDate(monday.getUTCDate() - dayIndex);
      monday.setUTCHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10); // yyyy-mm-dd

      if (!groups[key]) {
        const weekEnd = new Date(monday);
        weekEnd.setUTCDate(monday.getUTCDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);
        groups[key] = { users: new Set<string>(), conversations: 0, weekStart: monday, weekEnd };
      }

      groups[key].conversations++;

      // Add a user identifier to the set. Prefer userId, fallback to known alternatives.
      // Use permissive access (some items may have user object, or mis-typed fields).
      const candidateUserId =
        (r && (r.userId || r.userName || r.useName)) ||
        (r && r.user && (r.user.id || r.user.name)) ||
        null;

      if (candidateUserId) {
        groups[key].users.add(String(candidateUserId));
      } else {
        // If no user info available, you might want to count anonymous sessions uniquely;
        // For now: do not add (keeps uniqueUsers conservative).
      }
    }

    // Build contiguous results for each week (fill zeros for weeks without records)
    const results: WeeklySummary[] = [];
    for (let i = 0; i < weeksBack; i++) {
      const monday = new Date(earliestMonday);
      monday.setUTCDate(earliestMonday.getUTCDate() + i * 7);
      monday.setUTCHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);

      const weekStart = new Date(monday);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      if (groups[key]) {
        results.push({
          weekStartISO: groups[key].weekStart.toISOString(),
          weekEndISO: groups[key].weekEnd.toISOString(),
          uniqueUsers: groups[key].users.size,
          conversations: groups[key].conversations,
        });
      } else {
        results.push({
          weekStartISO: weekStart.toISOString(),
          weekEndISO: weekEnd.toISOString(),
          uniqueUsers: 0,
          conversations: 0,
        });
      }
    }

    // Return newest-first (reverse chronological)
    results.reverse();

    return { status: "OK", response: results };
  } catch (e) {
    return {
      status: "ERROR",
      errors: [{ message: `${e}` }],
    };
  }
};

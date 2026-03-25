import type { Persona } from "./personaEngine.js";

export type ContentTypeId =
  | "observation"
  | "hot_take"
  | "micro_story"
  | "community_question"
  | "list_post";

export interface ContentTypeTemplate {
  id: ContentTypeId;
  maxLengthX: number;
  maxLengthThreads: number;
  platformRestriction?: "threads_only";
}

export const CONTENT_TYPE_DEFS: Record<ContentTypeId, ContentTypeTemplate> = {
  observation: {
    id: "observation",
    maxLengthX: 280,
    maxLengthThreads: 500,
  },
  hot_take: {
    id: "hot_take",
    maxLengthX: 280,
    maxLengthThreads: 500,
  },
  micro_story: {
    id: "micro_story",
    maxLengthX: 280,
    maxLengthThreads: 500,
    platformRestriction: "threads_only",
  },
  community_question: {
    id: "community_question",
    maxLengthX: 280,
    maxLengthThreads: 500,
  },
  list_post: {
    id: "list_post",
    maxLengthX: 280,
    maxLengthThreads: 500,
  },
};

export function buildContentTypeInstruction(
  contentType: ContentTypeId,
  persona: Persona,
  brandAllowed: boolean
): string {
  const brandLine = brandAllowed
    ? `If it fits naturally, you may end with a light brand tag. If it does not fit, skip it.`
    : `Do NOT include any brand name or website in this post.`;

  switch (contentType) {
    case "observation":
      return `Write one sharp observation in 1-2 declarative sentences. No questions. Lead with tension, recognition, or an uncomfortable truth. ${brandLine}`;

    case "hot_take":
      return `Write one spicy opinion or hot take. Start with a strong declaration or "Hot take:" prefix. 1-2 sentences max. Make it something people would argue with, save, or send to a friend. ${brandLine}`;

    case "micro_story":
      return `Write a micro story in 3-4 sentences. Set a specific scene (time, place, detail), build a moment, land a punchline or recognition beat. Make the reader feel like they were there. ${brandLine}`;

    case "community_question":
      return `Write one observation (1 sentence) followed by one genuine question to the audience. The question should invite real answers, not rhetorical agreement. ${brandLine}`;

    case "list_post":
      return `Write a short comparison or list. "Two kinds of..." or "Three things..." format. Keep each line punchy. Total must be under the character limit. ${brandLine}`;

    default:
      return `Write one sharp post. ${brandLine}`;
  }
}

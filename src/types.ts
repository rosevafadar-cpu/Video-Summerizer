export interface Chapter {
  timestamp: string;
  title: string;
  summary: string;
}

export interface ProcessedResult {
  id: string; // unique ID to reference in history
  title: string;
  summary: string;
  cleanTranscript: string;
  chapters: Chapter[];
  source: "youtube" | "upload";
  videoId?: string;
  fileName?: string;
  date: string; // formatting date string for history
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export type ProcessingState = "idle" | "uploading" | "polling" | "synthesizing" | "completed" | "error";

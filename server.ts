import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { YoutubeTranscript } from "youtube-transcript";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not defined in the environment. Gemini calls will fail.");
}

const ai = new GoogleGenAI({
  apiKey: apiKey || "MOCK_KEY",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Helper: robust YouTube video ID extraction
function getYoutubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = trimmed.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// Helper: format seconds into MM:SS or HH:MM:SS
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Shared Response Schema for structured JSON
const transcriptionSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING, description: "Highly detailed markdown summary with Key Takeaways and Actionable Insights" },
    cleanTranscript: { type: Type.STRING, description: "Full cleaned-up, readable transcript with paragraphs and markdown headers" },
    chapters: {
      type: Type.ARRAY,
      description: "Chronological chapters or topics with timestamps",
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: "MM:SS or HH:MM:SS format" },
          title: { type: Type.STRING, description: "Short chapter title" },
          summary: { type: Type.STRING, description: "1-2 sentence description of what is covered" },
        },
        required: ["timestamp", "title", "summary"],
      },
    },
  },
  required: ["title", "summary", "cleanTranscript", "chapters"],
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use OS tmpdir for multer file uploads
  const upload = multer({ dest: os.tmpdir() });

  app.use(express.json({ limit: "50mb" }));

  // CORS middleware to allow automated fetching, external clients, and integrations (e.g. Claude)
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }
    next();
  });

  // API Route: Transcribe and summarize via YouTube URL
  app.post("/api/transcribe-youtube", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "YouTube URL is required." });
      }

      const videoId = getYoutubeId(url);
      if (!videoId) {
        return res.status(400).json({ error: "Invalid YouTube URL or Video ID." });
      }

      console.log(`Fetching YouTube captions for video ID: ${videoId}`);
      let rawTranscript = "";
      try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId);
        rawTranscript = segments
          .map((s) => `[${formatTimestamp(s.offset / 1000)}] ${s.text}`)
          .join("\n");
      } catch (err: any) {
        console.error("Failed to fetch YouTube captions:", err);
        return res.status(422).json({
          error: "Could not fetch automated captions for this YouTube video directly. This often happens if the video has captions disabled or YouTube is restricting scraper access. Try uploading an audio/video file of the video instead!",
        });
      }

      if (!rawTranscript.trim()) {
        return res.status(422).json({
          error: "This video has empty or unavailable captions. Please upload an audio or video file of the content instead.",
        });
      }

      console.log(`Sending transcript of ${rawTranscript.length} characters to Gemini for synthesis...`);
      const prompt = `You are an expert video editor, copywriter, and content synthesizer.
I will provide you with the raw, auto-generated transcript of a YouTube video, including timestamps.
Your task is to:
1. Clean up the transcript: Fix spelling, obvious typos, and speech errors or disfluencies (like "umm", "err", stuttering) without removing key technical jargon or subject material.
2. Segment the video: Divide the transcript into logical chapters/sections based on topics being discussed. Assign each section a clear title and its approximate starting timestamp.
3. Keep the transcript continuous: Do not summarize the transcript text itself; preserve the full discussion, but format it beautifully with clear paragraph breaks, headers, and clickable timestamps.
4. Generate an Executive Summary:
   - "Executive Overview": A 2-3 paragraph comprehensive summary.
   - "Key Takeaways": Bullet points detailing the most critical concepts, facts, or insights.
   - "Actionable Insights": Clear, practical next steps, recommendations, or resources mentioned.
   - "Quick Index": Table/list indexing key topics discussed.

Language & RTL Support Instructions:
- Auto-detect the spoken language of the video.
- If the video contains people talking in Persian (Farsi), you MUST write the entire JSON response (title, summary, cleanTranscript, chapters, etc.) in fluent, high-quality, native Persian (Farsi).
- For Persian language output, ensure flawless spelling, elegant phrasing, correct Persian characters (use "ی" and "ک" instead of Arabic equivalents), and proper punctuation.
- If the video contains people talking in English or another language, write the response in that spoken language.

Here is the raw transcript:
${rawTranscript}

Please return the results as a structured JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: transcriptionSchema,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response from Gemini API");
      }

      const structuredData = JSON.parse(responseText.trim());
      res.json({
        videoId,
        source: "youtube",
        ...structuredData,
      });
    } catch (error: any) {
      console.error("YouTube processing error:", error);
      res.status(500).json({ error: error.message || "An unexpected error occurred during processing." });
    }
  });

  // API Route: Transcribe and summarize via File Upload (Audio/Video)
  app.post("/api/upload-media", upload.single("file"), async (req, res) => {
    let tempFilePath: string | null = null;
    let geminiFileName: string | null = null;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No media file uploaded." });
      }

      tempFilePath = req.file.path;
      const mimeType = req.file.mimetype;
      const originalName = req.file.originalname;

      console.log(`Uploading file ${originalName} (${mimeType}) to Gemini Files API...`);

      // 1. Upload to Gemini Files API
      const uploadResult = await ai.files.upload({
        file: tempFilePath,
        config: {
          mimeType: mimeType,
        },
      });

      geminiFileName = uploadResult.name;
      console.log(`Uploaded file name on Gemini: ${geminiFileName}`);

      // Clean up local temp file as soon as it is in the cloud
      try {
        fs.unlinkSync(tempFilePath);
        tempFilePath = null;
      } catch (unlinkErr) {
        console.error("Failed to delete local temp file:", unlinkErr);
      }

      // 2. Poll file state until ACTIVE
      console.log("Waiting for Gemini to process the uploaded file...");
      let fileState = await ai.files.get({ name: geminiFileName });
      let attempts = 0;
      
      while (fileState.state === "PROCESSING" && attempts < 120) {
        // Wait 3 seconds
        await new Promise((resolve) => setTimeout(resolve, 3000));
        fileState = await ai.files.get({ name: geminiFileName });
        attempts++;
        console.log(`Polling file state: ${fileState.state} (attempt ${attempts})`);
      }

      if (fileState.state === "FAILED") {
        throw new Error("Gemini file processing failed. Please ensure the file format is supported.");
      }

      if (fileState.state !== "ACTIVE") {
        throw new Error("File processing timed out on Gemini's servers. Please try again with a shorter or smaller file.");
      }

      console.log("File is ACTIVE! Generating transcript and summary...");

      const prompt = `You are a professional audio/video transcriber and content synthesizer.
Please analyze the uploaded file. Your task is to:
1. Transcribe the entire content of the media file. Format it with clean paragraphs, logical section/chapter markers, and insert timestamps where topics shift.
2. Segment the content: Divide the transcript into clear, logical chapters/sections based on topics being discussed. Assign each section a clear title and its approximate starting timestamp.
3. Clean up spoken errors (like "umm", "err", stuttering) but preserve the technical terms and full substance of the content.
4. Generate an Executive Summary:
   - "Executive Overview": A 2-3 paragraph comprehensive summary.
   - "Key Takeaways": Bullet points detailing the most critical concepts, facts, or insights.
   - "Actionable Insights": Clear, practical next steps, recommendations, or resources mentioned.
   - "Quick Index": Table/list indexing key topics discussed.

Language & RTL Support Instructions:
- Auto-detect the spoken language of the audio or video.
- If the media contains people talking in Persian (Farsi), you MUST transcribe the content and generate the entire JSON response (title, summary, cleanTranscript, chapters, etc.) in fluent, high-quality, native Persian (Farsi).
- For Persian language output, ensure flawless spelling, elegant phrasing, correct Persian characters (use "ی" and "ک" instead of Arabic equivalents), and proper punctuation.
- If the media is in English or another language, transcribe and summarize in that spoken language.

Please return the results as a structured JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            fileData: {
              fileUri: fileState.uri,
              mimeType: fileState.mimeType,
            },
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: transcriptionSchema,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response from Gemini API");
      }

      // Clean up file from Gemini to release storage space
      try {
        await ai.files.delete({ name: geminiFileName });
        geminiFileName = null;
      } catch (deleteErr) {
        console.error("Error deleting file from Gemini storage:", deleteErr);
      }

      const structuredData = JSON.parse(responseText.trim());
      res.json({
        source: "upload",
        fileName: originalName,
        ...structuredData,
      });

    } catch (error: any) {
      console.error("Media upload processing error:", error);
      
      // Attempt cleanups
      if (tempFilePath) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      if (geminiFileName) {
        try { await ai.files.delete({ name: geminiFileName }); } catch (e) {}
      }

      res.status(500).json({ error: error.message || "An unexpected error occurred during processing." });
    }
  });

  // API Route: Handle chunked file uploads to bypass proxy request payload limits
  app.post("/api/upload-media-chunk", upload.single("chunk"), async (req, res) => {
    let tempFilePath: string | null = null;
    let geminiFileName: string | null = null;

    try {
      const { uploadId, chunkIndex, totalChunks, fileName, mimeType } = req.body;
      
      if (!req.file) {
        return res.status(400).json({ error: "No chunk file received." });
      }
      if (!uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        return res.status(400).json({ error: "Missing required chunk upload parameters." });
      }

      const chunkDir = path.join(os.tmpdir(), "video_summarizer_chunks", uploadId);
      fs.mkdirSync(chunkDir, { recursive: true });
      const chunkPath = path.join(chunkDir, chunkIndex.toString());

      // Move multer's temp file to our chunk directory
      fs.renameSync(req.file.path, chunkPath);

      // Check if all chunks have been received
      const existingChunks = fs.readdirSync(chunkDir);
      const totalNumChunks = parseInt(totalChunks, 10);

      // If we don't have all chunks yet, return success for this chunk
      if (existingChunks.length < totalNumChunks) {
        return res.json({ status: "chunk_received", chunkIndex: parseInt(chunkIndex, 10), totalChunks: totalNumChunks });
      }

      // Double-check all chunk files exist in sequence to ensure completeness
      for (let i = 0; i < totalNumChunks; i++) {
        if (!fs.existsSync(path.join(chunkDir, i.toString()))) {
          return res.json({ status: "chunk_received", chunkIndex: parseInt(chunkIndex, 10), totalChunks: totalNumChunks });
        }
      }

      // All chunks are present! Merge them.
      console.log(`All ${totalNumChunks} chunks received. Merging...`);
      const mergedFilePath = path.join(os.tmpdir(), `merged_${uploadId}_${fileName}`);
      tempFilePath = mergedFilePath;

      const mergeChunks = (dir: string, total: number, mergedPath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(mergedPath);
          let currentChunk = 0;

          function appendNext() {
            if (currentChunk >= total) {
              writeStream.end();
              return;
            }
            const itemPath = path.join(dir, currentChunk.toString());
            const readStream = fs.createReadStream(itemPath);
            readStream.pipe(writeStream, { end: false });
            readStream.on("end", () => {
              currentChunk++;
              appendNext();
            });
            readStream.on("error", (err) => {
              writeStream.destroy();
              reject(err);
            });
          }

          writeStream.on("finish", () => {
            resolve();
          });
          writeStream.on("error", (err) => {
            reject(err);
          });

          appendNext();
        });
      };

      await mergeChunks(chunkDir, totalNumChunks, mergedFilePath);

      // Clean up chunk files directory
      try {
        const files = fs.readdirSync(chunkDir);
        for (const file of files) {
          fs.unlinkSync(path.join(chunkDir, file));
        }
        fs.rmdirSync(chunkDir);
      } catch (rmErr) {
        console.error("Failed to clean up chunk directory:", rmErr);
      }

      console.log(`Merged file successfully! Uploading to Gemini Files API...`);

      // Upload to Gemini Files API
      const uploadResult = await ai.files.upload({
        file: mergedFilePath,
        config: {
          mimeType: mimeType || "video/mp4",
        },
      });

      geminiFileName = uploadResult.name;
      console.log(`Uploaded file name on Gemini: ${geminiFileName}`);

      // Clean up local merged temp file as soon as it is uploaded
      try {
        fs.unlinkSync(mergedFilePath);
        tempFilePath = null;
      } catch (unlinkErr) {
        console.error("Failed to delete merged temp file:", unlinkErr);
      }

      // Wait for Gemini to process the uploaded file (ACTIVE)
      console.log("Waiting for Gemini to process the uploaded file...");
      let fileState = await ai.files.get({ name: geminiFileName });
      let attempts = 0;
      
      while (fileState.state === "PROCESSING" && attempts < 120) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        fileState = await ai.files.get({ name: geminiFileName });
        attempts++;
        console.log(`Polling file state: ${fileState.state} (attempt ${attempts})`);
      }

      if (fileState.state === "FAILED") {
        throw new Error("Gemini file processing failed. Please ensure the file format is supported.");
      }

      if (fileState.state !== "ACTIVE") {
        throw new Error("File processing timed out on Gemini's servers. Please try again with a shorter or smaller file.");
      }

      console.log("File is ACTIVE on Gemini! Generating transcript and summary...");

      const prompt = `You are a professional audio/video transcriber and content synthesizer.
Please analyze the uploaded file. Your task is to:
1. Transcribe the entire content of the media file. Format it with clean paragraphs, logical section/chapter markers, and insert timestamps where topics shift.
2. Segment the content: Divide the transcript into clear, logical chapters/sections based on topics being discussed. Assign each section a clear title and its approximate starting timestamp.
3. Clean up spoken errors (like "umm", "err", stuttering) but preserve the technical terms and full substance of the content.
4. Generate an Executive Summary:
   - "Executive Overview": A 2-3 paragraph comprehensive summary.
   - "Key Takeaways": Bullet points detailing the most critical concepts, facts, or insights.
   - "Actionable Insights": Clear, practical next steps, recommendations, or resources mentioned.
   - "Quick Index": Table/list indexing key topics discussed.

Language & RTL Support Instructions:
- Auto-detect the spoken language of the audio or video.
- If the media contains people talking in Persian (Farsi), you MUST transcribe the content and generate the entire JSON response (title, summary, cleanTranscript, chapters, etc.) in fluent, high-quality, native Persian (Farsi).
- For Persian language output, ensure flawless spelling, elegant phrasing, correct Persian characters (use "ی" and "ک" instead of Arabic equivalents), and proper punctuation.
- If the media is in English or another language, transcribe and summarize in that spoken language.

Please return the results as a structured JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            fileData: {
              fileUri: fileState.uri,
              mimeType: fileState.mimeType,
            },
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: transcriptionSchema,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response from Gemini API");
      }

      // Clean up file from Gemini to release storage space
      try {
        await ai.files.delete({ name: geminiFileName });
        geminiFileName = null;
      } catch (deleteErr) {
        console.error("Error deleting file from Gemini storage:", deleteErr);
      }

      const structuredData = JSON.parse(responseText.trim());
      res.json({
        source: "upload",
        fileName: fileName,
        ...structuredData,
      });

    } catch (error: any) {
      console.error("Media chunk upload processing error:", error);
      if (tempFilePath) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      if (geminiFileName) {
        try { await ai.files.delete({ name: geminiFileName }); } catch (e) {}
      }
      res.status(500).json({ error: error.message || "An unexpected error occurred during processing." });
    }
  });

  // API Route: Chat with Video Transcript (Interactive Q&A)
  app.post("/api/chat-video", async (req, res) => {
    try {
      const { transcript, messages } = req.body;
      if (!transcript) {
        return res.status(400).json({ error: "Transcript context is required." });
      }
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Chat messages are required." });
      }

      console.log(`Answering user question using transcript context (${transcript.length} chars)...`);

      // Format chat history for Gemini API
      // Since it is a quick QA, we can pass the transcript inside the system instruction or as a preceding user message.
      const lastMessage = messages[messages.length - 1].content;
      
      // Let's create a conversational prompt containing the history and transcript
      const systemInstruction = `You are a helpful, expert video assistant. You are analyzing a video's full transcript.
Your goal is to answer the user's questions based strictly on the provided transcript.
- Quote directly or refer to timestamps when helpful.
- If the answer cannot be found in the transcript, state: "I'm sorry, but that topic is not discussed in the video transcript." (Or the equivalent in Persian if asked in Persian).
- Do not make up facts or bring in external knowledge unless it is directly requested and you clearly mark it as "Not mentioned in the video, but...".
- Respond in the same language as the user's question. If the user asks their question in Persian (Farsi), you MUST reply in fluent, high-quality Persian (Farsi).

Below is the full transcript of the video:
---
${transcript}
---`;

      // We can use simple text generation or chat
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: lastMessage,
        config: {
          systemInstruction: systemInstruction,
        },
      });

      res.json({
        content: response.text || "I was unable to formulate a response.",
      });

    } catch (error: any) {
      console.error("Chat video error:", error);
      res.status(500).json({ error: error.message || "An unexpected error occurred during Q&A." });
    }
  });

  // Vite Integration for Client Dev & Production Assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve HTML
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});

import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  AlignLeft,
  PlayCircle,
  MessageSquare,
  Upload,
  Link,
  History,
  Youtube,
  Trash2,
  Search,
  Copy,
  Check,
  Download,
  Send,
  AlertCircle,
  ArrowRight,
  Video,
  FileAudio,
  FileVideo,
  Loader2,
  ChevronRight,
  ExternalLink,
  FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { Chapter, ProcessedResult, ChatMessage, ProcessingState } from "./types";

export default function App() {
  // Navigation & UI States
  const [activeTab, setActiveTab] = useState<"summary" | "transcript" | "chapters" | "chat">("summary");
  const [inputTab, setInputTab] = useState<"youtube" | "upload">("youtube");
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Input States
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileObjectUrl, setFileObjectUrl] = useState<string | null>(null);

  // Processing States
  const [processingState, setProcessingState] = useState<ProcessingState>("idle");
  const [processingMessage, setProcessingMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Results & History
  const [activeResult, setActiveResult] = useState<ProcessedResult | null>(null);
  const [history, setHistory] = useState<ProcessedResult[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  // Chat Q&A States
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  // Refs for audio/video playback controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Active YouTube video seek state
  const [youtubeStartTime, setYoutubeStartTime] = useState<number>(0);

  // Load history from local storage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem("video_summarizer_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Auto scroll chat to bottom when message arrives
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatLoading]);

  // Save history helper
  const saveHistory = (newHistory: ProcessedResult[]) => {
    setHistory(newHistory);
    localStorage.setItem("video_summarizer_history", JSON.stringify(newHistory));
  };

  // Helper to extract YouTube video ID
  const getYoutubeId = (url: string): string | null => {
    if (!url) return null;
    const trimmed = url.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = trimmed.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  // Helper to convert timestamp string (MM:SS, HH:MM:SS) to total seconds
  const timestampToSeconds = (timestamp: string): number => {
    const parts = timestamp.replace(/[\[\]]/g, "").split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  };

  // Click on a timestamp seeks local player or YouTube embed
  const handleTimestampClick = (timestamp: string) => {
    const seconds = timestampToSeconds(timestamp);
    if (activeResult?.source === "youtube") {
      setYoutubeStartTime(seconds);
    } else if (selectedFile?.type.startsWith("video/") && videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch((e) => console.log("Auto play prevented", e));
    } else if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      audioRef.current.play().catch((e) => console.log("Auto play prevented", e));
    }
  };

  // Handle Drag-and-drop file inputs
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    if (!isVideo && !isAudio) {
      setErrorMessage("Unsupported file type. Please upload an audio track (MP3/WAV/M4A) or video (MP4/WebM) file.");
      setSelectedFile(null);
      return;
    }

    // Guard file upload size (500MB limit) to prevent browser/network timeouts on extremely large files
    const MAX_SIZE_MB = 500;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    if (file.size > MAX_SIZE_BYTES) {
      setErrorMessage(
        `The file "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). To ensure stable upload speed and avoid memory limits, please keep uploads under ${MAX_SIZE_MB}MB. For longer videos, try converting the audio to an MP3 or M4A file first, or provide a YouTube link!`
      );
      setSelectedFile(null);
      if (fileObjectUrl) {
        URL.revokeObjectURL(fileObjectUrl);
        setFileObjectUrl("");
      }
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);

    // Create local object URL for in-app browser playback
    if (fileObjectUrl) {
      URL.revokeObjectURL(fileObjectUrl);
    }
    setFileObjectUrl(URL.createObjectURL(file));
  };

  // Submission handles:
  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const videoId = getYoutubeId(youtubeUrl);
    if (!videoId) {
      setErrorMessage("Please enter a valid YouTube video link or ID.");
      return;
    }

    setErrorMessage(null);
    setProcessingState("uploading");
    setProcessingMessage("Connecting to YouTube and scraping raw subtitles...");

    try {
      const response = await fetch("/api/transcribe-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl }),
      });

      if (!response.ok) {
        let errMsg = "Failed to process YouTube transcript.";
        if (response.status === 413) {
          errMsg = "The request payload is too large. Please shorten the transcript length or choose a smaller input.";
        } else {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            try {
              const errorData = await response.json();
              errMsg = errorData.error || errMsg;
            } catch (jsonErr) {
              errMsg = "Server returned an invalid JSON response.";
            }
          } else {
            try {
              const text = await response.text();
              errMsg = `Server Error (${response.status}): ${text.slice(0, 150)}`;
            } catch (textErr) {
              errMsg = `Server returned status ${response.status}`;
            }
          }
        }
        throw new Error(errMsg);
      }

      setProcessingState("synthesizing");
      setProcessingMessage("Synthesizing transcript structure & drafting executive summary...");

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        throw new Error("Failed to parse a valid JSON response from the server.");
      }

      const newResult: ProcessedResult = {
        id: `yt-${videoId}-${Date.now()}`,
        title: data.title || "YouTube Video Analysis",
        summary: data.summary,
        cleanTranscript: data.cleanTranscript,
        chapters: data.chapters || [],
        source: "youtube",
        videoId: videoId,
        date: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      // Set active
      setActiveResult(newResult);
      // Reset chatbot
      setChatMessages([
        {
          role: "model",
          content: `Hi! I have fully processed the video **"${newResult.title}"**. Feel free to ask me anything about the content, specific topics, or lessons mentioned!`,
        },
      ]);
      // Save to history
      saveHistory([newResult, ...history]);
      setProcessingState("completed");
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "An error occurred while transcribing.");
      setProcessingState("error");
    }
  };

  const handleFileUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage("Please select a file to upload.");
      return;
    }

    setErrorMessage(null);
    setProcessingState("uploading");

    const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunk size to ensure each request stays far below any proxy limits
    const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    try {
      let finalData = null;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(selectedFile.size, start + CHUNK_SIZE);
        const chunkBlob = selectedFile.slice(start, end);

        const formData = new FormData();
        formData.append("chunk", chunkBlob);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", chunkIndex.toString());
        formData.append("totalChunks", totalChunks.toString());
        formData.append("fileName", selectedFile.name);
        formData.append("mimeType", selectedFile.type);

        const percent = Math.round((chunkIndex / totalChunks) * 100);
        setProcessingMessage(`Uploading "${selectedFile.name}"... Part ${chunkIndex + 1} of ${totalChunks} (${percent}% complete)`);

        if (chunkIndex === totalChunks - 1) {
          setProcessingMessage(`Uploading final part of "${selectedFile.name}" and initializing Gemini content analysis...`);
        }

        const response = await fetch("/api/upload-media-chunk", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          let errMsg = "Failed to upload and transcribe media.";
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            try {
              const errorData = await response.json();
              errMsg = errorData.error || errMsg;
            } catch (jsonErr) {
              errMsg = "Server returned an invalid JSON response.";
            }
          } else {
            try {
              const text = await response.text();
              errMsg = `Server Error (${response.status}): ${text.slice(0, 150)}`;
            } catch (textErr) {
              errMsg = `Server returned status ${response.status}`;
            }
          }
          throw new Error(errMsg);
        }

        const data = await response.json();
        if (chunkIndex === totalChunks - 1) {
          finalData = data;
        }
      }

      if (!finalData) {
        throw new Error("Upload completed, but no analysis response was received.");
      }

      setProcessingState("synthesizing");
      setProcessingMessage("Finalizing transcription, timeline index, and summaries...");

      const newResult: ProcessedResult = {
        id: `upload-${Date.now()}`,
        title: finalData.title || selectedFile.name,
        summary: finalData.summary,
        cleanTranscript: finalData.cleanTranscript,
        chapters: finalData.chapters || [],
        source: "upload",
        fileName: selectedFile.name,
        date: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      // Set active
      setActiveResult(newResult);
      // Reset chatbot
      setChatMessages([
        {
          role: "model",
          content: `Hi! I have fully transcribed the uploaded file **"${newResult.title}"**. Ask me anything about the content, or seek specific quotes!`,
        },
      ]);
      // Save to history
      saveHistory([newResult, ...history]);
      setProcessingState("completed");
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "An error occurred while uploading and transcribing.");
      setProcessingState("error");
    }
  };

  // Load a historic item
  const loadHistoryItem = (item: ProcessedResult) => {
    setActiveResult(item);
    setErrorMessage(null);
    setProcessingState("completed");
    setActiveTab("summary");
    setChatMessages([
      {
        role: "model",
        content: `Hi! I have reloaded the transcript for **"${item.title}"**. What would you like to know about it?`,
      },
    ]);
    // Clear ObjectURL since we reloaded a history item (or if it matches, keep it but let's reset to keep it simple)
    if (item.source === "youtube" && item.videoId) {
      setYoutubeUrl(item.videoId);
      setYoutubeStartTime(0);
    } else {
      setYoutubeUrl("");
    }
  };

  // Delete a historic item
  const deleteHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const filtered = history.filter((item) => item.id !== id);
    saveHistory(filtered);
    if (activeResult?.id === id) {
      setActiveResult(null);
      setProcessingState("idle");
    }
  };

  // Handle Q&A Chat bot
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading || !activeResult) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsChatLoading(true);

    try {
      const response = await fetch("/api/chat-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: activeResult.cleanTranscript,
          messages: [...chatMessages, { role: "user", content: userMsg }],
        }),
      });

      if (!response.ok) {
        let errMsg = "Unable to fetch Q&A answer.";
        if (response.status === 413) {
          errMsg = "The chat request is too large for the server. Try asking a shorter or more specific question.";
        } else {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            try {
              const errorData = await response.json();
              errMsg = errorData.error || errMsg;
            } catch (jsonErr) {
              errMsg = "Server returned an invalid JSON response.";
            }
          } else {
            try {
              const text = await response.text();
              errMsg = `Server Error (${response.status}): ${text.slice(0, 150)}`;
            } catch (textErr) {
              errMsg = `Server returned status ${response.status}`;
            }
          }
        }
        throw new Error(errMsg);
      }

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        throw new Error("Failed to parse a valid JSON response from the server.");
      }
      setChatMessages((prev) => [...prev, { role: "model", content: data.content }]);
    } catch (err) {
      console.error(err);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "model",
          content: "Sorry, I ran into an error while analyzing that question. Please try asking again.",
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Utility to search/highlight matches in the transcript text
  const getHighlightedText = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight})`, "gi"));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={i} className="bg-orange-500/25 text-orange-300 font-semibold px-0.5 rounded">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  // Copy transcript to clipboard
  const handleCopyTranscript = () => {
    if (!activeResult) return;
    navigator.clipboard.writeText(activeResult.cleanTranscript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download transcript as text file
  const handleDownloadTranscript = () => {
    if (!activeResult) return;
    const element = document.createElement("a");
    const file = new Blob([activeResult.cleanTranscript], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `${activeResult.title.replace(/\s+/g, "_")}_transcript.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Convert basic markdown to clean, styled HTML for printable PDF
  const convertMarkdownToHtml = (markdown: string): string => {
    if (!markdown) return "";
    let html = markdown;
    
    // Replace code blocks
    html = html.replace(/```([\s\S]*?)```/g, '<pre style="background: #f4f4f5; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 11px; white-space: pre-wrap; border: 1px solid #e4e4e7; margin: 12px 0;">$1</pre>');
    
    // Replace bold and italics
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Replace headers
    html = html.replace(/^### (.*?)$/gm, '<h3 style="font-size: 15px; font-weight: 700; color: #111827; margin-top: 18px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2 style="font-size: 17px; font-weight: 700; color: #111827; margin-top: 22px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1 style="font-size: 20px; font-weight: 800; color: #111827; margin-top: 26px; margin-bottom: 12px;">$1</h1>');
    
    // Replace blockquotes
    html = html.replace(/^> (.*?)$/gm, '<blockquote style="border-left: 4px solid #ea580c; padding-left: 12px; margin: 12px 0; color: #4b5563; font-style: italic;">$1</blockquote>');
    
    // Replace bullet lists and numbered lists
    html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li style="margin-bottom: 6px; list-style-type: disc;">$1</li>');
    html = html.replace(/^\s*\d+\.\s+(.*?)$/gm, '<li style="margin-bottom: 6px; list-style-type: decimal;">$1</li>');

    // Group adjacent list items into clean ul/ol wrappers
    html = html.replace(/(<li style="margin-bottom: 6px; list-style-type: disc;">.*?<\/li>)/gs, '<ul style="padding-left: 20px; margin: 10px 0;">$1</ul>');
    html = html.replace(/<\/ul>\s*<ul style="padding-left: 20px; margin: 10px 0;">/g, "");

    html = html.replace(/(<li style="margin-bottom: 6px; list-style-type: decimal;">.*?<\/li>)/gs, '<ol style="padding-left: 20px; margin: 10px 0;">$1</ol>');
    html = html.replace(/<\/ol>\s*<ol style="padding-left: 20px; margin: 10px 0;">/g, "");

    // Split remaining elements and wrap paragraphs
    const lines = html.split(/\n\s*\n/);
    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<h") || trimmed.startsWith("<ul") || trimmed.startsWith("<ol") || trimmed.startsWith("<blockquote") || trimmed.startsWith("<pre")) {
        return trimmed;
      }
      return `<p style="margin-bottom: 12px; line-height: 1.6; color: #374151;">${trimmed}</p>`;
    });
    
    return processedLines.join("\n");
  };

  // Helper to construct iframe print layout and call browser print-to-PDF
  const printHtmlContent = (docTitle: string, docSubtitle: string, bodyHtml: string) => {
    const isRtl = /[\u0600-\u06FF]/.test(bodyHtml || "") || /[\u0600-\u06FF]/.test(docTitle || "");
    const direction = isRtl ? "rtl" : "ltr";
    const textAlignment = isRtl ? "right" : "left";

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="${direction}">
      <head>
        <meta charset="utf-8">
        <title>${docTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Vazirmatn:wght@400;500;700&display=swap');
          
          body {
            font-family: 'Vazirmatn', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #1f2937;
            line-height: 1.6;
            margin: 0;
            padding: 40px;
            background-color: #ffffff;
            font-size: 14px;
            text-align: ${textAlignment};
          }
          
          .header {
            border-bottom: 2px solid #ea580c;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          
          .app-title {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #ea580c;
            margin: 0 0 8px 0;
          }
          
          .doc-title {
            font-size: 22px;
            font-weight: 700;
            margin: 0 0 8px 0;
            color: #111827;
          }
          
          .doc-subtitle {
            font-size: 12px;
            color: #6b7280;
            margin: 0;
            font-weight: 500;
          }
          
          .content {
            margin-bottom: 40px;
          }
          
          h1, h2, h3, h4 {
            color: #111827;
            margin-top: 24px;
            margin-bottom: 12px;
            font-weight: 700;
          }
          
          h1 { font-size: 18px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          h2 { font-size: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
          h3 { font-size: 14px; }
          
          p {
            margin-top: 0;
            margin-bottom: 14px;
            color: #374151;
          }
          
          ul, ol {
            margin-top: 0;
            margin-bottom: 16px;
            padding-left: ${isRtl ? "0" : "24px"};
            padding-right: ${isRtl ? "24px" : "0"};
          }
          
          li {
            margin-bottom: 6px;
          }
          
          blockquote {
            border-left: ${isRtl ? "none" : "4px solid #ea580c"};
            border-right: ${isRtl ? "4px solid #ea580c" : "none"};
            padding-left: ${isRtl ? "0" : "16px"};
            padding-right: ${isRtl ? "16px" : "0"};
            margin: 16px 0;
            color: #4b5563;
            font-style: italic;
          }
          
          pre, code {
            font-family: monospace;
            background-color: #f3f4f6;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }
          
          pre {
            padding: 12px;
            white-space: pre-wrap;
            border: 1px solid #e5e7eb;
            margin: 16px 0;
          }
          
          .timestamp {
            font-family: monospace;
            font-weight: bold;
            color: #ea580c;
            background-color: #ffedd5;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            display: inline-block;
            margin-right: ${isRtl ? "0" : "6px"};
            margin-left: ${isRtl ? "6px" : "0"};
            direction: ltr;
          }
          
          .transcript-paragraph {
            margin-bottom: 16px;
            line-height: 1.7;
          }
          
          .footer {
            border-top: 1px solid #e5e7eb;
            padding-top: 15px;
            margin-top: 40px;
            font-size: 11px;
            color: #9ca3af;
            text-align: center;
          }
          
          @media print {
            body {
              padding: 0;
            }
            @page {
              size: A4;
              margin: 20mm;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <p class="app-title">Smart Video & Audio Summarizer</p>
          <h1 class="doc-title">${docTitle}</h1>
          <p class="doc-subtitle">${docSubtitle}</p>
        </div>
        
        <div class="content">
          ${bodyHtml}
        </div>
        
        <div class="footer">
          Generated automatically by Smart Video & Audio Summarizer on ${new Date().toLocaleDateString()}
        </div>
      </body>
      </html>
    `;

    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 500);
  };

  const handleDownloadSummaryPDF = () => {
    if (!activeResult) return;
    const parsedHtml = convertMarkdownToHtml(activeResult.summary);
    const subtitle = `Executive Summary & Index • Media: ${activeResult.fileName || "YouTube"} • Date: ${activeResult.date}`;
    printHtmlContent(activeResult.title, subtitle, parsedHtml);
  };

  const handleDownloadTranscriptPDF = () => {
    if (!activeResult) return;
    const paragraphs = activeResult.cleanTranscript.split(/\n\s*\n/);
    const timestampRegex = /(\[?\d{1,2}:\d{2}(?::\d{2})?\]?)/g;
    
    const formattedHtml = paragraphs.map((para) => {
      const parts = para.split(timestampRegex);
      const paraContent = parts.map((part) => {
        const isTimestamp = timestampRegex.test(part);
        if (isTimestamp) {
          const cleanTs = part.replace(/[\[\]]/g, "");
          return `<span class="timestamp">${cleanTs}</span>`;
        }
        return part;
      }).join("");
      
      return `<p class="transcript-paragraph">${paraContent}</p>`;
    }).join("");
    
    const subtitle = `Full Transcript • Media: ${activeResult.fileName || "YouTube"} • Date: ${activeResult.date}`;
    printHtmlContent(activeResult.title, subtitle, formattedHtml);
  };

  // Clean prompt examples to paste immediately
  const handleApplyExample = (url: string) => {
    setYoutubeUrl(url);
    setInputTab("youtube");
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] font-sans text-white/80 antialiased flex flex-col selection:bg-orange-500/20 selection:text-orange-300" id="app-root">
      {/* Top Header */}
      <header className="bg-[#0A0A0B] border-b border-white/10 sticky top-0 z-40" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <h1 className="font-display font-medium text-lg text-white tracking-tight">
                Video Summarizer & Transcriber
              </h1>
              <p className="text-xs text-white/40">Powered by Gemini Multimodal AI</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400/75 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
            <span className="text-xs text-white/40 font-medium font-mono">Gemini-3.5-Flash Online</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 w-full" id="main-content">
        
        {/* Left Side: Setup & Files & History */}
        <section className="lg:col-span-5 flex flex-col gap-6" id="control-panel">
          
          {/* Main Transcribe Setup Card */}
          <div className="bg-[#121214] border border-white/10 rounded-xl p-6 flex flex-col gap-5">
            <div>
              <h2 className="font-display font-medium text-white text-base">Setup Source</h2>
              <p className="text-xs text-white/40 mt-1">Provide a long-form video link or upload an audio/video file directly.</p>
            </div>

            {/* Input Selection Tabs */}
            <div className="flex bg-white/5 p-1 rounded-lg border border-white/5">
              <button
                id="tab-youtube"
                onClick={() => {
                  setInputTab("youtube");
                  setErrorMessage(null);
                }}
                className={`flex-1 flex items-center justify-center gap-2 text-xs font-semibold py-2.5 rounded-md transition-all ${
                  inputTab === "youtube"
                    ? "bg-white/10 text-orange-400"
                    : "text-white/40 hover:text-white/80"
                }`}
              >
                <Youtube className="h-3.5 w-3.5" />
                YouTube URL
              </button>
              <button
                id="tab-upload"
                onClick={() => {
                  setInputTab("upload");
                  setErrorMessage(null);
                }}
                className={`flex-1 flex-center items-center justify-center gap-2 text-xs font-semibold py-2.5 rounded-md transition-all ${
                  inputTab === "upload"
                    ? "bg-white/10 text-orange-400"
                    : "text-white/40 hover:text-white/80"
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload File
              </button>
            </div>

            {/* Error Message banner */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 flex gap-2.5 items-start text-xs text-rose-400 font-medium"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* YouTube link Submission Form */}
            {inputTab === "youtube" && (
              <form onSubmit={handleYoutubeSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-white/60" htmlFor="yt-url-input">YouTube Link</label>
                  <div className="relative">
                    <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <input
                      id="yt-url-input"
                      type="text"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      disabled={processingState === "uploading" || processingState === "synthesizing"}
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500 focus:bg-white/5 transition-all disabled:opacity-60"
                    />
                  </div>
                </div>

                <button
                  id="btn-process-youtube"
                  type="submit"
                  disabled={processingState === "uploading" || processingState === "synthesizing" || !youtubeUrl.trim()}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-white/5 disabled:text-white/20 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                >
                  {processingState === "uploading" || processingState === "synthesizing" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Transcribe & Summarize Video
                    </>
                  )}
                </button>
              </form>
            )}

            {/* File Upload Dropzone Form */}
            {inputTab === "upload" && (
              <form onSubmit={handleFileUploadSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-white/60" htmlFor="file-upload-input">Media File</label>
                  
                  <div
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 cursor-pointer transition-all ${
                      dragActive
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      id="file-upload-input"
                      type="file"
                      accept="audio/*,video/*"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={processingState === "uploading" || processingState === "synthesizing"}
                    />
                    
                    <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-400 border border-orange-500/20">
                      <Upload className="h-5 w-5" />
                    </div>

                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-semibold text-white/80">
                        {selectedFile ? selectedFile.name : "Click to browse or drag file here"}
                      </p>
                      <p className="text-[10px] text-white/40">
                        {selectedFile
                           ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                          : "Supports MP3, WAV, M4A, MP4, WebM (up to 200MB)"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-3 text-[10px] text-orange-300 leading-relaxed font-medium flex gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-white block mb-0.5">Quick Pro-Tip</span>
                    For very long presentations or lectures, extracting and uploading the **audio file (MP3/M4A)** is much faster and produces identical results!
                  </div>
                </div>

                <button
                  id="btn-process-upload"
                  type="submit"
                  disabled={processingState === "uploading" || processingState === "synthesizing" || !selectedFile}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-white/5 disabled:text-white/20 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                >
                  {processingState === "uploading" || processingState === "synthesizing" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing Media File...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Upload & Transcribe File
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Loading steps state indicator */}
          <AnimatePresence>
            {(processingState === "uploading" || processingState === "synthesizing") && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="bg-[#121214] border border-white/10 rounded-xl p-6 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Processing Stream</span>
                  <Loader2 className="h-4 w-4 text-orange-400 animate-spin" />
                </div>
                
                <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      processingState === "uploading" ? "bg-orange-400/50 w-1/2" : "bg-orange-500 w-11/12"
                    }`}
                  ></div>
                </div>

                <div className="flex gap-3 items-start">
                  <div className="h-5 w-5 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {processingState === "uploading" ? "1" : "2"}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/80">{processingMessage}</p>
                    <p className="text-[10px] text-white/40 mt-1 leading-normal">
                      Gemini models read raw video/audio tracks directly. For long videos, processing is complex and takes roughly 30–60 seconds.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History / Previous transcripts */}
          <div className="bg-[#121214] border border-white/10 rounded-xl p-6 flex-1 flex flex-col gap-4 min-h-[300px]">
            <div>
              <h2 className="font-display font-medium text-white text-base flex items-center gap-2">
                <History className="h-4 w-4 text-white/40" />
                Transcription History
              </h2>
              <p className="text-xs text-white/40 mt-1">Quickly access previously indexed videos on this browser.</p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[420px] flex flex-col gap-2.5">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center h-full gap-2 text-white/40 py-12">
                  <div className="h-10 w-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <History className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-white/80">No saved videos found</p>
                  <p className="text-[10px] max-w-[200px]">Transcripts you process will appear here for immediate access.</p>
                </div>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    className={`group border rounded-xl p-3 flex items-start gap-3 text-left cursor-pointer transition-all ${
                      activeResult?.id === item.id
                        ? "border-orange-500/30 bg-orange-500/5"
                        : "border-white/10 hover:border-white/20 hover:bg-white/5"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {item.source === "youtube" ? (
                        <div className="h-7 w-7 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center">
                          <Youtube className="h-4 w-4" />
                        </div>
                      ) : (
                        <div className="h-7 w-7 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center">
                          <Video className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/80 line-clamp-1 group-hover:text-orange-400 transition-colors">
                        {item.title}
                      </p>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-white/40 font-medium">
                        <span>{item.date}</span>
                        <span className="capitalize font-semibold">{item.source}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => deleteHistoryItem(e, item.id)}
                      className="p-1 hover:bg-rose-500/15 hover:text-rose-400 text-white/40 rounded-md transition-all self-center md:opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Side: Visualizers, Embed Player & Results Display */}
        <section className="lg:col-span-7 flex flex-col gap-6" id="output-panel">
          
          {/* Active Result View */}
          {activeResult ? (
            <div className="flex flex-col gap-6">
              
              {/* Heading Summary & Media Source player */}
              <div className="bg-[#121214] border border-white/10 rounded-xl overflow-hidden">
                
                {/* Media Container top */}
                {activeResult.source === "youtube" && activeResult.videoId && (
                  <div className="aspect-video w-full bg-[#0A0A0B] border-b border-white/10">
                    <iframe
                      id="youtube-player"
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${activeResult.videoId}?start=${youtubeStartTime}&autoplay=1`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      className="w-full h-full"
                    ></iframe>
                  </div>
                )}

                {activeResult.source === "upload" && fileObjectUrl && (
                  <div className="w-full bg-[#0A0A0B] px-4 py-6 border-b border-white/10 flex flex-col items-center justify-center gap-3">
                    {/* Media icon or video feed depending on type */}
                    {selectedFile?.type.startsWith("video/") ? (
                      <div className="w-full max-w-md aspect-video bg-black rounded-lg overflow-hidden">
                        <video
                          ref={videoRef}
                          src={fileObjectUrl}
                          controls
                          className="w-full h-full"
                        ></video>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 bg-[#0A0A0B] rounded-xl px-4 py-3 w-full max-w-md border border-white/5">
                        <FileAudio className="h-8 w-8 text-orange-400 shrink-0" />
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-xs font-semibold text-white/80 truncate">{selectedFile?.name}</p>
                          <p className="text-[10px] text-white/40 font-mono">Jump to timestamps to seek player</p>
                        </div>
                        <audio
                          ref={audioRef}
                          src={fileObjectUrl}
                          controls
                          className="max-h-8 w-44"
                        ></audio>
                      </div>
                    )}
                  </div>
                )}

                {/* Header detail */}
                <div className="p-6">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-[10px] bg-white/5 font-mono text-white/60 font-bold px-2 py-0.5 rounded-md capitalize border border-white/5">
                      {activeResult.source} Source
                    </span>
                    {activeResult.fileName && (
                      <span className="text-[10px] text-white/40 font-medium truncate max-w-xs">
                        {activeResult.fileName}
                      </span>
                    )}
                  </div>
                  <h3 className="font-display font-semibold text-white text-xl leading-tight text-start" dir="auto">
                    {activeResult.title}
                  </h3>
                </div>
              </div>

              {/* Sub-Tabbed Output Navigation */}
              <div className="flex flex-col gap-4 bg-[#121214] border border-white/10 rounded-xl p-6">
                
                {/* Tabs bar */}
                <div className="flex border-b border-white/5 overflow-x-auto gap-6 scrollbar-none pb-2">
                  {[
                    { id: "summary", label: "Executive Summary", icon: Sparkles },
                    { id: "transcript", label: "Transcript", icon: AlignLeft },
                    { id: "chapters", label: "Interactive Chapters", icon: PlayCircle },
                    { id: "chat", label: "Interactive Chat Q&A", icon: MessageSquare },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-2 text-xs font-semibold py-2 border-b-2 transition-all whitespace-nowrap cursor-pointer ${
                          activeTab === tab.id
                            ? "border-orange-500 text-orange-400"
                            : "border-transparent text-white/40 hover:text-white/85 hover:border-white/10"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content screens */}
                <div className="min-h-[350px]">
                  
                  {/* Summary Screen */}
                  {activeTab === "summary" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col gap-4"
                    >
                      {/* Actions Bar */}
                      <div className="flex justify-end border-b border-white/5 pb-4">
                        <button
                          onClick={handleDownloadSummaryPDF}
                          className="flex items-center gap-1.5 border border-white/10 hover:bg-white/5 font-semibold text-white/80 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all active:scale-98"
                        >
                          <FileText className="h-3.5 w-3.5 text-orange-400" />
                          Save as PDF
                        </button>
                      </div>

                      <div className="markdown-body text-white/80 text-sm leading-relaxed text-start" dir="auto">
                        <Markdown>{activeResult.summary}</Markdown>
                      </div>
                    </motion.div>
                  )}

                  {/* Transcript Screen */}
                  {activeTab === "transcript" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col gap-4"
                    >
                      {/* Search & Actions Bar */}
                      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between border-b border-white/5 pb-4">
                        <div className="relative w-full sm:max-w-xs">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
                          <input
                            type="text"
                            placeholder="Filter transcript keywords..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500 transition-all"
                          />
                        </div>
                        
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                          <button
                            onClick={handleCopyTranscript}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 border border-white/10 hover:bg-white/5 font-semibold text-white/80 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all active:scale-98"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied ? "Copied" : "Copy"}
                          </button>
                          <button
                            onClick={handleDownloadTranscript}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 border border-white/10 hover:bg-white/5 font-semibold text-white/80 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all active:scale-98"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download TXT
                          </button>
                          <button
                            onClick={handleDownloadTranscriptPDF}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 border border-white/10 hover:bg-white/5 font-semibold text-white/80 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all active:scale-98"
                          >
                            <FileText className="h-3.5 w-3.5 text-orange-400" />
                            Save as PDF
                          </button>
                        </div>
                      </div>

                      {/* Transcript Paragraph Block */}
                      <div className="max-h-[400px] overflow-y-auto pr-2 flex flex-col gap-4">
                        {activeResult.cleanTranscript ? (
                          (() => {
                            // Split into paragraphs based on double newlines
                            const paragraphs = activeResult.cleanTranscript.split(/\n\s*\n/);
                            const filteredParagraphs = paragraphs.filter((p) =>
                              p.toLowerCase().includes(searchQuery.toLowerCase())
                            );

                            if (filteredParagraphs.length === 0) {
                              return (
                                <p className="text-xs text-white/40 text-center py-8">
                                  No matches found for "{searchQuery}". Try a different filter word!
                                </p>
                              );
                            }

                            return filteredParagraphs.map((para, index) => {
                              // Regex to extract timestamps if they exist, e.g. [12:34] or [01:23:45]
                              const timestampRegex = /(\[?\d{1,2}:\d{2}(?::\d{2})?\]?)/g;
                              const parts = para.split(timestampRegex);

                              return (
                                <p key={index} className="text-sm text-white/70 leading-relaxed text-start" dir="auto">
                                  {parts.map((part, pIdx) => {
                                    const isTimestamp = timestampRegex.test(part);
                                    if (isTimestamp) {
                                      const cleanTime = part.replace(/[\[\]]/g, "");
                                      return (
                                        <button
                                          key={pIdx}
                                          onClick={() => handleTimestampClick(cleanTime)}
                                          className="text-xs font-mono font-bold text-orange-400 bg-orange-500/10 hover:bg-orange-500/25 border border-orange-500/20 px-1.5 py-0.5 rounded-md mx-1 transition-all inline-flex items-center cursor-pointer"
                                        >
                                          {part}
                                        </button>
                                      );
                                    }
                                    return <span key={pIdx}>{getHighlightedText(part, searchQuery)}</span>;
                                  })}
                                </p>
                              );
                            });
                          })()
                        ) : (
                          <p className="text-xs text-white/40 italic">No transcript output generated.</p>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Chapters / Topics Screen */}
                  {activeTab === "chapters" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col gap-3"
                    >
                      <p className="text-xs text-white/40 mb-2">Click on any chapter's timestamp badge to automatically jump the player directly to that topic.</p>
                      <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-1">
                        {activeResult.chapters.length === 0 ? (
                          <div className="text-white/40 text-xs text-center py-8 italic">
                            No timed chapters indexed for this media file.
                          </div>
                        ) : (
                          activeResult.chapters.map((chapter, index) => (
                            <div
                              key={index}
                              onClick={() => handleTimestampClick(chapter.timestamp)}
                              className="border border-white/10 hover:border-orange-500/30 hover:bg-white/5 rounded-xl p-3.5 text-start transition-all cursor-pointer flex gap-4 items-start group"
                              dir="auto"
                            >
                              <div className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 group-hover:bg-orange-500/20 px-2 py-1 rounded-md shrink-0">
                                {chapter.timestamp}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-semibold text-white group-hover:text-orange-400 transition-colors flex items-center gap-1">
                                  {chapter.title}
                                  <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-all text-orange-400 shrink-0" />
                                </h4>
                                <p className="text-xs text-white/50 mt-1 leading-normal">
                                  {chapter.summary}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Q&A Chat Q&A Screen */}
                  {activeTab === "chat" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col h-[400px] justify-between gap-4"
                    >
                      {/* Messages block */}
                      <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 text-start">
                        {chatMessages.map((msg, index) => (
                          <div
                            key={index}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed text-start ${
                                msg.role === "user"
                                  ? "bg-orange-600 text-white font-medium"
                                  : "bg-white/5 text-white/90 border border-white/10"
                              }`}
                              dir="auto"
                            >
                              {msg.role === "model" ? (
                                <div className="markdown-body text-xs">
                                  <Markdown>{msg.content}</Markdown>
                                </div>
                              ) : (
                                msg.content
                              )}
                            </div>
                          </div>
                        ))}

                        {isChatLoading && (
                          <div className="flex justify-start">
                            <div className="bg-white/5 rounded-2xl px-4 py-3 border border-white/10 flex items-center gap-2">
                              <span className="flex h-1.5 w-1.5 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400/75 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
                              </span>
                              <span className="text-[10px] text-white/50 font-medium">Analyzing video context...</span>
                            </div>
                          </div>
                        )}
                        <div ref={chatBottomRef} />
                      </div>

                      {/* Prompt Suggestions */}
                      {chatMessages.length === 1 && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                          {[
                            "Summarize the conclusion.",
                            "What are the main actionable insights?",
                            "List the primary questions discussed.",
                          ].map((suggestion, sIdx) => (
                            <button
                              key={sIdx}
                              onClick={() => {
                                setChatInput(suggestion);
                              }}
                              className="bg-white/5 hover:bg-orange-500/10 border border-white/10 hover:border-orange-500/25 text-white/60 hover:text-orange-400 text-[10px] font-semibold px-2.5 py-1.5 rounded-full transition-all text-left cursor-pointer"
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Chat form submission */}
                      <form onSubmit={handleChatSubmit} className="flex gap-2 border-t border-white/5 pt-3">
                        <input
                          type="text"
                          placeholder="Ask a question about this video (e.g., 'What did they say about...')"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          disabled={isChatLoading}
                          dir="auto"
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-orange-500/50 focus:border-orange-500 focus:bg-white/5 transition-all disabled:opacity-60 text-start"
                        />
                        <button
                          type="submit"
                          disabled={isChatLoading || !chatInput.trim()}
                          className="bg-orange-600 hover:bg-orange-700 disabled:bg-white/5 disabled:text-white/20 text-white font-semibold px-4 rounded-xl flex items-center justify-center transition-all cursor-pointer"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Empty State Panel: What to do */
            <div className="bg-[#121214] border border-white/10 rounded-xl p-8 flex flex-col items-center justify-center text-center gap-6 min-h-[500px]">
              <div className="h-16 w-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center">
                <Sparkles className="h-8 w-8 animate-pulse" />
              </div>
              <div className="max-w-md flex flex-col gap-2">
                <h3 className="font-display font-medium text-white text-lg">No video analyzed yet</h3>
                <p className="text-white/40 text-xs leading-relaxed">
                  Enter a YouTube link or upload an audio/video file of a presentation, lecture, podcast, or tutorial, and Gemini will instantly transcribe and summarize it for you.
                </p>
              </div>

              {/* Sample Examples to try */}
              <div className="w-full max-w-lg mt-4 flex flex-col gap-3">
                <p className="text-white/40 font-semibold text-[10px] uppercase tracking-wider text-left pl-1">
                  Sample Videos to Explore
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    {
                      title: "How Large Language Models Work",
                      url: "https://www.youtube.com/watch?v=zjkBMFhNj_g",
                      description: "TED Talk format explanation of deep learning architectures.",
                    },
                    {
                      title: "UX Design Principles",
                      url: "https://www.youtube.com/watch?v=F77C_I0jW0Q",
                      description: "Visual analysis of modern interface psychology.",
                    },
                  ].map((example, eIdx) => (
                    <div
                      key={eIdx}
                      onClick={() => handleApplyExample(example.url)}
                      className="border border-white/10 hover:border-orange-500/30 hover:bg-white/5 rounded-xl p-3.5 text-left transition-all cursor-pointer group flex flex-col gap-1 w-full"
                    >
                      <span className="text-[9px] bg-orange-500/10 border border-orange-500/20 font-semibold text-orange-400 px-2 py-0.5 rounded-full w-max">
                        YouTube Demo
                      </span>
                      <h4 className="text-xs font-semibold text-white/80 mt-1 group-hover:text-orange-400 transition-colors flex items-center gap-1">
                        {example.title}
                        <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-all text-orange-400 shrink-0" />
                      </h4>
                      <p className="text-[10px] text-white/40 leading-normal line-clamp-2">
                        {example.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Humble Footer */}
      <footer className="bg-[#0A0A0B] border-t border-white/10 py-6 text-center text-xs text-white/30" id="app-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p>© 2026 Video Summarizer & Transcriber. Built on AI Studio with React, Vite & Gemini 3.5.</p>
        </div>
      </footer>
    </div>
  );
}

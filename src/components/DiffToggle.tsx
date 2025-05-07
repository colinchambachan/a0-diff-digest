import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import {
  savePR,
  getPRById,
  saveStreamingSession,
  getStreamingSession,
  updateStreamingResults,
  completeStreamingSession,
  deleteStreamingSession,
  saveNotesForPR,
} from "../utils/notesStorage";

interface DiffToggleProps {
  id: string;
  description: string;
  url: string;
  diff: string;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  index?: number;
  onGenerateRef?: (id: string, generateFn: () => Promise<void>) => void;
  _storedNotes?: {
    developer: string;
    marketing: string;
  } | null;
}

interface Notes {
  developer: string;
  marketing: string;
}

interface PartialNotes {
  developer: string;
  marketing: string;
}

export default function DiffToggle({
  id,
  description,
  url,
  diff,
  isOpen: externalIsOpen,
  onToggle,
  index = 0,
  onGenerateRef,
  _storedNotes,
}: DiffToggleProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notes, setNotes] = useState<Notes | null>(_storedNotes || null);
  const [partialNotes, setPartialNotes] = useState<PartialNotes>({
    developer: "",
    marketing: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);
  const [copiedDev, setCopiedDev] = useState(false);
  const [copiedMarketing, setCopiedMarketing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Create separate references for tracking the animation timeout
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<{ dev: string; marketing: string }>({
    dev: "",
    marketing: "",
  });

  // Function to attempt to parse JSON from a string
  const safeParseJSON = (jsonString: string) => {
    try {
      // Try to parse as complete JSON
      return JSON.parse(jsonString);
    } catch {
      try {
        // If that fails, try to extract JSON objects using regex
        const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch {
        // If all parsing fails, return an empty object
        console.error("Failed to parse JSON");
      }
      return { developer: "", marketing: "" };
    }
  };

  const processStreamingChunk = (data: Record<string, unknown>) => {
    try {
      if (data.type === "chunk") {
        // Use the parsed property if available
        if (data.parsed) {
          const parsed = data.parsed as Record<string, string>;

          // Store the latest complete content
          lastContentRef.current = {
            dev: parsed.developer || lastContentRef.current.dev,
            marketing: parsed.marketing || lastContentRef.current.marketing,
          };

          // Force a new object reference to ensure React re-renders
          setPartialNotes((prevNotes) => ({
            developer: parsed.developer || prevNotes.developer,
            marketing: parsed.marketing || prevNotes.marketing,
          }));

          // Save partial results to localStorage
          updateStreamingResults(
            id,
            parsed.developer || lastContentRef.current.dev,
            parsed.marketing || lastContentRef.current.marketing
          );
        } else {
          // Fall back to parsing fullContent
          const fullContent = data.fullContent as string;
          const parsed = safeParseJSON(fullContent);

          // Store the latest complete content
          lastContentRef.current = {
            dev: parsed.developer || lastContentRef.current.dev,
            marketing: parsed.marketing || lastContentRef.current.marketing,
          };

          // Force a new object reference to ensure React re-renders
          setPartialNotes((prevNotes) => ({
            developer: parsed.developer || prevNotes.developer,
            marketing: parsed.marketing || prevNotes.marketing,
          }));

          // Save partial results to localStorage
          updateStreamingResults(
            id,
            parsed.developer || lastContentRef.current.dev,
            parsed.marketing || lastContentRef.current.marketing
          );
        }

        // Force a re-render of the content height to ensure scrolling works correctly
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }

        animationTimeoutRef.current = setTimeout(() => {
          if (contentRef.current && isOpen) {
            setContentHeight(contentRef.current.scrollHeight);
          }
        }, 10);
      } else if (data.type === "complete") {
        // Final complete response
        try {
          const content = data.content as string;
          const finalData = safeParseJSON(content);

          const finalNotes = {
            developer: finalData.developer || lastContentRef.current.dev,
            marketing: finalData.marketing || lastContentRef.current.marketing,
          };

          setNotes(finalNotes);
          setIsGenerating(false);

          // Save the completed notes to the PR
          completeStreamingSession(
            id,
            finalNotes.developer,
            finalNotes.marketing
          );

          // Update the PR record
          savePR({
            id,
            description,
            url,
            diff,
            notes: finalNotes,
            timestamp: Date.now(),
          });

          // Clean up animation timeout
          if (animationTimeoutRef.current) {
            clearTimeout(animationTimeoutRef.current);
            animationTimeoutRef.current = null;
          }

          // Close the event source when complete
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
        } catch {
          setError("Failed to parse final response");
          setIsGenerating(false);
          deleteStreamingSession(id);
        }
      } else if (data.type === "error") {
        throw new Error((data.error as string) || "Unknown error");
      }
    } catch (err) {
      console.error("Failed to process chunk:", err);
      setError(
        err instanceof Error ? err.message : "Failed to process response"
      );
      setIsGenerating(false);

      // Clean up animation timeout
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }

      // Close the event source on error
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Clean up streaming session on error
      deleteStreamingSession(id);
    }
  };

  const generateNotes = useCallback(async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setPartialNotes({ developer: "", marketing: "" });
    lastContentRef.current = { dev: "", marketing: "" };
    setNotes(null);

    try {
      // Step 1: Close any existing EventSource
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Step 2: Send the diff to the server and get a session ID
      const response = await fetch("/api/ws", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prId: id,
          description,
          diff,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to initiate note generation"
        );
      }

      const { sessionId } = await response.json();

      // Save the PR with empty notes if it doesn't exist yet
      const existingPR = getPRById(id);
      if (!existingPR) {
        savePR({
          id,
          description,
          url,
          diff,
          notes: null,
          timestamp: Date.now(),
        });
      }

      // Save the initial streaming session to localStorage
      saveStreamingSession({
        id,
        sessionId,
        partialDeveloper: "",
        partialMarketing: "",
        timestamp: Date.now(),
      });

      // Step 3: Create an EventSource to stream the generation results
      const eventSource = new EventSource(
        `/api/ws?sessionId=${sessionId}&prId=${id}&description=${encodeURIComponent(
          description
        )}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          processStreamingChunk(data);
        } catch (err) {
          console.error("Failed to parse event data:", err);
        }
      };

      eventSource.onerror = () => {
        console.error("EventSource error");
        eventSource.close();
        setError("Stream connection error");
        setIsGenerating(false);
        deleteStreamingSession(id); // Clean up on error
      };
    } catch (err) {
      console.error("Generation error:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
      setIsGenerating(false);
      deleteStreamingSession(id); // Clean up on error
    }
  }, [id, description, diff, url, isGenerating]);

  // Register the generate function with the parent component
  useEffect(() => {
    if (onGenerateRef) {
      onGenerateRef(id, generateNotes);
    }
  }, [id, onGenerateRef, generateNotes]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, 50 * index);

    return () => clearTimeout(timeout);
  }, [index]);

  useEffect(() => {
    if (copiedDev) {
      const timeout = setTimeout(() => {
        setCopiedDev(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [copiedDev]);

  useEffect(() => {
    if (copiedMarketing) {
      const timeout = setTimeout(() => {
        setCopiedMarketing(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [copiedMarketing]);

  // Clean up EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;

  useEffect(() => {
    if (externalIsOpen !== undefined) {
      setInternalIsOpen(externalIsOpen);
    }
  }, [externalIsOpen]);

  useEffect(() => {
    if (contentRef.current && isOpen) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [isOpen, notes, isGenerating, error, partialNotes]);

  // On mount, check if we have already generated notes for this PR
  useEffect(() => {
    // Check if we have notes stored for this PR if not already passed as prop
    if (!_storedNotes) {
      const storedPR = getPRById(id);
      if (storedPR && storedPR.notes) {
        setNotes(storedPR.notes);
      }
    }

    // Check if we have an in-progress streaming session
    const streamingSession = getStreamingSession(id);
    if (streamingSession) {
      // Restore partial notes
      setPartialNotes({
        developer: streamingSession.partialDeveloper,
        marketing: streamingSession.partialMarketing,
      });
    }
  }, [id, _storedNotes]);

  const handleToggle = () => {
    const newIsOpen = !isOpen;
    setInternalIsOpen(newIsOpen);
    if (onToggle) {
      onToggle(newIsOpen);
    }
  };

  const copyToClipboard = async (
    text: string,
    type: "developer" | "marketing"
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "developer") {
        setCopiedDev(true);
      } else {
        setCopiedMarketing(true);
      }
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  // Ensure that the notes are properly displayed while generating with typewriter effect
  const devNotes =
    notes?.developer ||
    partialNotes.developer ||
    (isGenerating
      ? "Generating..."
      : "Generate notes to see technical details.");

  const marketingNotes =
    notes?.marketing ||
    partialNotes.marketing ||
    (isGenerating
      ? "Generating..."
      : "Generate notes to see user-friendly details.");

  // Function to display notes with typewriter cursor effect
  const renderWithTypewriterEffect = (text: string, isGenerating: boolean) => {
    if (!isGenerating || !text || text === "Generating...") {
      return text;
    }

    // Add a blinking cursor effect at the end if still generating
    return (
      <>
        {text}
        <span className="inline-block animate-pulse ml-0.5 bg-gray-700 dark:bg-gray-300 w-1.5 h-4 align-middle">
          &nbsp;
        </span>
      </>
    );
  };

  return (
    <div
      className={`border border-gray-200 dark:border-gray-700 rounded-lg mb-4 overflow-hidden transition-all duration-500 ease-in-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div
        className="flex items-center p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors rounded-lg"
        onClick={handleToggle}
      >
        <div className="mr-2 transition-transform duration-300">
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-500" />
          )}
        </div>
        <div className="flex-1 flex items-center">
          <div className="flex items-center">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline mr-2"
              onClick={(e) => e.stopPropagation()}
            >
              PR #{id}:
            </a>
            {isGenerating && (
              <RefreshCw className="animate-spin h-3.5 w-3.5 text-purple-600 dark:text-purple-400 mr-2" />
            )}
          </div>
          <span>{description}</span>
        </div>
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isOpen ? `${contentHeight}px` : "0",
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div
          ref={contentRef}
          className="p-4 border-t border-gray-200 dark:border-gray-700"
        >
          {!notes && !isGenerating && !error && (
            <button
              className="mb-4 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                generateNotes();
              }}
            >
              Generate Release Notes
            </button>
          )}

          {isGenerating && (
            <div className="flex items-center mb-4 text-gray-600 dark:text-gray-400">
              <RefreshCw className="animate-spin h-4 w-4 mr-2" />
              Generating notes...
            </div>
          )}

          {error && (
            <div className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded mb-4">
              Error: {error}
              <button
                className="ml-4 px-2 py-1 bg-red-200 dark:bg-red-800 rounded text-sm cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  generateNotes();
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg relative group">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium text-blue-800 dark:text-blue-300">
                  Developer Notes
                </h3>
                {(notes || partialNotes.developer) && !isGenerating && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(devNotes, "developer");
                    }}
                    className="text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-300 p-1 rounded-md transition-colors cursor-pointer"
                    title="Copy to clipboard"
                  >
                    {copiedDev ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {renderWithTypewriterEffect(devNotes, isGenerating)}
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg relative group">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium text-green-800 dark:text-green-300">
                  Marketing Notes
                </h3>
                {(notes || partialNotes.marketing) && !isGenerating && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(marketingNotes, "marketing");
                    }}
                    className="text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-300 p-1 rounded-md transition-colors cursor-pointer"
                    title="Copy to clipboard"
                  >
                    {copiedMarketing ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {renderWithTypewriterEffect(marketingNotes, isGenerating)}
              </p>
            </div>
          </div>

          {(notes || (partialNotes.developer && !isGenerating)) && (
            <div className="mt-4 flex justify-end">
              <button
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  generateNotes();
                }}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

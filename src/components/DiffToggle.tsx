import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";

interface DiffToggleProps {
  id: string;
  description: string;
  url: string;
  diff: string;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  index?: number;
  onGenerateRef?: (id: string, generateFn: () => Promise<void>) => void;
}

interface Notes {
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
}: DiffToggleProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notes, setNotes] = useState<Notes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);
  const [copiedDev, setCopiedDev] = useState(false);
  const [copiedMarketing, setCopiedMarketing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Register the generate function with the parent component
  useEffect(() => {
    if (onGenerateRef) {
      onGenerateRef(id, generateNotes);
    }
  }, [id, onGenerateRef]);

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
  }, [isOpen, notes, isGenerating, error]);

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

  const generateNotes = async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          diff,
          prId: id,
          description,
        }),
      });

      // Check if response starts with HTML, which would indicate an error
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        const text = await response.text();
        throw new Error(
          "Server error occurred. Please check your server logs and ensure your API key is valid."
        );
      }

      if (!response.ok) {
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to generate notes");
        } catch (parseError) {
          throw new Error(
            `HTTP error ${response.status}: ${response.statusText}`
          );
        }
      }

      // Parse the JSON response
      try {
        const data = await response.json();
        if (!data.developer || !data.marketing) {
          throw new Error("Incomplete response from API");
        }

        setNotes({
          developer: data.developer,
          marketing: data.marketing,
        });
      } catch (err) {
        throw new Error("Failed to parse response from API");
      }
    } catch (err) {
      console.error("Generation error:", err);
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const devNotes =
    notes?.developer ||
    (isGenerating
      ? "Generating..."
      : "Generate notes to see technical details.");

  const marketingNotes =
    notes?.marketing ||
    (isGenerating
      ? "Generating..."
      : "Generate notes to see user-friendly details.");

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
                {notes && !isGenerating && (
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
                {devNotes}
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg relative group">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-medium text-green-800 dark:text-green-300">
                  Marketing Notes
                </h3>
                {notes && !isGenerating && (
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
                {marketingNotes}
              </p>
            </div>
          </div>

          {notes && (
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

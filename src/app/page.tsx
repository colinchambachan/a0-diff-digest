"use client"; // Mark as a Client Component

import { useState, useEffect, useRef } from "react";
import DiffToggle from "@/components/DiffToggle";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { PR, getAllPRs, savePRs, getPRById } from "@/utils/notesStorage";

// Add the storage key constants
const PR_STORAGE_KEY = "diff-digest-prs";
const STREAMING_STORAGE_KEY = "diff-digest-streaming";

// Define the expected structure of a diff object
interface DiffItem {
  id: string;
  description: string;
  diff: string;
  url: string; // Added URL field
  _storedNotes?: {
    developer: string;
    marketing: string;
  } | null;
}

// Define the expected structure of the API response
interface ApiResponse {
  diffs: DiffItem[];
  nextPage: number | null;
  currentPage: number;
  perPage: number;
}

export default function Home() {
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [initialFetchDone, setInitialFetchDone] = useState<boolean>(false);
  const [openDiffIds, setOpenDiffIds] = useState<Set<string>>(new Set());
  const [expandButtonVisible, setExpandButtonVisible] = useState(false);
  const [loadMoreButtonVisible, setLoadMoreButtonVisible] = useState(false);
  const [messagesVisible, setMessagesVisible] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateButtonVisible, setGenerateButtonVisible] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);

  // Constants for localStorage keys
  const PAGINATION_KEY = "diff-digest-pagination";

  // Function to save pagination state
  const savePaginationState = (
    currentPage: number,
    nextPage: number | null
  ) => {
    try {
      if (typeof window === "undefined") return;

      localStorage.setItem(
        PAGINATION_KEY,
        JSON.stringify({
          currentPage,
          nextPage,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error saving pagination state:", error);
    }
  };

  // Store references to individual PR generateNotes functions
  const generateFunctionsRef = useRef<Map<string, () => Promise<void>>>(
    new Map()
  );

  // Determine if all toggles are currently open
  const allTogglesOpen = diffs.length > 0 && openDiffIds.size === diffs.length;

 
  // Fade in control buttons when diffs are loaded
  useEffect(() => {
    if (diffs.length > 0) {
      // Add a small delay for a nicer effect
      const timeout = setTimeout(() => {
        setExpandButtonVisible(true);
        setGenerateButtonVisible(true);
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [diffs.length]);

  // Fade in the load more button when nextPage becomes available
  useEffect(() => {
   

    if (nextPage) {
      // Always show the load more button if we have a next page, regardless of loading state
      const timeout = setTimeout(
        () => {
          setLoadMoreButtonVisible(true);
        },
        isLoading ? 500 : 0
      );
      return () => clearTimeout(timeout);
    } else {
      setLoadMoreButtonVisible(false);
    }
  }, [nextPage, isLoading, loadMoreButtonVisible]);

  // Fade in feedback messages (error, empty state, etc)
  useEffect(() => {
    if (error || initialFetchDone || isLoading) {
      setMessagesVisible(false);
      const timeout = setTimeout(() => {
        setMessagesVisible(true);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [error, initialFetchDone, isLoading]);

  
  // Add useEffect to load stored PRs on mount
  useEffect(() => {
    // Initial effect to load PRs from localStorage when the app starts
    const storedPRs = getAllPRs();
    if (storedPRs.length > 0) {
      console.log(
        `Loaded ${storedPRs.length} PRs from localStorage on initial mount`
      );

      // Convert PR[] to DiffItem[] with _storedNotes property
      const loadedDiffs: DiffItem[] = storedPRs.map((pr) => ({
        id: pr.id,
        description: pr.description,
        url: pr.url,
        diff: pr.diff,
        _storedNotes: pr.notes,
      }));

      setDiffs(loadedDiffs);
      setInitialFetchDone(true);

      // Open PRs that had notes generated
      const prsWithNotes = new Set(
        storedPRs.filter((pr) => pr.notes !== null).map((pr) => pr.id)
      );

      if (prsWithNotes.size > 0) {
        setOpenDiffIds(prsWithNotes);
      }

      // Always set nextPage to fetch the next batch from the server
      // This ensures the Load More button is visible
      setNextPage(1);
      console.log("Always setting nextPage to allow fetching more PRs");

      // Trigger UI animations
      setTimeout(() => {
        setExpandButtonVisible(true);
        setGenerateButtonVisible(true);
        setLoadMoreButtonVisible(true);
      }, 300);
    }
  }, []);

  const fetchDiffs = async (page: number) => {
    setIsLoading(true);
    setError(null);
    setMessagesVisible(false);
    try {
      const response = await fetch(
        `/api/sample-diffs?page=${page}&per_page=10`
      );
      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorData.details || errorMsg;
        } catch {
          // Ignore if response body is not JSON
          console.warn("Failed to parse error response as JSON");
        }
        throw new Error(errorMsg);
      }
      const data: ApiResponse = await response.json();

      // Process the fetched diffs and handle existing PRs
      const processedDiffs = data.diffs.map((diff) => {
        // Check if we already have this PR in localStorage
        const existingPR = getPRById(diff.id);
        if (existingPR) {
          // If PR already exists, preserve its notes
          return {
            ...diff,
            _storedNotes: existingPR.notes,
          };
        }
        return diff;
      });

      // Update the diffs in state, maintaining pagination order
      setDiffs((prevDiffs) => {
        if (page === 1) {
          // For page 1, prioritize new data but preserve existing PRs not in the new response
          const newDiffMap = new Map(
            processedDiffs.map((diff) => [diff.id, diff])
          );

          // Remove any existing diffs that are also in the new response to avoid duplicates
          const preservedDiffs = prevDiffs.filter(
            (diff) => !newDiffMap.has(diff.id)
          );

          // Add processedDiffs at the beginning (top) as they're the newest
          return [...processedDiffs, ...preservedDiffs];
        } else {
          // For subsequent pages, append at the end (bottom) as they're older PRs
          return [...prevDiffs, ...processedDiffs];
        }
      });

      // Store fetched PRs in localStorage
      const prsToStore: PR[] = processedDiffs.map((diff) => {
        const existingPR = getPRById(diff.id);
        return {
          id: diff.id,
          description: diff.description,
          url: diff.url,
          diff: diff.diff,
          notes: existingPR?.notes || diff._storedNotes || null,
          timestamp: Date.now(),
        };
      });

      savePRs(prsToStore);

      // Save pagination state
      setCurrentPage(data.currentPage);
      setNextPage(data.nextPage);
      savePaginationState(data.currentPage, data.nextPage);

      if (!initialFetchDone) setInitialFetchDone(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchClick = () => {
    // Don't clear existing diffs - just update them with new data
    setIsLoading(true);
    setError(null);
    setMessagesVisible(false);
    generateFunctionsRef.current.clear();
    fetchDiffs(1);
  };

  const handleLoadMoreClick = () => {
    if (!isLoading) {
      const pageToFetch = nextPage || 1;
      console.log(`Loading more items from page ${pageToFetch}`);
      fetchDiffs(pageToFetch);
    } else {
      console.log("Cannot load more - currently loading");
    }
  };

  const handleToggleItem = (id: string, isOpen: boolean) => {
    setOpenDiffIds((prev) => {
      const newSet = new Set(prev);
      if (isOpen) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  };

  const handleToggleAll = () => {
    if (allTogglesOpen) {
      // If all are open, collapse all
      setOpenDiffIds(new Set());
    } else {
      // Otherwise, expand all
      const allIds = diffs.map((item) => item.id);
      setOpenDiffIds(new Set(allIds));
    }
  };

  const registerGenerateFunction = (
    id: string,
    generateFn: () => Promise<void>
  ) => {
    generateFunctionsRef.current.set(id, generateFn);
  };

  const handleGenerateAll = async () => {
    setIsGeneratingAll(true);
    setGenerationProgress(0);
    setGenerationTotal(diffs.length);

    // First expand all PRs to show the generation
    if (!allTogglesOpen) {
      const allIds = diffs.map((item) => item.id);
      setOpenDiffIds(new Set(allIds));
    }

    // Generate notes for each PR sequentially
    let completed = 0;

    for (const pr of diffs) {
      try {
        const generateFn = generateFunctionsRef.current.get(pr.id);
        if (generateFn) {
          await generateFn();
          // Wait a bit between requests to avoid overwhelming the API
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error generating notes for PR ${pr.id}:`, error);
        // Continue with the next PR even if this one fails
      }

      completed++;
      setGenerationProgress(completed);
    }

    setIsGeneratingAll(false);

    // Refresh diffs with updated notes from localStorage
    const storedPRs = getAllPRs();
    if (storedPRs.length > 0) {
      const refreshedDiffs: DiffItem[] = diffs.map((diff) => {
        const storedPR = storedPRs.find((pr) => pr.id === diff.id);
        return {
          ...diff,
          _storedNotes: storedPR?.notes || null,
        };
      });

      setDiffs(refreshedDiffs);
    }
  };

  // Add a clear function to handle resetting all data
  const handleClearAll = () => {
    // Clear all localStorage data
    if (typeof window !== "undefined") {
      localStorage.removeItem(PR_STORAGE_KEY);
      localStorage.removeItem(PAGINATION_KEY);
      localStorage.removeItem(STREAMING_STORAGE_KEY);
      console.log("Cleared all data from localStorage");
    }

    // Reset all state
    setDiffs([]);
    setOpenDiffIds(new Set());
    setNextPage(null);
    setCurrentPage(1);
    setError(null);
    setInitialFetchDone(false);
    setExpandButtonVisible(false);
    setGenerateButtonVisible(false);
    setLoadMoreButtonVisible(false);
    generateFunctionsRef.current.clear();

    console.log("Reset complete - all PRs and state cleared");
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 sm:p-24">
      <h1 className="text-4xl font-bold mb-3">Diff Digest ✍️</h1>
      <h1 className="text-lg text-gray-500 mb-12">
        Made w/ love by{" "}
        <a
          href="https://linkedin.com/in/colinchambachan"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline decoration-2 underline-offset-4"
        >
          Colin
          <ExternalLink className="h-4 w-4 inline-block ms-1" />
        </a>{" "}
        :D
      </h1>

      <div className="w-full max-w-4xl">
        {/* Controls Section */}
        <div className="mb-8 flex space-x-4">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer"
            onClick={handleFetchClick}
            disabled={isLoading}
          >
            {isLoading && currentPage === 1
              ? "Fetching..."
              : "Fetch Latest Diffs"}
          </button>
        </div>

        {/* Results Section */}
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-6 min-h-[300px] bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold">Merged Pull Requests</h2>

            {diffs.length > 0 && (
              <div className="flex space-x-2">
                <button
                  className={`flex items-center px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-all duration-500 ease-in-out cursor-pointer ${
                    expandButtonVisible
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4"
                  }`}
                  onClick={handleToggleAll}
                >
                  {allTogglesOpen ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-1.5" />
                      Collapse All
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-1.5" />
                      Expand All
                    </>
                  )}
                </button>

                <button
                  className={`flex items-center px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-all duration-500 ease-in-out cursor-pointer ${
                    expandButtonVisible
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4"
                  }`}
                  onClick={handleClearAll}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 mr-1.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                  </svg>
                  Reset All
                </button>

                <button
                  className={`flex items-center px-4 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-70 disabled:hover:bg-purple-600 transition-all duration-500 ease-in-out cursor-pointer ${
                    generateButtonVisible
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4"
                  }`}
                  onClick={handleGenerateAll}
                  disabled={isGeneratingAll}
                >
                  <Sparkles className="h-4 w-4 mr-1.5" />
                  {isGeneratingAll ? "Generating..." : "Generate All Notes"}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div
              className={`text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-3 rounded mb-4 transition-all duration-500 ease-in-out ${
                messagesVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              Error: {error}
            </div>
          )}

          {!initialFetchDone && !isLoading && (
            <p
              className={`text-gray-600 dark:text-gray-400 tra  nsition-all duration-500 ease-in-out ${
                messagesVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              Click the button above to fetch the latest merged pull requests
              from the repository.
            </p>
          )}

          {initialFetchDone && diffs.length === 0 && !isLoading && !error && (
            <p
              className={`text-gray-600 dark:text-gray-400 transition-all duration-500 ease-in-out ${
                messagesVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              No merged pull requests found or fetched.
            </p>
          )}

          {diffs.length > 0 && (
            <div className="space-y-2">
              {diffs.map((item, idx) => (
                <DiffToggle
                  key={item.id}
                  id={item.id}
                  description={item.description}
                  url={item.url}
                  diff={item.diff}
                  isOpen={openDiffIds.has(item.id)}
                  onToggle={(isOpen) => handleToggleItem(item.id, isOpen)}
                  index={idx}
                  onGenerateRef={registerGenerateFunction}
                  _storedNotes={item._storedNotes}
                />
              ))}
            </div>
          )}

          {isLoading && currentPage > 1 && (
            <p
              className={`text-gray-600 dark:text-gray-400 mt-4 transition-all duration-500 ease-in-out ${
                messagesVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              }`}
            >
              Loading more...
            </p>
          )}

          {diffs.length > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors cursor-pointer"
                onClick={handleLoadMoreClick}
                disabled={isLoading}
              >
                {isLoading
                  ? "Loading..."
                  : `Load More (Page ${
                      nextPage || Math.floor(diffs.length / 10) + 1
                    })`}
              </button>
            </div>
          )}

          {isGeneratingAll && (
            <div className="mt-4 flex items-center">
              <RefreshCw className="animate-spin h-5 w-5 mr-2 text-purple-600" />
              <span>
                Generating notes: {generationProgress} of {generationTotal}
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

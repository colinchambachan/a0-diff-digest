"use client"; // Mark as a Client Component

import { useState, useEffect, useRef } from "react";
import DiffToggle from "@/components/DiffToggle";
import { ChevronDown, ChevronUp, ExternalLink, Sparkles } from "lucide-react";

// Define the expected structure of a diff object
interface DiffItem {
  id: string;
  description: string;
  diff: string;
  url: string; // Added URL field
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

  // Store references to individual PR generateNotes functions
  const generateFunctionsRef = useRef<Map<string, () => Promise<void>>>(
    new Map()
  );

  // Determine if all toggles are currently open
  const allTogglesOpen = diffs.length > 0 && openDiffIds.size === diffs.length;

  useEffect(() => {
    console.log("Current diffs:", diffs);
  }, [diffs]);

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
    if (nextPage && !isLoading) {
      // Add a small delay for a nicer effect
      const timeout = setTimeout(() => {
        setLoadMoreButtonVisible(true);
      }, 500);
      return () => clearTimeout(timeout);
    } else {
      setLoadMoreButtonVisible(false);
    }
  }, [nextPage, isLoading]);

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

      setDiffs((prevDiffs) =>
        page === 1 ? data.diffs : [...prevDiffs, ...data.diffs]
      );
      setCurrentPage(data.currentPage);
      setNextPage(data.nextPage);
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
    setDiffs([]); // Clear existing diffs when fetching the first page again
    setOpenDiffIds(new Set()); // Reset open diffs when fetching new diffs
    setExpandButtonVisible(false); // Reset button visibility
    setLoadMoreButtonVisible(false);
    setGenerateButtonVisible(false);
    setMessagesVisible(false);
    generateFunctionsRef.current.clear();
    fetchDiffs(1);
  };

  const handleLoadMoreClick = () => {
    if (nextPage) {
      setLoadMoreButtonVisible(false);
      fetchDiffs(nextPage);
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
    if (isGeneratingAll || generateFunctionsRef.current.size === 0) return;

    setIsGeneratingAll(true);

    // First expand all PRs to show the generation
    if (!allTogglesOpen) {
      const allIds = diffs.map((item) => item.id);
      setOpenDiffIds(new Set(allIds));
    }

    // Generate sequentially to avoid overloading the API
    for (const generateFn of generateFunctionsRef.current.values()) {
      try {
        await generateFn();

        // Small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error("Error generating notes:", error);
        // Continue with the next PR even if one fails
      }
    }

    setIsGeneratingAll(false);
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

          {nextPage && !isLoading && (
            <div className="mt-6">
              <button
                className={`px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-all duration-500 ease-in-out cursor-pointer ${
                  loadMoreButtonVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4"
                }`}
                onClick={handleLoadMoreClick}
                disabled={isLoading}
              >
                Load More (Page {nextPage})
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

"use client"; // Mark as a Client Component

import { useState, useEffect, useRef } from "react";
import DiffToggle from "@/components/DiffToggle";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  Loader2,
  Zap,
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
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [repoOwner, setRepoOwner] = useState<string>("openai");
  const [repoName, setRepoName] = useState<string>("openai-node");
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

  // Constants for localStorage keys
  const PAGINATION_KEY = "diff-digest-pagination";
  const REPO_SETTINGS_KEY = "diff-digest-repo-settings";

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

  // Effect to load repo settings from localStorage
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;

      const storedSettings = localStorage.getItem(REPO_SETTINGS_KEY);
      if (storedSettings) {
        const { owner, repo, perPage } = JSON.parse(storedSettings);
        if (owner) setRepoOwner(owner);
        if (repo) setRepoName(repo);
        if (perPage) setItemsPerPage(perPage);
      }
    } catch (error) {
      console.error("Error loading repo settings:", error);
    }
  }, []);

  // Function to save repo settings to localStorage
  const saveRepoSettings = (owner: string, repo: string, perPage: number) => {
    try {
      if (typeof window === "undefined") return;

      localStorage.setItem(
        REPO_SETTINGS_KEY,
        JSON.stringify({
          owner,
          repo,
          perPage,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error saving repo settings:", error);
    }
  };

  // Fade in control buttons when diffs are loaded
  useEffect(() => {
    if (diffs.length > 0) {
      // Add a small delay for a nicer effect
      const timeout = setTimeout(() => {
        setExpandButtonVisible(true);
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
        `/api/sample-diffs?page=${page}&per_page=${itemsPerPage}&owner=${encodeURIComponent(
          repoOwner
        )}&repo=${encodeURIComponent(repoName)}`
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

  // Function to check if current settings differ from stored settings
  const settingsHaveChanged = () => {
    try {
      const storedSettings = localStorage.getItem(REPO_SETTINGS_KEY);
      if (storedSettings) {
        const { owner, repo, perPage } = JSON.parse(storedSettings);
        return (
          owner !== repoOwner || repo !== repoName || perPage !== itemsPerPage
        );
      }
      return true; // If no stored settings, consider it changed
    } catch {
      return true; // If error parsing, consider it changed
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
      localStorage.removeItem(REPO_SETTINGS_KEY);
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
    setLoadMoreButtonVisible(false);
    // Reset repo settings to defaults
    setRepoOwner("openai");
    setRepoName("openai-node");
    setItemsPerPage(10);
    generateFunctionsRef.current.clear();

    console.log("Reset complete - all PRs and state cleared");
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 sm:p-24">
      <h1 className="text-4xl font-bold mb-2">Diff Digest</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 mb-3">
        AI-powered PR analysis & code change summarization
      </p>

      <div className="flex items-center text-md text-gray-500 mb-10">
        <span>Made w/ </span>
        <span className="text-red-500 mx-1">♥</span>
        <span>by</span>
        <a
          href="https://linkedin.com/in/colinchambachan"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 underline decoration-2 underline-offset-4 ml-1 flex items-center"
        >
          Colin
          <ExternalLink className="h-3.5 w-3.5 inline-block ml-0.5" />
        </a>
      </div>

      <div className="w-full max-w-4xl">
        {/* Repo Settings Section */}
        <div className="mb-8 p-6 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 shadow-sm transition-all duration-300 hover:shadow-md">
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2 text-blue-600"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
              <path d="M9 18c-4.51 2-5-2-7-2"></path>
            </svg>
            Repository Settings
          </h2>
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="group flex-1 min-w-[220px]">
              <label
                htmlFor="repoOwner"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400"
              >
                Owner
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
                <input
                  id="repoOwner"
                  type="text"
                  value={repoOwner}
                  onChange={(e) => setRepoOwner(e.target.value)}
                  className="w-full pl-10 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 transition-all duration-200"
                  placeholder="e.g. openai"
                />
              </div>
            </div>
            <div className="group flex-1 min-w-[220px]">
              <label
                htmlFor="repoName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400"
              >
                Repository
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 3v18h18"></path>
                    <path d="M18.4 3a1.8 1.8 0 0 0-1.8 1.8v10.8"></path>
                    <path d="M8.4 3a1.8 1.8 0 0 1 1.8 1.8v10.8"></path>
                    <path d="M13.5 7.5 18 3"></path>
                    <path d="M13.5 7.5 9 3"></path>
                    <path d="M10 19v-6.3a1.8 1.8 0 0 1 3.6 0V19"></path>
                  </svg>
                </div>
                <input
                  id="repoName"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="w-full pl-10 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 transition-all duration-200"
                  placeholder="e.g. openai-node"
                />
              </div>
            </div>
            <div className="group w-[180px]">
              <label
                htmlFor="itemsPerPage"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
              >
                Items Per Page
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21v-6"></path>
                    <path d="M15 15v6"></path>
                    <path d="M4 7V3h16v4"></path>
                    <path d="M3 7h5l2 2 2-2h5v5l-2 2 2 2v5h-5l-2-2-2 2H3v-5l2-2-2-2Z"></path>
                  </svg>
                </div>
                <select
                  id="itemsPerPage"
                  value={itemsPerPage}
                  onChange={(e) => setItemsPerPage(Number(e.target.value))}
                  className="w-full pl-10 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 appearance-none cursor-pointer transition-all duration-200"
                >
                  <option value="5">5 items</option>
                  <option value="10">10 items</option>
                  <option value="15">15 items</option>
                  <option value="20">20 items</option>
                  <option value="25">25 items</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                  <svg
                    className="w-4 h-4 text-gray-400"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 justify-between mt-8">
            <button
              className="px-5 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-all duration-200 shadow-sm hover:shadow flex items-center"
              onClick={() => {
                // Check if repo owner or name has changed
                const storedSettings = localStorage.getItem(REPO_SETTINGS_KEY);
                let shouldClearData = false;

                if (storedSettings) {
                  const { owner, repo, perPage } = JSON.parse(storedSettings);
                  // If either owner or repo has changed, we should clear data
                  if (
                    owner !== repoOwner ||
                    repo !== repoName ||
                    perPage !== itemsPerPage
                  ) {
                    shouldClearData = true;
                  }
                }

                // Clear data if repo changed
                if (shouldClearData) {
                  localStorage.removeItem(PR_STORAGE_KEY);
                  localStorage.removeItem(PAGINATION_KEY);
                  localStorage.removeItem(STREAMING_STORAGE_KEY);

                  // Reset diff-related state
                  setDiffs([]);
                  setOpenDiffIds(new Set());
                  setNextPage(null);
                  setCurrentPage(1);
                  setInitialFetchDone(false);
                  generateFunctionsRef.current.clear();
                  console.log("Repository changed - cleared previous data");
                }

                // Save the new settings and fetch
                saveRepoSettings(repoOwner, repoName, itemsPerPage);
                handleFetchClick();
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  <span className="whitespace-nowrap">Fetching...</span>
                </>
              ) : initialFetchDone && !settingsHaveChanged() ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  <span className="whitespace-nowrap">Refresh</span>
                </>
              ) : (
                <span className="whitespace-nowrap">Fetch Diffs</span>
              )}
            </button>
            <button
              className="px-5 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 transition-all duration-200 shadow-sm hover:shadow flex items-center"
              onClick={() => {
                // Check if repo settings have changed from current values
                const hasChanged =
                  repoOwner !== "openai" ||
                  repoName !== "openai-node" ||
                  itemsPerPage !== 10;

                // Clear data if settings changed
                if (hasChanged) {
                  localStorage.removeItem(PR_STORAGE_KEY);
                  localStorage.removeItem(PAGINATION_KEY);
                  localStorage.removeItem(STREAMING_STORAGE_KEY);

                  // Reset diff-related state
                  setDiffs([]);
                  setOpenDiffIds(new Set());
                  setNextPage(null);
                  setCurrentPage(1);
                  setInitialFetchDone(false);
                  setExpandButtonVisible(false);
                  setLoadMoreButtonVisible(false);
                  generateFunctionsRef.current.clear();
                  console.log("Reset to defaults - cleared previous data");
                }

                // Reset repository settings
                setRepoOwner("openai");
                setRepoName("openai-node");
                setItemsPerPage(10);
                saveRepoSettings("openai", "openai-node", 10);
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              Reset to Defaults
            </button>
          </div>
        </div>

        {/* Results Section */}
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-6 min-h-[300px] bg-gray-50 dark:bg-gray-800">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold flex items-center">
              Merged Pull Requests
              {isLoading && currentPage === 1 && (
                <Loader2 className="ml-3 h-5 w-5 animate-spin text-blue-600" />
              )}
            </h2>

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
                    expandButtonVisible
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4"
                  }`}
                  onClick={handleGenerateAll}
                  disabled={isGeneratingAll}
                >
                  {isGeneratingAll ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                      Generating {generationProgress}/{generationTotal}
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-1.5" />
                      Generate All
                    </>
                  )}
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
                      nextPage || Math.floor(diffs.length / itemsPerPage) + 1
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

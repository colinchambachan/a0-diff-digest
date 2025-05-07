/**
 * Storage utilities for persisting PR data and notes using localStorage
 */

// PR interface defining the structure for PR data storage
export interface PR {
  id: string;
  description: string;
  url: string;
  diff: string;
  notes: {
    developer: string;
    marketing: string;
  } | null;
  timestamp: number;
}

// Interface for tracking streaming sessions
export interface StreamingSession {
  id: string;
  sessionId: string;
  partialDeveloper: string;
  partialMarketing: string;
  timestamp: number;
}

// Constants for storage keys
const PR_STORAGE_KEY = "diff-digest-prs";
const STREAMING_STORAGE_KEY = "diff-digest-streaming";

// Get all stored PRs
export function getAllPRs(): PR[] {
  try {
    if (typeof window === "undefined") return [];

    const storedData = localStorage.getItem(PR_STORAGE_KEY);
    if (!storedData) return [];

    return JSON.parse(storedData);
  } catch (error) {
    console.error("Error reading PRs from localStorage:", error);
    return [];
  }
}

// Get a specific PR by ID
export function getPRById(id: string): PR | null {
  try {
    const prs = getAllPRs();
    return prs.find((pr) => pr.id === id) || null;
  } catch (error) {
    console.error(`Error getting PR with ID ${id}:`, error);
    return null;
  }
}

// Save a PR to localStorage
export function savePR(pr: PR): void {
  try {
    if (typeof window === "undefined") return;

    const prs = getAllPRs();

    // Find the PR index in the array
    const existingIndex = prs.findIndex((item) => item.id === pr.id);

    if (existingIndex >= 0) {
      // Update existing PR
      prs[existingIndex] = pr;
    } else {
      // Add new PR
      prs.push(pr);
    }

    // Sort by timestamp (newest first)
    prs.sort((a, b) => b.timestamp - a.timestamp);

    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(prs));
  } catch (error) {
    console.error("Error saving PR to localStorage:", error);
  }
}

// Update multiple PRs at once
export function savePRs(newPRs: PR[]): void {
  try {
    if (typeof window === "undefined") return;

    const existingPRs = getAllPRs();

    // Create a map for faster lookup
    const prMap = new Map(existingPRs.map((pr) => [pr.id, pr]));

    // Update the map with new PRs
    for (const pr of newPRs) {
      prMap.set(pr.id, pr);
    }

    // Convert back to array and sort
    const updatedPRs = Array.from(prMap.values());
    updatedPRs.sort((a, b) => b.timestamp - a.timestamp);

    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(updatedPRs));
  } catch (error) {
    console.error("Error saving multiple PRs to localStorage:", error);
  }
}

// Save notes for a specific PR
export function saveNotesForPR(
  id: string,
  developer: string,
  marketing: string
): void {
  try {
    const pr = getPRById(id);
    if (!pr) return;

    pr.notes = {
      developer,
      marketing,
    };
    pr.timestamp = Date.now();

    savePR(pr);
  } catch (error) {
    console.error(`Error saving notes for PR ${id}:`, error);
  }
}

// Delete a PR by ID
export function deletePR(id: string): void {
  try {
    if (typeof window === "undefined") return;

    const prs = getAllPRs();
    const filtered = prs.filter((pr) => pr.id !== id);

    localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error(`Error deleting PR ${id}:`, error);
  }
}

// --- Streaming session storage ---

// Get a streaming session by PR ID
export function getStreamingSession(id: string): StreamingSession | null {
  try {
    if (typeof window === "undefined") return null;

    const storedData = localStorage.getItem(STREAMING_STORAGE_KEY);
    if (!storedData) return null;

    const sessions = JSON.parse(storedData);
    return (
      sessions.find((session: StreamingSession) => session.id === id) || null
    );
  } catch (error) {
    console.error(`Error getting streaming session for PR ${id}:`, error);
    return null;
  }
}

// Save a streaming session
export function saveStreamingSession(session: StreamingSession): void {
  try {
    if (typeof window === "undefined") return;

    const storedData = localStorage.getItem(STREAMING_STORAGE_KEY);
    const sessions = storedData ? JSON.parse(storedData) : [];

    const existingIndex = sessions.findIndex(
      (s: StreamingSession) => s.id === session.id
    );

    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.push(session);
    }

    localStorage.setItem(STREAMING_STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving streaming session:", error);
  }
}

// Update the partial results of an ongoing streaming session
export function updateStreamingResults(
  id: string,
  developer: string,
  marketing: string
): void {
  try {
    const session = getStreamingSession(id);
    if (!session) return;

    session.partialDeveloper = developer;
    session.partialMarketing = marketing;
    session.timestamp = Date.now();

    saveStreamingSession(session);
  } catch (error) {
    console.error(`Error updating streaming results for PR ${id}:`, error);
  }
}

// Complete a streaming session and clean up
export function completeStreamingSession(
  id: string,
  developer: string,
  marketing: string
): void {
  try {
    // Save the notes to the PR
    saveNotesForPR(id, developer, marketing);

    // Delete the streaming session
    deleteStreamingSession(id);
  } catch (error) {
    console.error(`Error completing streaming session for PR ${id}:`, error);
  }
}

// Delete a streaming session
export function deleteStreamingSession(id: string): void {
  try {
    if (typeof window === "undefined") return;

    const storedData = localStorage.getItem(STREAMING_STORAGE_KEY);
    if (!storedData) return;

    const sessions = JSON.parse(storedData);
    const filtered = sessions.filter((s: StreamingSession) => s.id !== id);

    localStorage.setItem(STREAMING_STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error(`Error deleting streaming session for PR ${id}:`, error);
  }
}

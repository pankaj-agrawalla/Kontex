import { useState } from "react";
import { Search } from "lucide-react";
import { mockSearchResults, mockSessionsResponse } from "../data/mock";
import SearchResults, { SearchEmpty, SearchUnavailable } from "../components/search/SearchResults";

const SESSIONS = mockSessionsResponse.data;

export default function SearchPage() {
  const [query, setQuery]               = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [results, setResults]           = useState(null);   // null = no search yet
  const [unavailable, setUnavailable]   = useState(false);

  function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;

    // Mock: filter by sessionId if a filter is active
    const filtered =
      sessionFilter === "all"
        ? mockSearchResults
        : mockSearchResults.filter((r) => r.sessionId === sessionFilter);

    setUnavailable(false);
    setResults(filtered);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <form onSubmit={handleSearch} className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xl">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search snapshots by label, tool, file path..."
              className="w-full bg-surface border border-border rounded pl-8 pr-3 py-2 font-sans text-sm text-text placeholder:text-subtle focus:outline-none focus:border-teal transition-colors duration-150"
            />
          </div>

          {/* Session filter */}
          <select
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
            className="bg-surface border border-border rounded px-3 py-2 font-sans text-sm text-text focus:outline-none focus:border-teal transition-colors duration-150 cursor-pointer"
          >
            <option value="all">All sessions</option>
            {SESSIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={!query.trim()}
            className="px-4 py-2 bg-teal text-bg font-sans font-medium text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity duration-150"
          >
            Search
          </button>
        </form>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-auto">
        {unavailable ? (
          <SearchUnavailable />
        ) : results === null ? (
          <div className="px-6 py-12 text-center">
            <p className="font-sans text-sm text-subtle">
              Enter a query to search across all snapshots
            </p>
          </div>
        ) : results.length === 0 ? (
          <SearchEmpty />
        ) : (
          <>
            <div className="px-6 py-3 border-b border-border">
              <span className="font-mono text-2xs text-subtle">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            </div>
            <SearchResults results={results} />
          </>
        )}
      </div>
    </div>
  );
}

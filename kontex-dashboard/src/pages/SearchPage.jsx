import { useState } from "react";
import { Search } from "lucide-react";
import { useSearch } from "../hooks/useKontexAPI";
import SearchResults, { SearchEmpty, SearchUnavailable } from "../components/search/SearchResults";

export default function SearchPage() {
  const [inputValue, setInputValue]       = useState("");
  const [q, setQ]                         = useState("");
  const [sessionFilter, setSessionFilter] = useState(null);

  const { data: results, isLoading, isError, error } = useSearch(q, sessionFilter);

  function handleSearch(e) {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setQ(inputValue.trim());
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
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search snapshots by label, tool, file path..."
              className="w-full bg-surface border border-border rounded pl-8 pr-3 py-2 font-sans text-sm text-text placeholder:text-subtle focus:outline-none focus:border-teal transition-colors duration-150"
            />
          </div>

          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-4 py-2 bg-teal text-bg font-sans font-medium text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity duration-150"
          >
            Search
          </button>
        </form>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-auto">
        {isError && error?.status === 503 ? (
          <SearchUnavailable />
        ) : isError ? (
          <p className="font-sans text-sm text-red px-6 py-4">Search failed. Try again.</p>
        ) : !q ? (
          <div className="px-6 py-12 text-center">
            <p className="font-sans text-sm text-subtle">
              Enter a query to search across all snapshots
            </p>
          </div>
        ) : isLoading ? (
          <div className="px-6 py-12 text-center">
            <p className="font-sans text-sm text-subtle">Searching…</p>
          </div>
        ) : !results?.length ? (
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

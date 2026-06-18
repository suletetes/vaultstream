/**
 * SearchPage — Search files by name, tags, MIME type
 */

import { useState } from 'react';
import { Layout } from '../components/Layout';
import { FileList } from '../components/FileList';
import { useSearchFiles } from '../hooks/useFiles';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [mimeType, setMimeType] = useState('');

  const { data, isLoading } = useSearchFiles(query, tags, mimeType);

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Search</h2>
          <p className="text-sm text-gray-500 mt-1">Find files by name, tags, or type</p>
        </div>

        {/* Search controls */}
        <div className="card p-5 space-y-4">
          {/* Search input */}
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by filename..."
              className="input-field pl-10"
            />
          </div>

          <div className="flex gap-3 flex-wrap items-end">
            {/* Tag filter */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="Add tag..."
                className="input-field w-40"
              />
              <button onClick={addTag} className="btn-secondary py-2.5">
                Add
              </button>
            </div>

            {/* MIME type filter */}
            <select
              value={mimeType}
              onChange={(e) => setMimeType(e.target.value)}
              className="input-field w-40"
            >
              <option value="">All types</option>
              <option value="application/pdf">PDF</option>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="text/plain">Text</option>
              <option value="text/csv">CSV</option>
            </select>
          </div>

          {/* Active tags */}
          {tags.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-50 text-brand-700 rounded-md text-sm font-medium">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-brand-400 hover:text-brand-600 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-4">Searching...</p>
          </div>
        ) : data?.items ? (
          <>
            <p className="text-sm text-gray-500">{data.total} {data.total === 1 ? 'result' : 'results'} found</p>
            <FileList files={data.items} showDelete={false} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-base font-medium text-gray-500">Search your vault</p>
            <p className="text-sm mt-1">Enter a filename, add tags, or filter by type</p>
          </div>
        )}
      </div>
    </Layout>
  );
}

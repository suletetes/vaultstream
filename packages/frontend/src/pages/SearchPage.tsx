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
        <h2 className="text-2xl font-semibold text-gray-900">Search</h2>

        {/* Search input */}
        <div className="space-y-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by filename..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />

          <div className="flex gap-4 flex-wrap">
            {/* Tag filter */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="Add tag filter..."
                className="px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
              <button onClick={addTag} className="px-3 py-1.5 bg-gray-100 rounded text-sm hover:bg-gray-200">
                Add
              </button>
            </div>

            {/* MIME type filter */}
            <select
              value={mimeType}
              onChange={(e) => setMimeType(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm"
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
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-brand-100 text-brand-700 rounded text-sm">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-brand-500 hover:text-brand-700">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        ) : data?.items ? (
          <>
            <p className="text-sm text-gray-500">{data.total} results found</p>
            <FileList files={data.items} showDelete={false} />
          </>
        ) : (
          <div className="text-center py-12 text-gray-500">
            Enter a search query to find files
          </div>
        )}
      </div>
    </Layout>
  );
}

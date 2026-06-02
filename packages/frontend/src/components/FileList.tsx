/**
 * FileList — Displays files in grid or list view
 */

import { useState } from 'react';

interface FileItem {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailKey?: string;
  virusScanStatus: string;
  lastAccessedAt: string;
  createdAt: string;
}

interface Props {
  files: FileItem[];
  onFileClick?: (fileId: string) => void;
  onDelete?: (fileId: string) => void;
  showDelete?: boolean;
}

export function FileList({ files, onFileClick, onDelete, showDelete = true }: Props) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  if (!files?.length) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No files found</p>
      </div>
    );
  }

  return (
    <div>
      {/* View toggle */}
      <div className="flex justify-end mb-4 gap-2">
        <button
          onClick={() => setViewMode('grid')}
          className={`px-3 py-1 text-sm rounded ${viewMode === 'grid' ? 'bg-brand-100 text-brand-700' : 'text-gray-600'}`}
        >
          Grid
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`px-3 py-1 text-sm rounded ${viewMode === 'list' ? 'bg-brand-100 text-brand-700' : 'text-gray-600'}`}
        >
          List
        </button>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((file) => (
            <FileCard key={file.fileId} file={file} onClick={onFileClick} onDelete={onDelete} showDelete={showDelete} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((file) => (
            <FileRow key={file.fileId} file={file} onClick={onFileClick} onDelete={onDelete} showDelete={showDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileCard({ file, onClick, onDelete, showDelete }: { file: FileItem; onClick?: (id: string) => void; onDelete?: (id: string) => void; showDelete: boolean }) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onClick?.(file.fileId)}
    >
      <div className="flex items-center justify-center h-20 mb-3 bg-gray-100 rounded">
        <span className="text-2xl">{getMimeIcon(file.mimeType)}</span>
      </div>
      <p className="text-sm font-medium text-gray-900 truncate">{file.filename}</p>
      <p className="text-xs text-gray-500 mt-1">{formatBytes(file.sizeBytes)}</p>
      {file.virusScanStatus === 'infected' && (
        <span className="text-xs text-red-600 font-medium">⚠️ Infected</span>
      )}
      {showDelete && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.fileId); }}
          className="mt-2 text-xs text-red-500 hover:text-red-700"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function FileRow({ file, onClick, onDelete, showDelete }: { file: FileItem; onClick?: (id: string) => void; onDelete?: (id: string) => void; showDelete: boolean }) {
  return (
    <div
      className="flex items-center gap-4 bg-white rounded px-4 py-3 border border-gray-200 hover:bg-gray-50 cursor-pointer"
      onClick={() => onClick?.(file.fileId)}
    >
      <span className="text-lg">{getMimeIcon(file.mimeType)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{file.filename}</p>
        <p className="text-xs text-gray-500">{formatBytes(file.sizeBytes)} · {new Date(file.createdAt).toLocaleDateString()}</p>
      </div>
      {file.virusScanStatus === 'infected' && (
        <span className="text-xs text-red-600">⚠️</span>
      )}
      {showDelete && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.fileId); }}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function getMimeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.startsWith('text/')) return '📃';
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

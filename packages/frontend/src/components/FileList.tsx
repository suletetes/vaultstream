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
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <p className="text-base font-medium text-gray-500">No files yet</p>
        <p className="text-sm mt-1">Upload files to get started</p>
      </div>
    );
  }

  return (
    <div>
      {/* View toggle */}
      <div className="flex justify-end mb-4 gap-1 bg-gray-100 rounded-lg p-1 w-fit ml-auto">
        <button
          onClick={() => setViewMode('grid')}
          className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          aria-label="Grid view"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          aria-label="List view"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
        </button>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {files.map((file) => (
            <FileCard key={file.fileId} file={file} onClick={onFileClick} onDelete={onDelete} showDelete={showDelete} />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {files.map((file) => (
            <FileRow key={file.fileId} file={file} onClick={onFileClick} onDelete={onDelete} showDelete={showDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileCard({ file, onClick, onDelete, showDelete }: { file: FileItem; onClick?: (id: string) => void; onDelete?: (id: string) => void; showDelete: boolean }) {
  const { icon, bgColor } = getMimeVisual(file.mimeType);

  return (
    <div
      className="group card p-4 hover:shadow-card transition-all duration-200 cursor-pointer"
      onClick={() => onClick?.(file.fileId)}
    >
      <div className={`flex items-center justify-center h-24 mb-3 rounded-lg ${bgColor}`}>
        <span className="text-3xl">{icon}</span>
      </div>
      <p className="text-sm font-medium text-gray-900 truncate">{file.filename}</p>
      <p className="text-xs text-gray-500 mt-0.5">{formatBytes(file.sizeBytes)}</p>
      {file.virusScanStatus === 'infected' && (
        <div className="mt-2 flex items-center gap-1 text-xs text-red-600 font-medium">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Infected
        </div>
      )}
      {showDelete && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.fileId); }}
          className="mt-2 btn-danger text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function FileRow({ file, onClick, onDelete, showDelete }: { file: FileItem; onClick?: (id: string) => void; onDelete?: (id: string) => void; showDelete: boolean }) {
  const { icon, bgColor } = getMimeVisual(file.mimeType);

  return (
    <div
      className="group flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={() => onClick?.(file.fileId)}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bgColor}`}>
        <span className="text-base">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{file.filename}</p>
        <p className="text-xs text-gray-500">{formatBytes(file.sizeBytes)} · {new Date(file.createdAt).toLocaleDateString()}</p>
      </div>
      {file.virusScanStatus === 'infected' && (
        <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Infected
        </span>
      )}
      {showDelete && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.fileId); }}
          className="btn-danger text-xs py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function getMimeVisual(mimeType: string): { icon: string; bgColor: string } {
  if (mimeType.startsWith('image/')) return { icon: '🖼️', bgColor: 'bg-purple-50' };
  if (mimeType === 'application/pdf') return { icon: '📄', bgColor: 'bg-red-50' };
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return { icon: '📊', bgColor: 'bg-green-50' };
  if (mimeType.includes('word') || mimeType.includes('document')) return { icon: '📝', bgColor: 'bg-blue-50' };
  if (mimeType.startsWith('text/')) return { icon: '📃', bgColor: 'bg-gray-50' };
  return { icon: '📎', bgColor: 'bg-amber-50' };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

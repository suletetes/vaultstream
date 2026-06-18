/**
 * UploadDropzone — Drag-and-drop file upload with progress
 */

import { useState, useCallback, DragEvent } from 'react';
import { useUploadFile } from '../hooks/useFiles';

export function UploadDropzone({ folderId }: { folderId?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; progress: number; status: string }>>([]);
  const uploadMutation = useUploadFile();

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => {
        setUploads((prev) => [...prev, { name: file.name, progress: 0, status: 'uploading' }]);

        uploadMutation.mutate(
          { file, folderId },
          {
            onSuccess: () => {
              setUploads((prev) =>
                prev.map((u) => (u.name === file.name ? { ...u, progress: 100, status: 'done' } : u))
              );
              setTimeout(() => {
                setUploads((prev) => prev.filter((u) => u.name !== file.name));
              }, 3000);
            },
            onError: () => {
              setUploads((prev) =>
                prev.map((u) => (u.name === file.name ? { ...u, status: 'error' } : u))
              );
            },
          }
        );
      });
    },
    [folderId, uploadMutation]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      uploadMutation.mutate({ file, folderId });
    });
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 ${
          isDragging
            ? 'border-brand-400 bg-brand-50 scale-[1.01]'
            : 'border-gray-200 hover:border-gray-300 bg-white'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
            isDragging ? 'bg-brand-100' : 'bg-gray-100'
          }`}>
            <svg className={`w-6 h-6 ${isDragging ? 'text-brand-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-600">
              Drag &amp; drop files here, or{' '}
              <label className="cursor-pointer text-brand-600 hover:text-brand-700 font-medium">
                browse
                <input type="file" multiple className="hidden" onChange={handleFileInput} />
              </label>
            </p>
            <p className="text-xs text-gray-400 mt-1">Max 100 MB per file · PDF, images, documents</p>
          </div>
        </div>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="mt-3 space-y-2">
          {uploads.map((upload) => (
            <div key={upload.name} className="flex items-center gap-3 bg-white rounded-lg p-3 border border-gray-100 shadow-soft">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                upload.status === 'done' ? 'bg-green-50' : upload.status === 'error' ? 'bg-red-50' : 'bg-brand-50'
              }`}>
                {upload.status === 'done' ? (
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : upload.status === 'error' ? (
                  <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{upload.name}</p>
                <div className="w-full bg-gray-100 rounded-full h-1 mt-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      upload.status === 'error' ? 'bg-red-400' : upload.status === 'done' ? 'bg-green-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${upload.status === 'uploading' ? 60 : upload.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

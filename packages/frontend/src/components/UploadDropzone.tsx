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
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <p className="text-gray-600 mb-2">Drag & drop files here, or</p>
        <label className="cursor-pointer text-brand-600 hover:text-brand-700 font-medium">
          browse files
          <input type="file" multiple className="hidden" onChange={handleFileInput} />
        </label>
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          {uploads.map((upload) => (
            <div key={upload.name} className="flex items-center gap-3 bg-white rounded p-3 border">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{upload.name}</p>
                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      upload.status === 'error' ? 'bg-red-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-gray-500">
                {upload.status === 'done' ? '✓' : upload.status === 'error' ? '✗' : '...'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

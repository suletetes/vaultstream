/**
 * TrashPage — Soft-deleted files with restore/permanent delete
 */

import { Layout } from '../components/Layout';
import { useTrashFiles, useRestoreFile } from '../hooks/useFiles';

export function TrashPage() {
  const { data: files, isLoading } = useTrashFiles();
  const restoreMutation = useRestoreFile();

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900">Trash</h2>
        <p className="text-sm text-gray-500">Files are permanently deleted after 30 days</p>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        ) : !files?.length ? (
          <div className="text-center py-12 text-gray-500">Trash is empty</div>
        ) : (
          <div className="space-y-2">
            {files.map((file: { fileId: string; filename: string; sizeBytes: number; deletedAt: string }) => (
              <div key={file.fileId} className="flex items-center gap-4 bg-white rounded px-4 py-3 border">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{file.filename}</p>
                  <p className="text-xs text-gray-500">
                    Deleted {new Date(file.deletedAt).toLocaleDateString()} ·{' '}
                    {Math.max(0, 30 - Math.floor((Date.now() - new Date(file.deletedAt).getTime()) / 86400000))} days remaining
                  </p>
                </div>
                <button
                  onClick={() => restoreMutation.mutate(file.fileId)}
                  className="text-sm text-brand-600 hover:text-brand-700 font-medium"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

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
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Trash</h2>
          <p className="text-sm text-gray-500 mt-1">Files are permanently deleted after 30 days</p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : !files?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            <p className="text-base font-medium text-gray-500">Trash is empty</p>
            <p className="text-sm mt-1">Deleted files will appear here</p>
          </div>
        ) : (
          <div className="card divide-y divide-gray-100 overflow-hidden">
            {files.map((file: { fileId: string; filename: string; sizeBytes: number; deletedAt: string }) => {
              const daysRemaining = Math.max(0, 30 - Math.floor((Date.now() - new Date(file.deletedAt).getTime()) / 86400000));
              return (
                <div key={file.fileId} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.filename}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Deleted {new Date(file.deletedAt).toLocaleDateString()} · {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} until permanent deletion
                    </p>
                  </div>
                  <button
                    onClick={() => restoreMutation.mutate(file.fileId)}
                    disabled={restoreMutation.isPending}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}

/**
 * DashboardPage — Main file browser with upload, folder navigation
 */

import { Layout } from '../components/Layout';
import { FileList } from '../components/FileList';
import { UploadDropzone } from '../components/UploadDropzone';
import { useRecentFiles, useDeleteFile } from '../hooks/useFiles';

export function DashboardPage() {
  const { data: files, isLoading } = useRecentFiles();
  const deleteMutation = useDeleteFile();

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">My Files</h2>
            <p className="text-sm text-gray-500 mt-1">Upload, organize, and share your files securely</p>
          </div>
        </div>

        {/* Upload */}
        <UploadDropzone />

        {/* File list */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-4">Loading files...</p>
          </div>
        ) : (
          <FileList
            files={files || []}
            onDelete={(fileId) => deleteMutation.mutate(fileId)}
          />
        )}
      </div>
    </Layout>
  );
}

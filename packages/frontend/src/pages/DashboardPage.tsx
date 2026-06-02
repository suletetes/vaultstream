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
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">My Files</h2>
        </div>

        <UploadDropzone />

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
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

/**
 * SharedPage — Files shared with the current user
 */

import { Layout } from '../components/Layout';
import { FileList } from '../components/FileList';
import { useSharedFiles } from '../hooks/useFiles';

export function SharedPage() {
  const { data: files, isLoading } = useSharedFiles();

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <h2 className="text-2xl font-semibold text-gray-900">Shared with Me</h2>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        ) : (
          <FileList files={files || []} showDelete={false} />
        )}
      </div>
    </Layout>
  );
}

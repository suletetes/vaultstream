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
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Shared with Me</h2>
          <p className="text-sm text-gray-500 mt-1">Files others have shared with you</p>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-4">Loading shared files...</p>
          </div>
        ) : !files?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <p className="text-base font-medium text-gray-500">No shared files</p>
            <p className="text-sm mt-1">Files shared with you will appear here</p>
          </div>
        ) : (
          <FileList files={files} showDelete={false} />
        )}
      </div>
    </Layout>
  );
}

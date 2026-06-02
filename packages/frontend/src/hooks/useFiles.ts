/**
 * useFiles — React Query hooks for file operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../services/api-client';

export function useRecentFiles() {
  return useQuery({
    queryKey: ['files', 'recent'],
    queryFn: async () => {
      const { data } = await apiClient.get('/files', { params: { sort: 'recent' } });
      return data.items;
    },
  });
}

export function useFolderContents(folderId: string) {
  return useQuery({
    queryKey: ['folders', folderId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/folders/${folderId}`);
      return data;
    },
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { file: File; folderId?: string; tags?: string[] }) => {
      // 1. Get presigned URL
      const { data: uploadData } = await apiClient.post('/files/upload-url', {
        filename: params.file.name,
        mimeType: params.file.type,
        sizeBytes: params.file.size,
        folderId: params.folderId,
        tags: params.tags,
      });

      // 2. Upload directly to S3
      await fetch(uploadData.presignedUrl, {
        method: 'PUT',
        headers: uploadData.headers,
        body: params.file,
      });

      // 3. Confirm upload
      const { data: fileData } = await apiClient.post('/files/upload-complete', {
        fileId: uploadData.fileId,
        etag: '', // Would come from S3 response headers
        versionId: '',
      });

      return fileData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      await apiClient.delete(`/files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['folders'] });
    },
  });
}

export function useSharedFiles() {
  return useQuery({
    queryKey: ['files', 'shared'],
    queryFn: async () => {
      const { data } = await apiClient.get('/shared');
      return data.items;
    },
  });
}

export function useTrashFiles() {
  return useQuery({
    queryKey: ['files', 'trash'],
    queryFn: async () => {
      const { data } = await apiClient.get('/trash');
      return data.items;
    },
  });
}

export function useRestoreFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      await apiClient.post(`/files/${fileId}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useSearchFiles(query: string, tags?: string[], mimeType?: string) {
  return useQuery({
    queryKey: ['search', query, tags, mimeType],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (query) params.query = query;
      if (tags?.length) params.tags = tags.join(',');
      if (mimeType) params.mimeType = mimeType;

      const { data } = await apiClient.get('/search', { params });
      return data;
    },
    enabled: Boolean(query || tags?.length || mimeType),
  });
}

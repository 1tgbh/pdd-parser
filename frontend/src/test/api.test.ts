import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../api/client', () => ({ client, aiClient: client }));
import { exportGoods, packageGoods, proxyImage } from '../api';

describe('actual API client contracts', () => {
  beforeEach(() => vi.resetAllMocks());

  it('downloads successful JSON exports without treating JSON as an error', async () => {
    const blob = new Blob(['[{"goods_id":"1"}]'], { type: 'application/json' });
    client.post.mockResolvedValue({ data: { job_id: 'job-1' } });
    client.get.mockResolvedValueOnce({ data: { status: 'completed' } }).mockResolvedValueOnce({ data: blob });
    expect(await exportGoods(['1'], 'json')).toBe(blob);
    expect(client.get).toHaveBeenLastCalledWith('/jobs/job-1/download', expect.objectContaining({ responseType: 'blob' }));
  });

  it('surfaces export job failures', async () => {
    client.post.mockResolvedValue({ data: { job_id: 'job-2' } });
    client.get.mockResolvedValue({ data: { status: 'failed', error: '图片访问受限' } });
    await expect(packageGoods(['1'], true)).rejects.toThrow('图片访问受限');
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('uses the JSON cache endpoint when an editor needs a local image URL', async () => {
    client.post.mockResolvedValue({ data: { ok: true, url: '/api/ai-image/ai_uploads/image.png' } });
    expect((await proxyImage('https://img.pddpic.com/a.png')).url).toContain('/api/ai-image/');
    expect(client.post).toHaveBeenCalledWith('/ai/cache-image', { url: 'https://img.pddpic.com/a.png' }, { timeout: 60000 });
  });
});

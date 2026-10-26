import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductProvenance, DiagnosticResponse } from '../types';

const mocks = vi.hoisted(() => ({ provenance: vi.fn(), diagnostics: vi.fn(), acknowledge: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useProductProvenance: mocks.provenance, useDiagnostics: mocks.diagnostics,
  useAcknowledgeDiagnostic: () => ({ mutate: mocks.acknowledge, isPending: false, isError: false }),
}));
import FieldProvenance from '../components/FieldProvenance';
import Diagnostics from '../pages/Diagnostics';
import { evidenceValue } from '../utils/evidence';

describe('evidence and diagnostic UI', () => {
  afterEach(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it('preserves actual zero stock while displaying unknown and legacy evidence accurately', () => {
    expect(evidenceValue(0, 'known')).toBe('0');
    expect(evidenceValue(0, 'unknown')).toBe('未获取');
    const data: ProductProvenance = {
      goods_id: '1', source_url: '', observed_at: '2020-01-01T01:00:00', updated_at: '2026-10-26T01:00:00', manual_fields: ['price'], skus: [],
      fields: [{ field: 'price', origin: 'manual', status: 'known', raw_value: 20, normalized_value: 20, current_value: 20, protected: true,
        latest_observation: { origin: 'page_state', status: 'known', raw_value: '1200', normalized_value: 12, observed_at: '2020-01-01T01:00:00' } },
      { field: 'stock', origin: 'legacy', status: 'legacy', current_value: 0, protected: false, latest_observation: null }],
    };
    mocks.provenance.mockReturnValue({ data, isLoading: false, isError: false });
    render(<FieldProvenance goodsId="1" revision="revision-one" />);
    expect(screen.getByText('人工编辑')).toBeInTheDocument();
    expect(screen.getByText('人工值受保护')).toBeInTheDocument();
    expect(screen.getByText('历史来源未记录')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(mocks.provenance).toHaveBeenCalledWith('1', 'revision-one', false);
  });

  it('acknowledging diagnostics is separate from unpausing and each error has a stage', () => {
    const data: DiagnosticResponse = { items: [{ id: 'event-one', code: 'access_denied', stage: 'image', severity: 'error',
      occurred_at: '2026-10-26T01:00:00', goods_id: '1', source_url: '', http_status: 403, retry_at: null, parser_version: '1.4.0',
      acknowledged: false, message: '访问被拒绝', hint: '仅恢复图片阶段。', missing_fields: [] }],
      total: 1, page: 1, page_size: 30, capture_state: { enabled: false, reason: '安全验证', updated_at: '' } };
    mocks.diagnostics.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
    render(<MemoryRouter><Diagnostics /></MemoryRouter>);
    expect(screen.getByText('访问被拒绝')).toBeInTheDocument();
    expect(screen.getByText(/HTTP：403/)).toBeInTheDocument();
    expect(screen.getByText(/图片读取.*未阅/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '标记已阅' }));
    expect(mocks.acknowledge).toHaveBeenCalledWith('event-one');
    expect(screen.queryByRole('button', { name: /恢复采集/ })).not.toBeInTheDocument();
  });
});

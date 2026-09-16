/**
 * ChatMessageUi + chatMessageUiBlocks — the assistant's inline charts / stat
 * cards. Verifies the metadata parser is lenient/safe and that each block kind
 * renders its human-readable text (titles, legend labels + values, stat cards).
 *
 * gifted-charts' BarChart/PieChart are globally stubbed (jest.setup.js), so the
 * chart geometry is a no-op here — we assert on the Typography text the renderer
 * draws around it (legend, titles, stats), which is the part that matters.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { ChatMessageUi } from '../ChatMessageUi';
import { chatMessageUiBlocks, type ChatMessage, type ChatUiBlock } from '../types';

function message(metadata: Record<string, unknown> | null): ChatMessage {
  return {
    id: 'm1',
    room_id: 'r1',
    sender_type: 'ai',
    sender_user_id: null,
    sender_name: 'Assistant',
    body: 'Here you go',
    attachments: null,
    mentions: null,
    reply_to: null,
    metadata,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-07-22T00:00:00Z',
  };
}

async function render(blocks: ChatUiBlock[]) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ChatMessageUi blocks={blocks} />
      </ThemeProvider>
    );
  });
  return tree;
}

/** All rendered text strings in the tree. */
function texts(tree: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

describe('chatMessageUiBlocks parser', () => {
  it('returns [] when there is no ui metadata', () => {
    expect(chatMessageUiBlocks(message(null))).toEqual([]);
    expect(chatMessageUiBlocks(message({ model: 'x' }))).toEqual([]);
  });

  it('keeps only well-formed chart/stats blocks', () => {
    const blocks = chatMessageUiBlocks(
      message({
        ui: [
          { kind: 'chart', chart: { type: 'bar', data: [] } },
          { kind: 'stats', stats: [] },
          { kind: 'bogus' },
          null,
          'nope',
        ],
      })
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe('chart');
    expect(blocks[1].kind).toBe('stats');
  });

  it('returns [] when ui is not an array', () => {
    expect(chatMessageUiBlocks(message({ ui: { kind: 'chart' } }))).toEqual([]);
  });
});

describe('ChatMessageUi rendering', () => {
  it('renders a pie chart title and legend labels + values', async () => {
    const tree = await render([
      {
        kind: 'chart',
        chart: {
          type: 'pie',
          title: 'Spending by category',
          valueFormat: 'currency',
          data: [
            { label: 'Groceries', value: 210 },
            { label: 'Dining', value: 90 },
          ],
        },
      },
    ]);
    const out = texts(tree);
    expect(out).toContain('Spending by category');
    expect(out).toContain('Groceries');
    expect(out).toContain('$210.00');
    expect(out).toContain('Dining');
    expect(out).toContain('$90.00');
  });

  it('renders a bar chart once the container reports a width (onLayout)', async () => {
    const tree = await render([
      {
        kind: 'chart',
        chart: {
          type: 'bar',
          title: 'By month',
          valueFormat: 'currency',
          data: [
            { label: 'May', value: 120 },
            { label: 'Jun', value: 300 },
          ],
        },
      },
    ]);
    // Title renders immediately; the width-gated bar body waits for layout, so
    // the (stubbed) bar-chart is absent until the container reports a width.
    expect(texts(tree)).toContain('By month');
    expect(tree.root.findAllByProps({ testID: 'bar-chart' })).toHaveLength(0);
    // Simulate the container measuring itself so the width-gated branch mounts.
    await act(async () => {
      tree.root
        .findByProps({ testID: 'chat-ui-chart' })
        .props.onLayout({ nativeEvent: { layout: { width: 280 } } });
    });
    expect(tree.root.findAllByProps({ testID: 'bar-chart' }).length).toBeGreaterThan(0);
  });

  it('renders a table with title, headers and cell values', async () => {
    const tree = await render([
      {
        kind: 'table',
        table: {
          title: 'Top products',
          columns: ['Product', 'Total'],
          rows: [
            ['Tomato', '$8.00'],
            ['Cucumber', '$4.00'],
          ],
        },
      },
    ]);
    const out = texts(tree);
    expect(out).toContain('Top products');
    expect(out).toContain('Product');
    expect(out).toContain('Tomato');
    expect(out).toContain('$8.00');
    expect(out).toContain('Cucumber');
  });

  it('renders an insight card with title, body and bullets', async () => {
    const tree = await render([
      {
        kind: 'insight',
        insight: {
          title: 'Vegetables analysis',
          body: 'Top item is Tomato.',
          bullets: ['Tomato: $8.00', 'Cucumber: $4.00'],
          tone: 'neutral',
        },
      },
    ]);
    const out = texts(tree);
    expect(out).toContain('Vegetables analysis');
    expect(out).toContain('Top item is Tomato.');
    expect(out).toContain('Tomato: $8.00');
  });

  it('renders a diagram with node labels and edge arrows', async () => {
    const tree = await render([
      {
        kind: 'diagram',
        diagram: {
          title: 'Money flow',
          nodes: [
            { id: 'inc', label: 'Income', value: '$5,000' },
            { id: 'bills', label: 'Bills' },
          ],
          edges: [{ from: 'inc', to: 'bills', label: 'monthly' }],
        },
      },
    ]);
    const out = texts(tree);
    expect(out).toContain('Money flow');
    expect(out).toContain('Income'); // node label + edge source
    expect(out).toContain('Bills');
    expect(out).toContain('→'); // edge arrow (rendered as separate text nodes)
    expect(out).toContain('monthly'); // edge label
  });

  it('renders stat cards with label, value and caption', async () => {
    const tree = await render([
      {
        kind: 'stats',
        stats: [
          { label: 'Spent', value: '$412', tone: 'warning' },
          { label: 'Remaining', value: '$188', caption: '31% left', tone: 'positive' },
        ],
      },
    ]);
    const out = texts(tree);
    expect(out).toContain('Spent');
    expect(out).toContain('$412');
    expect(out).toContain('Remaining');
    expect(out).toContain('31% left');
  });

  it('renders nothing for an empty block list', async () => {
    const tree = await render([]);
    expect(tree.toJSON()).toBeNull();
  });
});

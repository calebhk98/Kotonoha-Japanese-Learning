// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import HomeView from './HomeView';
import type { Content } from '../data/content';

// #259 P3: content cards are a plain <div onClick>, so keyboard users can't
// focus or activate them (no way to open a story without a mouse). This
// exercises the minimal HomeView prop surface needed to render one card.

const content: Content = {
  id: 'story-1',
  title: 'Momotaro',
  type: 'story',
  description: 'A peach-born boy fights demons.',
  text: '昔々、',
};

function baseProps(overrides: Partial<ComponentProps<typeof HomeView>> = {}) {
  return {
    setDisplayCount: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchScope: new Set(['title', 'description', 'body']) as any,
    toggleSearchScope: vi.fn(),
    typeFilter: new Set() as any,
    toggleTypeFilter: vi.fn(),
    levelFilter: new Set() as any,
    toggleLevelFilter: vi.fn(),
    availableLevels: [],
    tagFilter: new Set() as any,
    toggleTagFilter: vi.fn(),
    availableTags: [],
    lengthFilter: 'all' as any,
    setLengthFilter: vi.fn(),
    comprehensionRange: [0, 100] as [number, number],
    setComprehensionRange: vi.fn(),
    sortBy: 'difficulty' as any,
    setSortBy: vi.fn(),
    sortDir: 'asc' as any,
    setSortDir: vi.fn(),
    hasActiveFilters: false,
    onClearFilters: vi.fn(),
    getContentStatus: () => ({
      unknownCount: 3,
      totalCount: 10,
      score: 42,
      comprehension: 70,
    }),
    loadVocabForContent: vi.fn(),
    setSelectedContent: vi.fn(),
    comprehensionColor: () => 'text-green-700 bg-green-50 border-green-200',
    visibleContent: [content],
    loadingContent: {},
    displayCount: 12,
    sortedContent: [content],
    ...overrides,
  };
}

describe('HomeView content card keyboard access (#259 P3)', () => {
  it('the card is focusable and opens the content on Enter', () => {
    const setSelectedContent = vi.fn();
    const loadVocabForContent = vi.fn();
    render(<HomeView {...baseProps({ setSelectedContent, loadVocabForContent })} />);

    const card = screen.getByText('Momotaro').closest('[role="button"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(setSelectedContent).toHaveBeenCalledWith(content);
    expect(loadVocabForContent).toHaveBeenCalledWith(content);
  });

  it('the card opens the content on Space too', () => {
    const setSelectedContent = vi.fn();
    render(<HomeView {...baseProps({ setSelectedContent })} />);

    const card = screen.getByText('Momotaro').closest('[role="button"]') as HTMLElement;
    fireEvent.keyDown(card, { key: ' ' });

    expect(setSelectedContent).toHaveBeenCalledWith(content);
  });

  it('the card still opens on click (mouse behavior unchanged)', () => {
    const setSelectedContent = vi.fn();
    render(<HomeView {...baseProps({ setSelectedContent })} />);

    fireEvent.click(screen.getByText('Momotaro'));

    expect(setSelectedContent).toHaveBeenCalledWith(content);
  });
});
